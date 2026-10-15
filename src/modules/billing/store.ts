import type { Db } from '../../lib/supabase.js';
import type { AccountForGating } from './gating.js';
import type { Interval, Tier } from './plans.js';
import type { PricingLine } from './pricing.js';

export interface AccountRow extends AccountForGating {
  org_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  interval: Interval;
  current_period_end: string | null;
  synced_lines: PricingLine[] | null;
  trial_reminder_sent_at: string | null;
}
export interface BillingSite { id: string; org_id: string; name: string; billing_tier: Tier; active: boolean }
export interface UsageRow { site_id: string; ai_questions: number; flagged_at: string | null }

/** Everything billing needs from storage. Supabase in production, in-memory in tests. */
export interface BillingStore {
  getAccount(orgId: string): Promise<AccountRow | null>;
  findAccountByCustomer(customerId: string): Promise<AccountRow | null>;
  listAccounts(): Promise<AccountRow[]>;
  saveAccount(orgId: string, patch: Partial<AccountRow>): Promise<AccountRow>;
  listSites(orgId: string): Promise<BillingSite[]>;
  getSite(siteId: string): Promise<BillingSite | null>;
  updateSite(siteId: string, patch: { billing_tier?: Tier; active?: boolean }): Promise<BillingSite>;
  /** active members per site (kiosks are devices, not staff) */
  countActiveStaff(orgId: string): Promise<Record<string, number>>;
  ownerEmails(orgId: string): Promise<string[]>;
  /** 'new' the first time an event id is seen, 'duplicate' when already processed */
  claimEvent(id: string, type: string): Promise<'new' | 'duplicate'>;
  markEventProcessed(id: string): Promise<void>;
  releaseEvent(id: string): Promise<void>;
  bumpUsage(siteId: string, month: string): Promise<number>;
  listUsage(orgId: string, month: string): Promise<UsageRow[]>;
  /** true only for the call that flags it (so we alert once) */
  flagUsage(siteId: string, month: string): Promise<boolean>;
}

const enc = encodeURIComponent;
const ACCOUNT_COLS = 'org_id,stripe_customer_id,stripe_subscription_id,status,interval,trial_ends_at,has_payment_method,past_due_since,canceled_at,current_period_end,synced_lines,trial_reminder_sent_at';
const SITE_COLS = 'id,org_id,name,billing_tier,active';

export function createSupabaseBillingStore(db: Db): BillingStore {
  const ok = <T>(r: { status: number; data: T }, what: string): T => {
    if (r.status >= 300) throw new Error(`billing store: ${what} failed (${r.status})`);
    return r.data;
  };
  const first = <T>(rows: T[] | null) => (rows && rows[0]) ?? null;
  const rep = { Prefer: 'return=representation' };

  return {
    async getAccount(orgId) {
      return first(ok(await db.rest<AccountRow[]>(`/billing_accounts?org_id=eq.${enc(orgId)}&select=${ACCOUNT_COLS}&limit=1`), 'get account'));
    },
    async findAccountByCustomer(customerId) {
      return first(ok(await db.rest<AccountRow[]>(`/billing_accounts?stripe_customer_id=eq.${enc(customerId)}&select=${ACCOUNT_COLS}&limit=1`), 'find account'));
    },
    async listAccounts() {
      return ok(await db.rest<AccountRow[]>(`/billing_accounts?select=${ACCOUNT_COLS}&limit=5000`), 'list accounts') ?? [];
    },
    async saveAccount(orgId, patch) {
      const body = { ...patch, org_id: orgId, updated_at: new Date().toISOString() };
      const r = await db.rest<AccountRow[]>(`/billing_accounts?on_conflict=org_id&select=${ACCOUNT_COLS}`, {
        method: 'POST', headers: { ...rep, Prefer: 'return=representation,resolution=merge-duplicates' }, body,
      });
      return first(ok(r, 'save account'))!;
    },
    async listSites(orgId) {
      return ok(await db.rest<BillingSite[]>(`/venues?org_id=eq.${enc(orgId)}&select=${SITE_COLS}&order=created_at.asc&limit=5000`), 'list sites') ?? [];
    },
    async getSite(siteId) {
      return first(ok(await db.rest<BillingSite[]>(`/venues?id=eq.${enc(siteId)}&select=${SITE_COLS}&limit=1`), 'get site'));
    },
    async updateSite(siteId, patch) {
      return first(ok(await db.rest<BillingSite[]>(`/venues?id=eq.${enc(siteId)}&select=${SITE_COLS}`, { method: 'PATCH', headers: rep, body: patch }), 'update site'))!;
    },
    async countActiveStaff(orgId) {
      const rows = ok(await db.rest<Array<{ site_id: string | null }>>(
        `/members?org_id=eq.${enc(orgId)}&status=eq.active&role=neq.kiosk&site_id=not.is.null&select=site_id&limit=50000`), 'count staff') ?? [];
      const out: Record<string, number> = {};
      for (const m of rows) if (m.site_id) out[m.site_id] = (out[m.site_id] ?? 0) + 1;
      return out;
    },
    async ownerEmails(orgId) {
      const rows = ok(await db.rest<Array<{ email: string }>>(`/members?org_id=eq.${enc(orgId)}&status=eq.active&role=in.(owner,hq_admin)&select=email&limit=50`), 'owner emails') ?? [];
      return [...new Set(rows.map((r) => r.email))];
    },
    async claimEvent(id, type) {
      const r = await db.rest<Array<{ id: string }>>('/stripe_events?on_conflict=id&select=id,processed_at', {
        method: 'POST', headers: { Prefer: 'return=representation,resolution=ignore-duplicates' }, body: { id, type },
      });
      if (r.status >= 300) throw new Error(`billing store: claim event failed (${r.status})`);
      if (Array.isArray(r.data) && r.data.length) return 'new';
      // already seen: if a previous attempt crashed before finishing, let this delivery try again
      const seen = ok(await db.rest<Array<{ processed_at: string | null }>>(`/stripe_events?id=eq.${enc(id)}&select=processed_at&limit=1`), 'read event');
      return seen[0] && seen[0].processed_at === null ? 'new' : 'duplicate';
    },
    async markEventProcessed(id) {
      ok(await db.rest(`/stripe_events?id=eq.${enc(id)}`, { method: 'PATCH', body: { processed_at: new Date().toISOString() } }), 'mark event');
    },
    async releaseEvent(id) {
      await db.rest(`/stripe_events?id=eq.${enc(id)}&processed_at=is.null`, { method: 'DELETE' });
    },
    async bumpUsage(siteId, month) {
      const r = await db.rest<number>('/rpc/usage_bump', { method: 'POST', body: { p_site: siteId, p_month: month } });
      return Number(ok(r, 'bump usage'));
    },
    async listUsage(orgId, month) {
      const sites = await this.listSites(orgId);
      if (!sites.length) return [];
      const ids = sites.map((s) => enc(s.id)).join(',');
      return ok(await db.rest<UsageRow[]>(`/usage_monthly?month=eq.${month}&site_id=in.(${ids})&select=site_id,ai_questions,flagged_at`), 'list usage') ?? [];
    },
    async flagUsage(siteId, month) {
      const r = await db.rest<UsageRow[]>(`/usage_monthly?site_id=eq.${enc(siteId)}&month=eq.${month}&flagged_at=is.null&select=site_id`, {
        method: 'PATCH', headers: rep, body: { flagged_at: new Date().toISOString() },
      });
      return r.status < 300 && Array.isArray(r.data) && r.data.length > 0;
    },
  };
}
