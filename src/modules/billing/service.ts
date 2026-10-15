import { createHash } from 'node:crypto';
import { badRequest, conflict, notFound, ApiHttpError } from '../../lib/errors.js';
import type { Mailer } from '../../lib/email.js';
import type { BillingConfig } from './config.js';
import { billingState, type BillingState } from './gating.js';
import { PITCH, TRIAL_DAYS, type Interval, type PriceKey, type Tier } from './plans.js';
import { priceFor, type Pricing } from './pricing.js';
import { normaliseSubscription, type ItemOp, type StripeApi, type StripeSub } from './stripe.js';
import type { AccountRow, BillingStore } from './store.js';
import { evaluateUsage, monthKey, type VenueUsage } from './usage.js';

export interface BillingDeps {
  store: BillingStore;
  stripe: StripeApi;
  config: BillingConfig;
  mailer?: Mailer;
  /** organisation name for the Stripe customer */
  orgName(orgId: string): Promise<string | null>;
  now?: () => Date;
  log?: { info(o: object, m?: string): void; warn(o: object, m?: string): void; error(o: object, m?: string): void };
}

export type SyncResult =
  | { changed: boolean; skipped?: undefined; ops: ItemOp[]; pricing: Pricing }
  | { changed: false; skipped: 'no_subscription' | 'canceled' | 'no_active_venues'; ops: []; pricing?: Pricing };

/** Stripe subscription status -> our status. */
export function mapStatus(s: string): AccountRow['status'] {
  switch (s) {
    case 'trialing': return 'trialing';
    case 'active': return 'active';
    case 'past_due': case 'unpaid': case 'incomplete': return 'past_due';
    case 'paused': return 'paused';
    case 'canceled': case 'incomplete_expired': return 'canceled';
    default: return 'past_due';
  }
}
const iso = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toISOString() : null);

export function createBilling(deps: BillingDeps) {
  const { store, stripe, config } = deps;
  const now = () => (deps.now ?? (() => new Date()))();
  const log = deps.log ?? { info() {}, warn() {}, error() {} };
  const locks = new Map<string, Promise<unknown>>();

  /** Run one job at a time per organisation (a second request waits its turn). */
  function serial<T>(orgId: string, job: () => Promise<T>): Promise<T> {
    const run = (locks.get(orgId) ?? Promise.resolve()).catch(() => undefined).then(job);
    locks.set(orgId, run);
    void run.finally(() => { if (locks.get(orgId) === run) locks.delete(orgId); }).catch(() => undefined);
    return run;
  }

  const priceId = (key: PriceKey, interval: Interval) => config.prices[key][interval];
  const keyOfPrice = (id: string): PriceKey | null => {
    for (const k of ['standard', 'group', 'large'] as PriceKey[]) for (const i of ['month', 'year'] as Interval[]) if (config.prices[k][i] === id) return k;
    return null;
  };

  // ---- quantity sync: ONE idempotent function ----------------------------------------------
  /**
   * Make Stripe's subscription match the organisation's active venues: recount, apply the
   * 5+ group rate, then add/change/remove only the items that differ (with proration).
   * Safe to call as often as you like: when nothing differs it does nothing.
   */
  function sync(orgId: string): Promise<SyncResult> {
    return serial(orgId, async () => {
      const account = await store.getAccount(orgId);
      if (!account?.stripe_subscription_id) return { changed: false, skipped: 'no_subscription', ops: [] };
      if (account.status === 'canceled') return { changed: false, skipped: 'canceled', ops: [] };

      const pricing = priceFor(await store.listSites(orgId), account.interval);
      // Stripe subscriptions need at least one item; with no active venues we leave the subscription alone.
      if (!pricing.lines.length) return { changed: false, skipped: 'no_active_venues', ops: [], pricing };

      const desired = new Map(pricing.lines.map((l) => [priceId(l.key, account.interval), l.quantity]));
      const sub = await stripe.getSubscription(account.stripe_subscription_id);
      const ops: ItemOp[] = [];
      const seen = new Set<string>();
      for (const item of sub.items) {
        const want = desired.get(item.price_id);
        if (want === undefined || seen.has(item.price_id)) ops.push({ id: item.id, deleted: true });
        else { seen.add(item.price_id); if (item.quantity !== want) ops.push({ id: item.id, quantity: want }); }
      }
      for (const [price, quantity] of desired) if (!seen.has(price)) ops.push({ price, quantity });

      if (ops.length) {
        const fingerprint = createHash('sha1').update(JSON.stringify([sub.items, ops, Math.floor(now().getTime() / 60_000)])).digest('hex').slice(0, 24);
        await stripe.updateSubscriptionItems(sub.id, ops, `sync-${sub.id}-${fingerprint}`);
        log.info({ orgId, ops: ops.length, total_pence: pricing.total_pence }, 'billing: subscription synced');
      }
      await store.saveAccount(orgId, { synced_lines: pricing.lines });
      return { changed: ops.length > 0, ops, pricing };
    });
  }

  /** Never let a billing hiccup fail the action that triggered it (adding a venue etc.). */
  async function syncQuietly(orgId: string): Promise<void> {
    try { await sync(orgId); } catch (e) { log.error({ orgId, err: String((e as Error).message) }, 'billing: sync failed (will retry on next change or nightly)'); }
  }

  // ---- starting, card, portal ----------------------------------------------------------------
  async function startOrAddCard(orgId: string, o: { interval: Interval; email: string }): Promise<
    { action: 'trial_started'; trial_ends_at: string } | { action: 'redirect'; url: string }> {
    return serial(orgId, async () => {
      let account = await store.getAccount(orgId);

      if (account?.stripe_subscription_id) {
        if (account.status === 'canceled') throw conflict('This subscription was cancelled. Contact Stacked to restart it.');
        if (!account.stripe_customer_id) throw conflict('Billing account is incomplete. Contact Stacked.');
        const back = `${config.publicUrl}/manage/#/settings/billing`;
        const { url } = await stripe.createSetupCheckout({
          customerId: account.stripe_customer_id, orgId, subscriptionId: account.stripe_subscription_id,
          successUrl: `${back}?card=added`, cancelUrl: `${back}?card=cancelled`,
        });
        return { action: 'redirect' as const, url };
      }

      const pricing = priceFor(await store.listSites(orgId), o.interval);
      if (!pricing.lines.length) throw badRequest('Add at least one active venue before starting your trial');

      let customerId = account?.stripe_customer_id ?? null;
      if (!customerId) {
        const name = (await deps.orgName(orgId)) ?? 'Stacked Chat customer';
        customerId = (await stripe.createCustomer({ name, email: o.email, orgId })).id;
        // save straight away so a failure below never leaves an orphaned customer we've forgotten
        account = await store.saveAccount(orgId, { stripe_customer_id: customerId, status: 'trialing', interval: o.interval });
      }
      const trialEnd = Math.floor(now().getTime() / 1000) + TRIAL_DAYS * 86_400;
      const sub = await stripe.createTrialSubscription({
        customerId, orgId, trialEnd,
        items: pricing.lines.map((l) => ({ price: priceId(l.key, o.interval), quantity: l.quantity })),
      });
      await store.saveAccount(orgId, {
        stripe_customer_id: customerId, stripe_subscription_id: sub.id, status: 'trialing', interval: o.interval,
        trial_ends_at: iso(sub.trial_end) ?? new Date(trialEnd * 1000).toISOString(),
        has_payment_method: !!sub.default_payment_method, current_period_end: iso(sub.current_period_end), synced_lines: pricing.lines,
      });
      return { action: 'trial_started' as const, trial_ends_at: iso(sub.trial_end) ?? new Date(trialEnd * 1000).toISOString() };
    });
  }

  async function portal(orgId: string): Promise<{ url: string }> {
    const account = await store.getAccount(orgId);
    if (!account?.stripe_customer_id) throw conflict('Start your free trial first, then you can manage billing here');
    return stripe.createPortalSession({ customerId: account.stripe_customer_id, returnUrl: `${config.publicUrl}/manage/#/settings/billing` });
  }

  // ---- state, gating, summary ------------------------------------------------------------------
  async function stateFor(orgId: string): Promise<BillingState> {
    return billingState(await store.getAccount(orgId), now());
  }
  /** Used before admin writes. Fails OPEN: if we cannot read billing state, we do not lock anyone out. */
  async function assertWritable(orgId: string): Promise<void> {
    let st: BillingState;
    try { st = await stateFor(orgId); } catch (e) { log.warn({ orgId, err: String((e as Error).message) }, 'billing: state unavailable, allowing'); return; }
    if (!st.writable) {
      throw new ApiHttpError(402, 'billing_required', st.mode === 'canceled'
        ? 'This subscription has ended, so your account is read-only. Contact Stacked to restart it.'
        : 'Your account is read-only until billing is sorted. Staff can still read everything; an admin can fix this under Settings, Billing.');
    }
  }

  async function usageFor(orgId: string, at = now()): Promise<VenueUsage[]> {
    const [sites, staff, usage] = await Promise.all([store.listSites(orgId), store.countActiveStaff(orgId), store.listUsage(orgId, monthKey(at))]);
    const q = new Map(usage.map((u) => [u.site_id, u.ai_questions]));
    return sites.map((s) => evaluateUsage(s, q.get(s.id) ?? 0, staff[s.id] ?? 0, config.fairUse));
  }

  async function summary(orgId: string) {
    const at = now();
    const account = await store.getAccount(orgId);
    const state = billingState(account, at);
    const sites = await store.listSites(orgId);
    const interval: Interval = account?.interval ?? 'month';
    const pricing = priceFor(sites, interval);
    const usage = await usageFor(orgId, at);
    return {
      currency: 'gbp' as const,
      excludes_vat: true,
      pitch: PITCH,
      account: account ? { status: account.status, interval: account.interval, has_card: account.has_payment_method, trial_ends_at: account.trial_ends_at } : null,
      state,
      // "what you pay": the real total once on a plan, a preview before that
      pricing,
      next_invoice_pence: account && state.mode !== 'canceled' ? pricing.total_pence : null,
      venues: {
        total: sites.length, active: pricing.active_venues, inactive: sites.length - pricing.active_venues,
        standard: pricing.standard_venues, large: pricing.large_venues,
      },
      sites: sites.map((s) => ({ id: s.id, name: s.name, billing_tier: s.billing_tier, active: s.active })),
      fair_use: {
        ai_questions_per_month: config.fairUse.aiQuestionsPerMonth,
        staff_per_venue: config.fairUse.staffPerVenue,
        any_over: usage.some((u) => u.active && (u.over_ai || u.over_staff)),
        venues: usage,
      },
    };
  }

  /** Change a venue's tier or switch it on/off, then bring Stripe in line. */
  async function setSiteBilling(orgId: string, siteId: string, patch: { billing_tier?: Tier; active?: boolean }) {
    const site = await store.getSite(siteId);
    if (!site || site.org_id !== orgId) throw notFound('Site not found');
    const updated = await store.updateSite(siteId, patch);
    await syncQuietly(orgId);
    return updated;
  }

  // ---- webhooks -----------------------------------------------------------------------------------
  interface StripeEvent { id: string; type: string; created?: number; data: { object: Record<string, unknown> } }

  async function accountForSub(sub: { metadata?: Record<string, string>; customer?: unknown }): Promise<AccountRow | null> {
    const org = sub.metadata?.org_id;
    if (org) { const a = await store.getAccount(org); if (a) return a; }
    const cust = typeof sub.customer === 'string' ? sub.customer : (sub.customer as { id?: string } | undefined)?.id;
    return cust ? store.findAccountByCustomer(cust) : null;
  }

  async function applySubscription(account: AccountRow, sub: StripeSub, atMs: number) {
    const status = mapStatus(sub.status);
    await store.saveAccount(account.org_id, {
      stripe_subscription_id: sub.id,
      status,
      interval: sub.interval ?? account.interval,
      trial_ends_at: iso(sub.trial_end) ?? account.trial_ends_at,
      current_period_end: iso(sub.current_period_end),
      has_payment_method: !!sub.default_payment_method || account.has_payment_method,
      past_due_since: status === 'past_due' ? (account.past_due_since ?? new Date(atMs).toISOString()) : null,
      canceled_at: status === 'canceled' ? (account.canceled_at ?? iso(sub.canceled_at) ?? new Date(atMs).toISOString()) : null,
    });
  }

  async function process(ev: StripeEvent): Promise<void> {
    const obj = ev.data.object as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const atMs = (ev.created ?? Math.floor(now().getTime() / 1000)) * 1000;

    switch (ev.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const account = await accountForSub(obj);
        if (!account) { log.warn({ event: ev.id }, 'billing: subscription event for unknown account'); return; }
        let sub: StripeSub | null = null;
        if (ev.type !== 'customer.subscription.deleted') {
          // Events can arrive out of order, so trust Stripe's current state over the payload.
          try { sub = await stripe.getSubscription(obj.id); } catch { sub = null; }
        }
        if (!sub) {
          sub = normaliseSubscription(obj);
          if (ev.type === 'customer.subscription.deleted') sub = { ...sub, status: 'canceled' };
        }
        await applySubscription(account, sub, atMs);
        return;
      }
      case 'invoice.paid': {
        const account = obj.customer ? await store.findAccountByCustomer(String(obj.customer)) : null;
        if (!account) return;
        if (account.status === 'past_due') await store.saveAccount(account.org_id, { status: 'active', past_due_since: null });
        else if (account.past_due_since) await store.saveAccount(account.org_id, { past_due_since: null });
        return;
      }
      case 'invoice.payment_failed': {
        const account = obj.customer ? await store.findAccountByCustomer(String(obj.customer)) : null;
        if (!account || account.status === 'canceled') return;
        await store.saveAccount(account.org_id, { status: 'past_due', past_due_since: account.past_due_since ?? new Date(atMs).toISOString() });
        return;
      }
      case 'customer.subscription.trial_will_end': {
        const account = await accountForSub(obj);
        if (!account || account.has_payment_method || account.trial_reminder_sent_at) return;
        await remindToAddCard(account);
        return;
      }
      case 'checkout.session.completed': {
        if (obj.mode !== 'setup') return; // we only use Checkout to collect a card
        const orgId = obj.metadata?.org_id as string | undefined;
        const account = orgId ? await store.getAccount(orgId) : obj.customer ? await store.findAccountByCustomer(String(obj.customer)) : null;
        if (!account?.stripe_customer_id || !account.stripe_subscription_id) return;
        const si = typeof obj.setup_intent === 'string' ? obj.setup_intent : obj.setup_intent?.id;
        if (!si) return;
        await stripe.attachDefaultPaymentMethod({ customerId: account.stripe_customer_id, subscriptionId: account.stripe_subscription_id, setupIntentId: si });
        await store.saveAccount(account.org_id, { has_payment_method: true });
        // a trial that ended while paused (no card) picks up again now that there is one
        const sub = await stripe.getSubscription(account.stripe_subscription_id);
        const live = sub.status === 'paused' ? await stripe.resumeSubscription(sub.id) : sub;
        await applySubscription({ ...account, has_payment_method: true }, live, atMs);
        return;
      }
      default:
        return; // events we don't act on are acknowledged and ignored
    }
  }

  /** Idempotent entry point for a verified Stripe event. */
  async function handleEvent(ev: StripeEvent): Promise<'processed' | 'duplicate'> {
    if ((await store.claimEvent(ev.id, ev.type)) === 'duplicate') return 'duplicate';
    try {
      await process(ev);
      await store.markEventProcessed(ev.id);
      return 'processed';
    } catch (e) {
      await store.releaseEvent(ev.id).catch(() => undefined); // let Stripe's retry run it again
      throw e;
    }
  }

  async function remindToAddCard(account: AccountRow) {
    const emails = await store.ownerEmails(account.org_id);
    const org = (await deps.orgName(account.org_id)) ?? 'your organisation';
    const url = `${config.publicUrl}/manage/#/settings/billing`;
    if (deps.mailer) {
      for (const to of emails) {
        await deps.mailer.send({
          to, subject: `Your Stacked Chat trial for ${org} ends soon`,
          text: `Your free trial of Stacked Chat for ${org} ends in a few days. Add a card now so nothing is interrupted. You won't be charged until the trial ends.\n\n${url}`,
          html: `<p>Your free trial of Stacked Chat for ${org.replace(/[<>&]/g, '')} ends in a few days. Add a card now so nothing is interrupted. You won't be charged until the trial ends.</p><p><a href="${url}">Add a card</a></p>`,
        });
      }
    }
    await store.saveAccount(account.org_id, { trial_reminder_sent_at: now().toISOString() });
  }

  // ---- fair-use metering ----------------------------------------------------------------------------
  /** One AI question was answered for this venue. Never throws and never blocks the chat. */
  async function recordQuestion(siteId: string): Promise<void> {
    try {
      const month = monthKey(now());
      const n = await store.bumpUsage(siteId, month);
      if (n > config.fairUse.aiQuestionsPerMonth && (await store.flagUsage(siteId, month))) {
        const site = await store.getSite(siteId);
        await config.notify?.(`Stacked Chat fair use: "${site?.name ?? siteId}" has passed ${config.fairUse.aiQuestionsPerMonth} AI questions this month (${n}). Flagged for review, not blocked.`);
      }
    } catch (e) { log.warn({ siteId, err: String((e as Error).message) }, 'billing: could not record usage'); }
  }

  /** Billing state for a venue (legacy server.js asks this). Fails open. */
  async function stateForSite(siteId: string): Promise<BillingState> {
    try {
      const site = await store.getSite(siteId);
      return site ? await stateFor(site.org_id) : billingState(null);
    } catch { return billingState(null); }
  }

  // ---- nightly reconcile --------------------------------------------------------------------------------
  /** Catches venues changed outside our code (the legacy sign-up flow writes straight to the database). */
  async function reconcile(): Promise<{ accounts: number; changed: number; failed: number; flagged: number; purgeDue: string[] }> {
    const accounts = await store.listAccounts();
    let changed = 0, failed = 0, flagged = 0;
    const purgeDue: string[] = [];
    for (const a of accounts) {
      try {
        const r = await sync(a.org_id);
        if (r.changed) changed++;
        const over = (await usageFor(a.org_id)).filter((u) => u.active && (u.over_ai || u.over_staff));
        flagged += over.length;
        const st = billingState(a, now());
        if (st.mode === 'canceled' && st.retention_ends_at && new Date(st.retention_ends_at) < now()) purgeDue.push(a.org_id);
      } catch (e) { failed++; log.error({ orgId: a.org_id, err: String((e as Error).message) }, 'billing: reconcile failed for org'); }
    }
    if (purgeDue.length) await config.notify?.(`Stacked Chat billing: ${purgeDue.length} cancelled organisation(s) are past the 90-day retention window and are due a data review (nothing is deleted automatically).`);
    return { accounts: accounts.length, changed, failed, flagged, purgeDue };
  }

  return { sync, syncQuietly, startOrAddCard, portal, stateFor, assertWritable, summary, setSiteBilling, handleEvent, recordQuestion, stateForSite, reconcile, usageFor, keyOfPrice };
}

export type Billing = ReturnType<typeof createBilling>;
