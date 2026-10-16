import { badRequest, notFound } from '../../lib/errors.js';
import { billingState } from '../billing/gating.js';
import { priceFor } from '../billing/pricing.js';
import type { AccountRow, BillingStore } from '../billing/store.js';
import { monthKey } from '../billing/usage.js';
import { extractAsks, groupAsks, unansweredGroups, type Ask, type Conversation } from '../insights/analyze.js';
import { vendorIntelligence, type VendorIntel } from './intel.js';
import type { ConsoleStore, MemberLite, OrgRow, SiteRow } from './store.js';

export interface ConsoleDeps {
  store: ConsoleStore;
  billing: Pick<BillingStore, 'listAccounts' | 'getAccount'>;
  fairUse: { aiQuestionsPerMonth: number; staffPerVenue: number };
  now?: () => Date;
}

const DAY = 86_400_000;
export const WINDOWS = [7, 30, 90] as const;
const monthlyPence = (a: AccountRow, sites: SiteRow[]) => { const t = priceFor(sites, a.interval).total_pence; return a.interval === 'year' ? Math.round(t / 12) : t; };

export function createConsole(deps: ConsoleDeps) {
  const { store } = deps;
  const now = () => (deps.now ?? (() => new Date()))();

  /** One load of everything, shared by every view (this is a small, internal tool). */
  async function load(days: number) {
    if (!(WINDOWS as readonly number[]).includes(days)) throw badRequest('days must be 7, 30 or 90');
    const since = new Date(now().getTime() - days * DAY).toISOString();
    const [orgs, sites, members, accounts, usage, convs, nps] = await Promise.all([
      store.orgs(), store.sites(), store.members(), deps.billing.listAccounts(), store.usage(monthKey(now())), store.conversations(since), store.nps(since),
    ]);
    const orgOfSite = new Map(sites.map((s) => [s.id, s.org_id]));
    return { orgs, sites, members, accounts: new Map(accounts.map((a) => [a.org_id, a])), usage: new Map(usage.map((u) => [u.site_id, u])), convs, nps, orgOfSite, since };
  }
  type Data = Awaited<ReturnType<typeof load>>;

  const sitesOf = (d: Data, orgId: string) => d.sites.filter((s) => s.org_id === orgId);
  const liveStaff = (m: MemberLite) => m.status === 'active' && m.role !== 'kiosk';
  const asksOf = (d: Data, convs: Conversation[]) => extractAsks(convs);
  const orgConvs = (d: Data, orgId: string) => d.convs.filter((c) => c.venue_id && d.orgOfSite.get(c.venue_id) === orgId);

  /** What needs a human at Stacked to look at it. */
  function flagsFor(d: Data, org: OrgRow): string[] {
    const flags: string[] = []; const acc = d.accounts.get(org.id); const t = now();
    const state = billingState(acc ?? null, t);
    if (acc?.status === 'past_due') flags.push(state.mode === 'restricted' ? 'Payment overdue, read-only' : 'Payment failed');
    if (acc?.status === 'trialing' && !acc.has_payment_method && acc.trial_ends_at) {
      const left = (new Date(acc.trial_ends_at).getTime() - t.getTime()) / DAY;
      if (left <= 7 && left > 0) flags.push('Trial ends soon, no card'); else if (left <= 0) flags.push('Trial ended, no card');
    }
    if (acc?.status === 'canceled') flags.push('Cancelled');
    const sites = sitesOf(d, org.id);
    if (sites.some((s) => s.active && (d.usage.get(s.id)?.ai_questions ?? 0) > deps.fairUse.aiQuestionsPerMonth)) flags.push('Over AI question guide');
    const staffBySite = new Map<string, number>();
    for (const m of d.members) if (m.org_id === org.id && m.site_id && liveStaff(m)) staffBySite.set(m.site_id, (staffBySite.get(m.site_id) ?? 0) + 1);
    if (sites.some((s) => s.active && s.billing_tier === 'standard' && (staffBySite.get(s.id) ?? 0) > deps.fairUse.staffPerVenue)) flags.push('Over staff guide');
    return flags;
  }

  function customerRow(d: Data, org: OrgRow) {
    const sites = sitesOf(d, org.id); const acc = d.accounts.get(org.id); const t = now();
    const asks = asksOf(d, orgConvs(d, org.id));
    const pricing = priceFor(sites, acc?.interval ?? 'month');
    return {
      id: org.id, name: org.name, created_at: org.created_at,
      venues: sites.filter((s) => s.active).length, venues_total: sites.length,
      people: d.members.filter((m) => m.org_id === org.id && m.status === 'active').length,
      billing: acc ? { status: acc.status, mode: billingState(acc, t).mode, interval: acc.interval, trial_ends_at: acc.trial_ends_at, has_card: acc.has_payment_method, monthly_pence: monthlyPence(acc, sites) } : { status: null, mode: 'unmanaged' as const, interval: null, trial_ends_at: null, has_card: false, monthly_pence: 0 },
      would_pay_monthly_pence: pricing.interval === 'year' ? Math.round(pricing.total_pence / 12) : pricing.total_pence,
      questions: asks.length, unanswered: asks.filter((a) => a.unanswered).length,
      last_question_at: asks.map((a) => a.at).sort().at(-1) ?? null,
      flags: flagsFor(d, org),
    };
  }

  async function overview(days: number) {
    const d = await load(days);
    const t = now();
    const rows = d.orgs.map((o) => customerRow(d, o));
    const asks = asksOf(d, d.convs);
    const byStatus = { trialing: 0, active: 0, past_due: 0, paused: 0, canceled: 0, unmanaged: 0 };
    for (const r of rows) { if (r.billing.status) byStatus[r.billing.status as keyof typeof byStatus]++; else byStatus.unmanaged++; }
    const mrr = rows.filter((r) => r.billing.status === 'active').reduce((n, r) => n + r.billing.monthly_pence, 0);
    const pipeline = rows.filter((r) => r.billing.status === 'trialing').reduce((n, r) => n + r.would_pay_monthly_pence, 0);
    const monthStart = (back: number) => { const x = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - back, 1)); return x; };
    const growth = Array.from({ length: 6 }, (_, i) => {
      const from = monthStart(5 - i); const to = monthStart(4 - i);
      const within = (iso: string | null) => !!iso && new Date(iso) >= from && new Date(iso) < to;
      return { month: from.toISOString().slice(0, 7), customers: d.orgs.filter((o) => within(o.created_at)).length, venues: d.sites.filter((s) => within(s.created_at)).length };
    });
    const attention = rows.filter((r) => r.flags.length).map((r) => ({ id: r.id, name: r.name, flags: r.flags })).sort((a, b) => b.flags.length - a.flags.length);
    return {
      days, customers: d.orgs.length, venues: d.sites.filter((s) => s.active).length,
      people: d.members.filter((m) => m.status === 'active').length,
      billing: { by_status: byStatus, mrr_pence: mrr, trial_pipeline_pence: pipeline },
      usage: { questions: asks.length, unanswered: asks.filter((a) => a.unanswered).length, active_customers: rows.filter((r) => r.questions > 0).length, conversations: d.convs.length, truncated: d.convs.length >= 5000 },
      growth, attention,
    };
  }

  async function customers(days: number) {
    const d = await load(days);
    return { days, data: d.orgs.map((o) => customerRow(d, o)).sort((a, b) => b.flags.length - a.flags.length || b.questions - a.questions || a.name.localeCompare(b.name)) };
  }

  async function customer(orgId: string, days: number) {
    const d = await load(days);
    const org = d.orgs.find((o) => o.id === orgId);
    if (!org) throw notFound('Customer not found');
    const row = customerRow(d, org); const sites = sitesOf(d, orgId);
    const asks = asksOf(d, orgConvs(d, orgId));
    const staffBySite = new Map<string, number>();
    for (const m of d.members) if (m.org_id === orgId && m.site_id && liveStaff(m)) staffBySite.set(m.site_id, (staffBySite.get(m.site_id) ?? 0) + 1);
    const siteName = new Map(sites.map((s) => [s.id, s.name]));
    const acc = d.accounts.get(orgId) ?? null;
    return {
      ...row,
      account: acc ? { status: acc.status, interval: acc.interval, trial_ends_at: acc.trial_ends_at, has_card: acc.has_payment_method, past_due_since: acc.past_due_since, canceled_at: acc.canceled_at, stripe_customer_id: acc.stripe_customer_id } : null,
      sites: sites.map((s) => ({
        id: s.id, name: s.name, billing_tier: s.billing_tier, active: s.active, created_at: s.created_at,
        ai_questions_month: d.usage.get(s.id)?.ai_questions ?? 0, active_staff: staffBySite.get(s.id) ?? 0,
        questions: asks.filter((a) => a.site_id === s.id).length,
      })),
      members: d.members.filter((m) => m.org_id === orgId).map((m) => ({ email: m.email, name: m.display_name, role: m.role, status: m.status, site: m.site_id ? siteName.get(m.site_id) ?? null : null })),
      top_unanswered: unansweredGroups(asks).slice(0, 10).map((g) => ({ question: g.question, count: g.count })),
    };
  }

  async function vendors(days: number): Promise<{ days: number; data: VendorIntel[]; ratings: number }> {
    const d = await load(days);
    const perConv = d.convs.map((c) => (Array.isArray(c.messages) ? c.messages : []).filter((m) => m.role === 'user').map((m) => String(m.content ?? '').toLowerCase()));
    return { days, data: vendorIntelligence(perConv, d.nps), ratings: d.nps.length };
  }

  /** Questions the AI could not answer, across every customer: what to teach the playbook next. */
  async function gaps(days: number) {
    const d = await load(days);
    const asks: Ask[] = asksOf(d, d.convs).filter((a) => a.unanswered).map((a) => ({ ...a, email: null }));
    const customersBy = new Map<string, Set<string>>();
    for (const a of asks) { const org = a.site_id ? d.orgOfSite.get(a.site_id) : undefined; if (org) { const s = customersBy.get(a.key) ?? new Set(); s.add(org); customersBy.set(a.key, s); } }
    const groups = groupAsks(asks);
    return { days, total: asks.length, data: groups.slice(0, 40).map((g) => ({ question: g.question, count: g.count, customers: customersBy.get(g.key)?.size ?? 0, last_asked: g.last_asked })) };
  }

  return { overview, customers, customer, vendors, gaps };
}
export type ConsoleService = ReturnType<typeof createConsole>;
