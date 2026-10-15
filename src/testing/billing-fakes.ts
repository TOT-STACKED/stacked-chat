import { randomUUID } from 'node:crypto';
import type { AccountRow, BillingSite, BillingStore, UsageRow } from '../modules/billing/store.js';
import type { ItemOp, StripeApi, StripeSub } from '../modules/billing/stripe.js';
import type { BillingConfig } from '../modules/billing/config.js';
import { INTERVALS, PRICE_KEYS } from '../modules/billing/plans.js';

export const testBillingConfig = (over: Partial<BillingConfig> = {}): BillingConfig => {
  const prices = {} as BillingConfig['prices'];
  for (const k of PRICE_KEYS) prices[k] = { month: `price_${k}_m`, year: `price_${k}_y` };
  return {
    secretKey: 'sk_test_fake', webhookSecret: 'whsec_test', prices, publicUrl: 'https://stackedchat.io',
    fairUse: { aiQuestionsPerMonth: 2000, staffPerVenue: 75 }, cronSecret: 'cron-secret', notify: null, ...over,
  };
};

/** In-memory Stripe: keeps subscriptions and records every call. */
export class FakeStripe implements StripeApi {
  subs = new Map<string, StripeSub>();
  customers: Array<{ id: string; orgId: string }> = [];
  calls: string[] = [];
  updates: Array<{ id: string; ops: ItemOp[]; key: string }> = [];
  portalFor: string[] = [];
  checkouts: Array<{ customerId: string; subscriptionId: string }> = [];
  attached: string[] = [];
  failNextUpdate = false;
  private intervalOf: Map<string, 'month' | 'year'>;

  constructor(cfg = testBillingConfig()) {
    this.intervalOf = new Map();
    for (const k of PRICE_KEYS) for (const i of INTERVALS) this.intervalOf.set(cfg.prices[k][i], i);
  }

  async createCustomer(p: { name: string; email?: string; orgId: string }) {
    this.calls.push('createCustomer');
    const c = { id: 'cus_' + randomUUID().slice(0, 8), orgId: p.orgId };
    this.customers.push(c); return { id: c.id };
  }
  async createTrialSubscription(p: { customerId: string; orgId: string; items: Array<{ price: string; quantity: number }>; trialEnd: number }) {
    this.calls.push('createTrialSubscription');
    const sub: StripeSub = {
      id: 'sub_' + randomUUID().slice(0, 8), customer: p.customerId, status: 'trialing', trial_end: p.trialEnd,
      current_period_end: p.trialEnd, canceled_at: null, interval: this.intervalOf.get(p.items[0]!.price) ?? 'month',
      default_payment_method: null, metadata: { org_id: p.orgId },
      items: p.items.map((i) => ({ id: 'si_' + randomUUID().slice(0, 8), price_id: i.price, quantity: i.quantity })),
    };
    this.subs.set(sub.id, sub); return structuredClone(sub);
  }
  async getSubscription(id: string) {
    const s = this.subs.get(id); if (!s) throw new Error('no such subscription'); return structuredClone(s);
  }
  async updateSubscriptionItems(id: string, ops: ItemOp[], key: string) {
    this.calls.push('updateSubscriptionItems');
    if (this.failNextUpdate) { this.failNextUpdate = false; throw new Error('stripe down'); }
    const s = this.subs.get(id)!;
    this.updates.push({ id, ops, key });
    for (const op of ops) {
      if ('deleted' in op) s.items = s.items.filter((i) => i.id !== op.id);
      else if ('id' in op) s.items.find((i) => i.id === op.id)!.quantity = op.quantity;
      else s.items.push({ id: 'si_' + randomUUID().slice(0, 8), price_id: op.price, quantity: op.quantity });
    }
    s.interval = this.intervalOf.get(s.items[0]?.price_id ?? '') ?? s.interval;
    return structuredClone(s);
  }
  async resumeSubscription(id: string) { const s = this.subs.get(id)!; s.status = 'active'; return structuredClone(s); }
  async createSetupCheckout(p: { customerId: string; subscriptionId: string }) { this.checkouts.push(p); return { url: 'https://checkout.stripe.test/session' }; }
  async createPortalSession(p: { customerId: string }) { this.portalFor.push(p.customerId); return { url: 'https://billing.stripe.test/portal' }; }
  async attachDefaultPaymentMethod(p: { subscriptionId: string }) { this.attached.push(p.subscriptionId); this.subs.get(p.subscriptionId)!.default_payment_method = 'pm_test'; }

  /** The quantity currently on the subscription for a price. */
  qty(subId: string, price: string) { return this.subs.get(subId)?.items.find((i) => i.price_id === price)?.quantity ?? 0; }
}

export class FakeBillingStore implements BillingStore {
  accounts = new Map<string, AccountRow>();
  sites: BillingSite[] = [];
  staff: Record<string, number> = {};
  owners: Record<string, string[]> = {};
  events = new Map<string, { type: string; processed: boolean }>();
  usage = new Map<string, UsageRow>();

  addSite(orgId: string, name: string, over: Partial<BillingSite> = {}): BillingSite {
    const s: BillingSite = { id: randomUUID(), org_id: orgId, name, billing_tier: 'standard', active: true, ...over };
    this.sites.push(s); return s;
  }
  async getAccount(orgId: string) { return structuredClone(this.accounts.get(orgId) ?? null); }
  async findAccountByCustomer(customerId: string) { return structuredClone([...this.accounts.values()].find((a) => a.stripe_customer_id === customerId) ?? null); }
  async listAccounts() { return structuredClone([...this.accounts.values()]); }
  async saveAccount(orgId: string, patch: Partial<AccountRow>) {
    const base: AccountRow = this.accounts.get(orgId) ?? {
      org_id: orgId, stripe_customer_id: null, stripe_subscription_id: null, status: 'trialing', interval: 'month', trial_ends_at: null,
      has_payment_method: false, past_due_since: null, canceled_at: null, current_period_end: null, synced_lines: null, trial_reminder_sent_at: null,
    };
    const next = { ...base, ...patch, org_id: orgId }; this.accounts.set(orgId, next); return structuredClone(next);
  }
  async listSites(orgId: string) { return structuredClone(this.sites.filter((s) => s.org_id === orgId)); }
  async getSite(id: string) { return structuredClone(this.sites.find((s) => s.id === id) ?? null); }
  async updateSite(id: string, patch: { billing_tier?: 'standard' | 'large'; active?: boolean }) {
    const s = this.sites.find((x) => x.id === id)!; Object.assign(s, patch); return structuredClone(s);
  }
  async countActiveStaff() { return { ...this.staff }; }
  async ownerEmails(orgId: string) { return this.owners[orgId] ?? []; }
  async claimEvent(id: string, type: string) {
    const e = this.events.get(id);
    if (e && e.processed) return 'duplicate' as const;
    this.events.set(id, { type, processed: false }); return 'new' as const;
  }
  async markEventProcessed(id: string) { this.events.get(id)!.processed = true; }
  async releaseEvent(id: string) { if (!this.events.get(id)?.processed) this.events.delete(id); }
  async bumpUsage(siteId: string, month: string) {
    const k = siteId + month; const u = this.usage.get(k) ?? { site_id: siteId, ai_questions: 0, flagged_at: null };
    u.ai_questions++; this.usage.set(k, u); return u.ai_questions;
  }
  async listUsage(orgId: string, month: string) {
    return this.sites.filter((s) => s.org_id === orgId).map((s) => this.usage.get(s.id + month)).filter((u): u is UsageRow => !!u).map((u) => ({ ...u }));
  }
  async flagUsage(siteId: string, month: string) {
    const u = this.usage.get(siteId + month); if (!u || u.flagged_at) return false; u.flagged_at = new Date().toISOString(); return true;
  }
}
