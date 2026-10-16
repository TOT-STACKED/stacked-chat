import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { parseStaff } from '../src/modules/console/routes.js';
import { npsSummary, scrubSample, vendorIntelligence } from '../src/modules/console/intel.js';
import { createConsole } from '../src/modules/console/service.js';
import { FakeBillingStore } from '../src/testing/billing-fakes.js';
import { FakeConsoleStore } from '../src/testing/console-fakes.js';
import { FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { testConfig } from './helpers.js';

const NOW = new Date('2026-10-16T12:00:00Z');
const day = 86_400_000;
const iso = (d: number) => new Date(NOW.getTime() + d * day).toISOString();
const IDK = "I don't have that in your knowledge base yet.";

describe('vendor intelligence', () => {
  it('counts mentions, conversations, problem types and a few examples per partner', () => {
    const convs = [
      ['my lightspeed till is offline again', 'lightspeed printer not printing'],
      ['square reader will not connect'],
      ['what time do we open'],
    ];
    const r = vendorIntelligence(convs, []);
    const ls = r.find((v) => v.vendor === 'Lightspeed')!;
    expect(ls).toMatchObject({ mentions: 2, conversations: 1, category: 'POS' });
    expect(ls.problems.map((p) => p.label)).toEqual(expect.arrayContaining(['Connection / offline', 'Printing']));
    expect(r.find((v) => v.vendor === 'Square')!.mentions).toBe(1);
    expect(r.some((v) => v.vendor === 'Deputy')).toBe(false); // nobody mentioned it
  });
  it('merges ratings, and a vendor with only ratings still appears', () => {
    const r = vendorIntelligence([], [{ vendor: 'sky', score: 9, comment: null, created_at: iso(-1) }, { vendor: 'dojo', score: 3, comment: null, created_at: iso(-1) }, { vendor: 'dojo', score: 10, comment: null, created_at: iso(-1) }]);
    expect(r.find((v) => v.vendor === 'Dojo')!.nps).toMatchObject({ count: 2, avg: 6.5, promoters: 1, detractors: 1, nps: 0 });
    expect(npsSummary([])).toBeNull();
    expect(npsSummary([10, 9, 8, 6, 2])).toMatchObject({ promoters: 2, passive: 1, detractors: 2, nps: 0 });
  });
  it('removes emails and phone numbers from example questions', () => {
    expect(scrubSample('email me at amy@acme.com or call 07700 900123 about the till')).toBe('email me at [email] or call [number] about the till');
    expect(scrubSample('x'.repeat(300)).length).toBe(148);
  });
  it('knows who is staff from the env list', () => {
    expect([...parseStaff(' Chris@Stacked.io, ops@stacked.io;bad, ,another@x.co ')].sort()).toEqual(['another@x.co', 'chris@stacked.io', 'ops@stacked.io']);
    expect(parseStaff(undefined).size).toBe(0);
  });
});

describe('the Console service', () => {
  let cs: FakeConsoleStore; let bs: FakeBillingStore; let svc: ReturnType<typeof createConsole>;
  const A = 'org-a'; const B = 'org-b'; const C = 'org-c';
  let a1: string; let a2: string; let b1: string;
  beforeEach(async () => {
    cs = new FakeConsoleStore(); bs = new FakeBillingStore();
    cs.orgRows = [{ id: A, name: 'Acme', slug: 'acme', created_at: iso(-60) }, { id: B, name: 'Bistro Group', slug: 'bistro', created_at: iso(-20) }, { id: C, name: 'Cafe Solo', slug: 'cafe', created_at: iso(-3) }];
    const mk = (org: string, name: string, extra: object = {}) => { const s = { id: randomUUID(), org_id: org, name, created_at: iso(-10), billing_tier: 'standard' as const, active: true, ...extra }; cs.siteRows.push(s); return s.id; };
    a1 = mk(A, 'Acme North'); a2 = mk(A, 'Acme South'); b1 = mk(B, 'Bistro One'); mk(C, 'Cafe');
    cs.memberRows = [{ org_id: A, site_id: a1, email: 'amy@acme.com', display_name: 'Amy', role: 'staff', status: 'active' }, { org_id: A, site_id: null, email: 'boss@acme.com', display_name: null, role: 'owner', status: 'active' }, { org_id: B, site_id: b1, email: 'bo@bistro.com', display_name: null, role: 'owner', status: 'invited' }];
    const conv = (site: string, q: string, a: string, at = iso(-1)) => cs.convRows.push({ id: cs.convRows.length + 1, venue_id: site, email: 'x@y.z', created_at: at, messages: [{ role: 'user', content: q }, { role: 'assistant', content: a }] });
    conv(a1, 'my lightspeed till is offline', 'Restart it.'); conv(a1, 'where is the staff meal policy', IDK); conv(b1, 'where is the staff meal policy', IDK); conv(b1, 'old question about holidays', IDK, iso(-50));
    await bs.saveAccount(A, { stripe_customer_id: 'cus_a', stripe_subscription_id: 'sub_a', status: 'active', interval: 'month', has_payment_method: true });
    await bs.saveAccount(B, { stripe_customer_id: 'cus_b', stripe_subscription_id: 'sub_b', status: 'trialing', interval: 'year', has_payment_method: false, trial_ends_at: iso(3) });
    svc = createConsole({ store: cs, billing: bs, fairUse: { aiQuestionsPerMonth: 2000, staffPerVenue: 75 }, now: () => NOW });
  });

  it('summarises customers, billing health, revenue and growth', async () => {
    const o = await svc.overview(30);
    expect(o).toMatchObject({ customers: 3, venues: 4, people: 2 });
    expect(o.billing.by_status).toMatchObject({ active: 1, trialing: 1, unmanaged: 1 });
    expect(o.billing.mrr_pence).toBe(2 * 4500); // Acme: two standard venues, monthly
    expect(o.billing.trial_pipeline_pence).toBe(3750); // Bistro: one venue on a yearly plan (£450) shown per month
    expect(o.usage).toMatchObject({ questions: 3, unanswered: 2, active_customers: 2 });
    expect(o.growth).toHaveLength(6);
    expect(o.growth.at(-1)!.month).toBe('2026-10');
  });
  it('flags what needs a human: trial ending without a card, payment trouble, going over guides', async () => {
    const o = await svc.overview(30);
    expect(o.attention.find((x) => x.name === 'Bistro Group')!.flags).toContain('Trial ends soon, no card');
    await bs.saveAccount(A, { status: 'past_due', past_due_since: iso(-9) });
    cs.usageRows = [{ site_id: a1, ai_questions: 2500, flagged_at: null }];
    cs.memberRows.push(...Array.from({ length: 76 }, (_, i) => ({ org_id: A, site_id: a1, email: `s${i}@acme.com`, display_name: null, role: 'staff', status: 'active' })));
    const flags = (await svc.customers(30)).data.find((c) => c.name === 'Acme')!.flags;
    expect(flags).toEqual(expect.arrayContaining(['Payment overdue, read-only', 'Over AI question guide', 'Over staff guide']));
  });
  it('lists customers with attention first, then busiest', async () => {
    const { data } = await svc.customers(30);
    expect(data[0]!.name).toBe('Bistro Group'); // flagged
    expect(data.find((c) => c.name === 'Acme')).toMatchObject({ venues: 2, people: 2, questions: 2, unanswered: 1, billing: { status: 'active', monthly_pence: 9000 } });
    expect(data.find((c) => c.name === 'Cafe Solo')!.billing.mode).toBe('unmanaged');
  });
  it('opens one customer with venues, people and its own unanswered questions', async () => {
    const c = await svc.customer(A, 30);
    expect(c.sites.map((s) => [s.name, s.questions])).toEqual([['Acme North', 2], ['Acme South', 0]]);
    expect(c.members.map((m) => m.email).sort()).toEqual(['amy@acme.com', 'boss@acme.com']);
    expect(c.top_unanswered).toEqual([{ question: 'where is the staff meal policy', count: 1 }]);
    await expect(svc.customer('nope', 30)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('finds questions unanswered across customers (the same wording counts together)', async () => {
    const g = await svc.gaps(30);
    expect(g.data[0]).toMatchObject({ question: 'where is the staff meal policy', count: 2, customers: 2 });
    expect(g.data.some((x) => x.question.includes('holidays'))).toBe(false); // outside the 30-day window
    expect((await svc.gaps(90)).data.some((x) => x.question.includes('holidays'))).toBe(true);
  });
  it('reads vendors from every customer\'s conversations', async () => {
    const v = await svc.vendors(30);
    expect(v.data.find((x) => x.vendor === 'Lightspeed')!.mentions).toBe(1);
  });
  it('rejects odd windows', async () => { await expect(svc.overview(12)).rejects.toMatchObject({ statusCode: 400 }); });
});

describe('Console API: staff only', () => {
  let app: FastifyInstance; let repo: FakeRepo;
  const U = { staff: randomUUID(), owner: randomUUID(), nobody: randomUUID() };
  const mk = async (staff: string | undefined) => {
    repo = new FakeRepo(); const org = repo.addOrg('Acme'); repo.addSite(org, 'North'); repo.addMember(org, 'owner@acme.com', 'owner', null, U.owner);
    const cs = new FakeConsoleStore(); cs.orgRows = [{ id: org.id, name: 'Acme', slug: 'acme', created_at: iso(-5) }];
    return buildApp({ ...testConfig, STACKED_STAFF_EMAILS: staff }, { repo, consoleStore: cs, billingStore: new FakeBillingStore(), now: () => NOW,
      verifyToken: fakeVerifier({ s: { userId: U.staff, email: 'Chris@Stacked.io' }, o: { userId: U.owner, email: 'owner@acme.com' }, n: { userId: U.nobody, email: 'nobody@x.co' } }) });
  };
  const get = (url: string, t?: string) => app.inject({ method: 'GET', url, headers: t ? { authorization: 'Bearer ' + t } : {} });
  const paths = ['/api/v1/console/me', '/api/v1/console/overview', '/api/v1/console/customers', '/api/v1/console/vendors', '/api/v1/console/gaps'];

  beforeEach(async () => { app = await mk('chris@stacked.io'); });
  it('staff (by verified email, any case) see everything', async () => {
    for (const p of paths) expect((await get(p, 's')).statusCode, p).toBe(200);
    expect((await get('/api/v1/console/me', 's')).json()).toEqual({ staff: true, email: 'Chris@Stacked.io' });
  });
  it('customers, even a company owner, are turned away; so are strangers and anonymous callers', async () => {
    for (const p of paths) { expect((await get(p, 'o')).statusCode, p).toBe(403); expect((await get(p, 'n')).statusCode, p).toBe(403); expect((await get(p)).statusCode, p).toBe(401); }
    const org = repo.orgs[0]!;
    expect((await get(`/api/v1/console/customers/${org.id}`, 'o')).statusCode).toBe(403);
    expect((await get(`/api/v1/console/customers/${org.id}`, 's')).statusCode).toBe(200);
  });
  it('is closed to everyone when no staff are configured', async () => {
    app = await mk(undefined);
    for (const p of paths) expect((await get(p, 's')).statusCode, p).toBe(403);
  });
  it('API keys cannot reach it', async () => {
    const created = await app.inject({ method: 'POST', url: `/api/v1/orgs/${repo.orgs[0]!.id}/api-keys`, headers: { authorization: 'Bearer o' }, payload: { name: 'k', scopes: ['sites:read'] } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/console/overview', headers: { 'x-api-key': created.json().key } })).statusCode).toBe(403);
  });
  it('serves the page with a strict policy, kept out of search engines', async () => {
    const page = await get('/console/');
    expect(page.statusCode).toBe(200); expect(page.headers['content-security-policy']).toContain("script-src 'self'"); expect(page.headers['x-robots-tag']).toBe('noindex');
    expect(Object.keys((await get('/console/config.json')).json()).sort()).toEqual(['anonKey', 'dev', 'supabaseUrl']);
  });
});
