import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadBillingConfig } from '../src/modules/billing/config.js';
import { signWebhook } from '../src/modules/billing/stripe.js';
import { FakeBillingStore, FakeStripe, testBillingConfig } from '../src/testing/billing-fakes.js';
import { FakeMailer, FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { testConfig } from './helpers.js';

const cfg = testBillingConfig();
const P = cfg.prices;
const billingEnv = {
  ...testConfig,
  STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_test',
  STRIPE_PRICE_STANDARD_MONTHLY: P.standard.month, STRIPE_PRICE_STANDARD_ANNUAL: P.standard.year,
  STRIPE_PRICE_GROUP_MONTHLY: P.group.month, STRIPE_PRICE_GROUP_ANNUAL: P.group.year,
  STRIPE_PRICE_LARGE_MONTHLY: P.large.month, STRIPE_PRICE_LARGE_ANNUAL: P.large.year,
  CRON_SECRET: 'cron-secret',
};

let repo: FakeRepo; let store: FakeBillingStore; let stripe: FakeStripe; let mailer: FakeMailer; let app: FastifyInstance;
let acme: ReturnType<FakeRepo['addOrg']>;
const tiers = new Map<string, 'standard' | 'large'>();
const U = { owner: randomUUID(), hq: randomUUID(), mgr: randomUUID(), staff: randomUUID() };
const tok = { owner: 'tok-owner', hq: 'tok-hq', mgr: 'tok-mgr', staff: 'tok-staff' } as const;
type Who = keyof typeof tok;

async function world(env: Record<string, unknown> = billingEnv) {
  repo = new FakeRepo(); store = new FakeBillingStore(); stripe = new FakeStripe(cfg); mailer = new FakeMailer();
  acme = repo.addOrg('Acme'); const north = repo.addSite(acme, 'North');
  repo.addMember(acme, 'owner@acme.com', 'owner', null, U.owner);
  repo.addMember(acme, 'hq@acme.com', 'hq_admin', null, U.hq);
  repo.addMember(acme, 'mgr@acme.com', 'site_manager', north, U.mgr);
  repo.addMember(acme, 'staff@acme.com', 'staff', north, U.staff);
  // billing reads the same venues the identity API creates
  store.listSites = async (orgId) => repo.sites.filter((s) => s.org_id === orgId).map((s) => ({ id: s.id, org_id: s.org_id, name: s.name, billing_tier: tiers.get(s.id) ?? 'standard', active: true }));
  const asBilling = (id: string) => { const x = repo.sites.find((q) => q.id === id); return x ? { id: x.id, org_id: x.org_id, name: x.name, billing_tier: tiers.get(x.id) ?? 'standard' as const, active: true } : null; };
  store.getSite = async (id) => asBilling(id);
  store.updateSite = async (id, patch) => { if (patch.billing_tier) tiers.set(id, patch.billing_tier); return asBilling(id)!; };
  store.ownerEmails = async () => ['owner@acme.com'];
  app = await buildApp(env as typeof testConfig, {
    repo, mailer, stripe, billingStore: store,
    verifyToken: fakeVerifier({
      [tok.owner]: { userId: U.owner, email: 'owner@acme.com' }, [tok.hq]: { userId: U.hq, email: 'hq@acme.com' },
      [tok.mgr]: { userId: U.mgr, email: 'mgr@acme.com' }, [tok.staff]: { userId: U.staff, email: 'staff@acme.com' },
    }),
  });
}
beforeEach(() => world());

async function call(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, who: Who, body?: unknown) {
  const res = await app.inject({ method, url, headers: { authorization: 'Bearer ' + tok[who] }, payload: body as object | undefined });
  return { status: res.statusCode, body: res.json() as any };
}
const B = (p: string) => `/api/v1/orgs/${acme.id}/billing/${p}`;

async function webhook(event: object, opts: { secret?: string; header?: string } = {}) {
  const raw = JSON.stringify(event);
  const res = await app.inject({
    method: 'POST', url: '/billing/webhook', payload: raw,
    headers: { 'content-type': 'application/json', 'stripe-signature': opts.header ?? signWebhook(raw, opts.secret ?? 'whsec_test') },
  });
  return { status: res.statusCode, body: res.json() as any };
}
const ev = (type: string, object: Record<string, unknown>, id = 'evt_' + randomUUID().slice(0, 8)) => ({ id, type, created: Math.floor(Date.now() / 1000), data: { object } });

describe('fails closed', () => {
  it('without Stripe settings every billing endpoint says 503 and the rest of the API still works', async () => {
    await world(testConfig);
    for (const [m, u] of [['GET', B('summary')], ['POST', B('checkout')], ['POST', B('portal')]] as const) {
      const r = await call(m, u, 'owner', m === 'POST' ? {} : undefined);
      expect(r.status, u).toBe(503);
      expect(r.body.error.code).toBe('billing_not_configured');
      expect(r.body.error.message).toContain('STRIPE_SECRET_KEY');
    }
    expect((await webhook(ev('invoice.paid', {}))).status).toBe(503);
    expect((await call('GET', `/api/v1/orgs/${acme.id}/members`, 'owner')).status).toBe(200);
    expect((await call('POST', `/api/v1/orgs/${acme.id}/sites`, 'owner', { name: 'New place' })).status).toBe(201); // no billing = no gate
  });
  it('a missing price id is enough to switch billing off, naming the variable and never a value', () => {
    const r = loadBillingConfig({ ...billingEnv, STRIPE_PRICE_LARGE_ANNUAL: undefined } as never);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toContain('STRIPE_PRICE_LARGE_ANNUAL'); expect(r.reason).not.toContain('sk_test'); }
  });
  it('refuses a live key unless STRIPE_ALLOW_LIVE=true (test mode only)', () => {
    const live = { ...billingEnv, STRIPE_SECRET_KEY: 'sk_live_abc' } as never;
    const r = loadBillingConfig(live);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toContain('sk_live_abc');
    expect(loadBillingConfig({ ...billingEnv, STRIPE_SECRET_KEY: 'sk_live_abc', STRIPE_ALLOW_LIVE: 'true' } as never).ok).toBe(true);
  });
});

describe('who may use billing', () => {
  it('owners and HQ admins yes; site managers, staff and API keys no', async () => {
    expect((await call('GET', B('summary'), 'owner')).status).toBe(200);
    expect((await call('GET', B('summary'), 'hq')).status).toBe(200);
    expect((await call('GET', B('summary'), 'mgr')).status).toBe(403);
    expect((await call('GET', B('summary'), 'staff')).status).toBe(403);
    expect((await call('POST', B('checkout'), 'mgr', {})).status).toBe(403);
    expect((await call('POST', B('portal'), 'staff')).status).toBe(403);
  });
  it('strangers get 404, not a hint that the organisation exists', async () => {
    const stranger = randomUUID(); repo.addMember(acme, 'x@y.com', 'staff', null, stranger);
    const other = repo.addOrg('Other');
    const res = await app.inject({ method: 'GET', url: `/api/v1/orgs/${other.id}/billing/summary`, headers: { authorization: 'Bearer ' + tok.owner } });
    expect(res.statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: B('summary') })).statusCode).toBe(401);
  });
});

describe('trial -> card -> fifth venue -> £39', () => {
  it('walks the whole journey', async () => {
    // four venues, a trial with no card
    for (const n of ['South', 'East', 'West']) repo.addSite(acme, n);
    expect(repo.sites).toHaveLength(4);
    const started = await call('POST', B('checkout'), 'owner', { interval: 'month' });
    expect(started.body).toMatchObject({ action: 'trial_started' });
    const sub = (await store.getAccount(acme.id))!.stripe_subscription_id!;
    let s = (await call('GET', B('summary'), 'owner')).body;
    expect(s.state).toMatchObject({ mode: 'full', trial_days_left: 30 });
    expect(s.pricing).toMatchObject({ group_rate: false, total_pence: 18000 });

    // add a card (Stripe Checkout in setup mode, then its completion webhook)
    const checkout = await call('POST', B('checkout'), 'owner', { interval: 'month' });
    expect(checkout.body).toEqual({ action: 'redirect', url: 'https://checkout.stripe.test/session' });
    const done = await webhook(ev('checkout.session.completed', {
      mode: 'setup', customer: (await store.getAccount(acme.id))!.stripe_customer_id, setup_intent: 'seti_1', metadata: { org_id: acme.id },
    }));
    expect(done.body.result).toBe('processed');
    s = (await call('GET', B('summary'), 'owner')).body;
    expect(s.account.has_card).toBe(true);
    expect(s.state.banner).toBeNull();

    // a fifth venue: the sites endpoint kicks off the sync, every venue moves to £39
    expect((await call('POST', `/api/v1/orgs/${acme.id}/sites`, 'owner', { name: 'Fifth' })).status).toBe(201);
    await new Promise((r) => setTimeout(r, 20));
    expect(stripe.qty(sub, P.group.month)).toBe(5);
    expect(stripe.qty(sub, P.standard.month)).toBe(0);
    s = (await call('GET', B('summary'), 'owner')).body;
    expect(s.pricing).toMatchObject({ group_rate: true, total_pence: 19500 });
    expect(s.pricing.lines[0]).toMatchObject({ label: 'Group', quantity: 5, unit_pence: 3900 });
  });
  it('the portal opens once there is a customer', async () => {
    expect((await call('POST', B('portal'), 'owner')).status).toBe(409);
    await call('POST', B('checkout'), 'owner', { interval: 'year' });
    expect((await call('POST', B('portal'), 'owner')).body).toEqual({ url: 'https://billing.stripe.test/portal' });
  });
  it('a venue can be made large or switched off through the API (owner/HQ only)', async () => {
    await call('POST', B('checkout'), 'owner', {});
    const north = repo.sites[0]!;
    expect((await call('PATCH', `/api/v1/orgs/${acme.id}/sites/${north.id}/billing`, 'mgr', { billing_tier: 'large' })).status).toBe(403);
    expect((await call('PATCH', `/api/v1/orgs/${acme.id}/sites/${north.id}/billing`, 'owner', {})).status).toBe(400);
    const r = await call('PATCH', `/api/v1/orgs/${acme.id}/sites/${north.id}/billing`, 'hq', { billing_tier: 'large' });
    expect(r.status).toBe(200);
    expect(r.body.billing_tier).toBe('large');
  });
});

describe('POST /billing/webhook', () => {
  it('rejects a bad, missing, stale or tampered signature (400) and does nothing', async () => {
    const e = ev('invoice.payment_failed', { customer: 'cus_x' });
    expect((await webhook(e, { secret: 'whsec_wrong' })).status).toBe(400);
    expect((await webhook(e, { header: 'nonsense' })).status).toBe(400);
    const raw = JSON.stringify(e);
    expect((await app.inject({ method: 'POST', url: '/billing/webhook', payload: raw, headers: { 'content-type': 'application/json' } })).statusCode).toBe(400);
    expect((await webhook(e, { header: signWebhook(raw, 'whsec_test', Math.floor(Date.now() / 1000) - 3600) })).status).toBe(400);
    const tampered = await app.inject({ method: 'POST', url: '/billing/webhook', payload: raw.replace('cus_x', 'cus_y'), headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(raw, 'whsec_test') } });
    expect(tampered.statusCode).toBe(400);
    expect(store.events.size).toBe(0);
  });

  async function trialing() {
    await call('POST', B('checkout'), 'owner', {});
    return (await store.getAccount(acme.id))!;
  }

  it('processes each event once: a redelivery is acknowledged but not re-run', async () => {
    const a = await trialing();
    const e = ev('invoice.payment_failed', { customer: a.stripe_customer_id }, 'evt_same');
    expect((await webhook(e)).body.result).toBe('processed');
    const firstSince = (await store.getAccount(acme.id))!.past_due_since;
    await store.saveAccount(acme.id, { past_due_since: '2020-01-01T00:00:00.000Z' }); // detect any re-run
    const again = await webhook(e);
    expect(again.status).toBe(200);
    expect(again.body.result).toBe('duplicate');
    expect((await store.getAccount(acme.id))!.past_due_since).toBe('2020-01-01T00:00:00.000Z');
    expect(firstSince).not.toBeNull();
  });

  it('invoice.payment_failed -> past_due with the clock started; invoice.paid -> active and cleared', async () => {
    const a = await trialing();
    await webhook(ev('invoice.payment_failed', { customer: a.stripe_customer_id }));
    let acc = (await store.getAccount(acme.id))!;
    expect(acc.status).toBe('past_due'); expect(acc.past_due_since).not.toBeNull();
    // a second failure does not restart the 7 days
    const since = acc.past_due_since;
    await webhook(ev('invoice.payment_failed', { customer: a.stripe_customer_id }));
    expect((await store.getAccount(acme.id))!.past_due_since).toBe(since);
    await webhook(ev('invoice.paid', { customer: a.stripe_customer_id }));
    acc = (await store.getAccount(acme.id))!;
    expect(acc).toMatchObject({ status: 'active', past_due_since: null });
  });

  it('customer.subscription.updated/deleted follow Stripe', async () => {
    const a = await trialing();
    stripe.subs.get(a.stripe_subscription_id!)!.status = 'active';
    await webhook(ev('customer.subscription.updated', { id: a.stripe_subscription_id, customer: a.stripe_customer_id, metadata: { org_id: acme.id } }));
    expect((await store.getAccount(acme.id))!.status).toBe('active');
    await webhook(ev('customer.subscription.deleted', { id: a.stripe_subscription_id, customer: a.stripe_customer_id, status: 'canceled', metadata: { org_id: acme.id }, items: { data: [] } }));
    const acc = (await store.getAccount(acme.id))!;
    expect(acc.status).toBe('canceled'); expect(acc.canceled_at).not.toBeNull();
  });

  it('an out-of-date event cannot undo newer state (Stripe is re-read)', async () => {
    const a = await trialing();
    stripe.subs.get(a.stripe_subscription_id!)!.status = 'active';
    await webhook(ev('customer.subscription.updated', { id: a.stripe_subscription_id, status: 'trialing', customer: a.stripe_customer_id, metadata: { org_id: acme.id } }));
    expect((await store.getAccount(acme.id))!.status).toBe('active');
  });

  it('customer.subscription.trial_will_end emails the owners once, only if there is no card', async () => {
    const a = await trialing();
    const e = () => ev('customer.subscription.trial_will_end', { id: a.stripe_subscription_id, customer: a.stripe_customer_id, metadata: { org_id: acme.id } });
    await webhook(e()); await webhook(e());
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: 'owner@acme.com' });
    expect(mailer.sent[0]!.subject).toContain('trial');
    expect((await store.getAccount(acme.id))!.trial_reminder_sent_at).not.toBeNull();
  });

  it('trial_will_end sends nothing when a card is already saved', async () => {
    const a = await trialing(); await store.saveAccount(acme.id, { has_payment_method: true });
    await webhook(ev('customer.subscription.trial_will_end', { id: a.stripe_subscription_id, customer: a.stripe_customer_id, metadata: { org_id: acme.id } }));
    expect(mailer.sent).toHaveLength(0);
  });

  it('adding a card to a paused subscription (trial ended without one) resumes it', async () => {
    const a = await trialing();
    stripe.subs.get(a.stripe_subscription_id!)!.status = 'paused';
    await store.saveAccount(acme.id, { status: 'paused' });
    await webhook(ev('checkout.session.completed', { mode: 'setup', customer: a.stripe_customer_id, setup_intent: 'seti_2', metadata: { org_id: acme.id } }));
    expect(stripe.attached).toEqual([a.stripe_subscription_id]);
    expect((await store.getAccount(acme.id))).toMatchObject({ status: 'active', has_payment_method: true });
  });

  it('ignores event types it does not use, and events for unknown customers', async () => {
    expect((await webhook(ev('charge.succeeded', {}))).status).toBe(200);
    expect((await webhook(ev('invoice.paid', { customer: 'cus_unknown' }))).status).toBe(200);
    expect((await webhook(ev('customer.subscription.updated', { id: 'sub_x', customer: 'cus_unknown' }))).status).toBe(200);
  });

  it('a handler failure returns 500 and un-claims the event so Stripe retries it', async () => {
    const a = await trialing();
    store.saveAccount = async () => { throw new Error('db down'); };
    const e = ev('invoice.payment_failed', { customer: a.stripe_customer_id }, 'evt_retry');
    expect((await webhook(e)).status).toBe(500);
    expect(store.events.has('evt_retry')).toBe(false);
  });

  it('rejects bodies that are not JSON events', async () => {
    const raw = 'not json';
    const res = await app.inject({ method: 'POST', url: '/billing/webhook', payload: raw, headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(raw, 'whsec_test') } });
    expect(res.statusCode).toBe(400);
  });
});

describe('access gating through the API', () => {
  async function lapse() {
    await call('POST', B('checkout'), 'owner', {});
    await store.saveAccount(acme.id, { status: 'past_due', past_due_since: new Date(Date.now() - 8 * 86_400_000).toISOString() });
  }
  it('inside the 7-day grace window everything still works and admins see a banner', async () => {
    await call('POST', B('checkout'), 'owner', {});
    await store.saveAccount(acme.id, { status: 'past_due', past_due_since: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    expect((await call('POST', `/api/v1/orgs/${acme.id}/members`, 'owner', { emails: ['new@acme.com'], role: 'staff' })).status).not.toBe(402);
    expect((await call('GET', B('summary'), 'owner')).body.state).toMatchObject({ mode: 'grace', banner: 'past_due' });
  });
  it('after the grace period admins can read everything but changes are refused (402)', async () => {
    await lapse();
    expect((await call('GET', `/api/v1/orgs/${acme.id}/members`, 'owner')).status).toBe(200);
    expect((await call('GET', `/api/v1/orgs/${acme.id}/sites`, 'hq')).status).toBe(200);
    const blocked = await call('POST', `/api/v1/orgs/${acme.id}/sites`, 'owner', { name: 'Blocked' });
    expect(blocked.status).toBe(402);
    expect(blocked.body.error.code).toBe('billing_required');
    expect((await call('POST', `/api/v1/orgs/${acme.id}/teams`, 'owner', { name: 'Nope' })).status).toBe(402);
    expect((await call('POST', `/api/v1/orgs/${acme.id}/api-keys`, 'owner', { name: 'k', scopes: ['sites:read'] })).status).toBe(402);
  });
  it('admins can still reach billing to fix it, and staff can still read', async () => {
    await lapse();
    expect((await call('GET', B('summary'), 'owner')).body.state).toMatchObject({ mode: 'restricted', writable: false });
    expect((await call('POST', B('portal'), 'owner')).status).toBe(200);
    expect((await call('GET', '/api/v1/me', 'staff')).status).toBe(200);
  });
  it('paying clears the restriction', async () => {
    await lapse();
    const a = (await store.getAccount(acme.id))!;
    await webhook(ev('invoice.paid', { customer: a.stripe_customer_id }));
    expect((await call('POST', `/api/v1/orgs/${acme.id}/sites`, 'owner', { name: 'Back in business' })).status).toBe(201);
  });
});

describe('POST /api/v1/internal/billing/reconcile', () => {
  it('needs the cron secret', async () => {
    const no = await app.inject({ method: 'POST', url: '/api/v1/internal/billing/reconcile' });
    expect(no.statusCode).toBe(401);
    const bad = await app.inject({ method: 'POST', url: '/api/v1/internal/billing/reconcile', headers: { 'x-cron-secret': 'nope' } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/v1/internal/billing/reconcile', headers: { 'x-cron-secret': 'cron-secret' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ accounts: 0, failed: 0 });
  });
});

describe('OpenAPI', () => {
  it('documents the billing endpoints and hides the webhook and cron routes', async () => {
    const spec = (await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })).json() as { paths: Record<string, unknown> };
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining([
      '/api/v1/orgs/{orgId}/billing/summary', '/api/v1/orgs/{orgId}/billing/checkout', '/api/v1/orgs/{orgId}/billing/portal',
    ]));
    expect(Object.keys(spec.paths).some((p) => p.includes('webhook') || p.includes('internal'))).toBe(false);
  });
});
