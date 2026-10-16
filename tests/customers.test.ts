import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { FakeBillingStore, FakeStripe, testBillingConfig } from '../src/testing/billing-fakes.js';
import { FakeConsoleStore } from '../src/testing/console-fakes.js';
import { FakeMailer, FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { testConfig } from './helpers.js';

const P = testBillingConfig().prices;
const billingEnv = {
  ...testConfig, STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_test',
  STRIPE_PRICE_STANDARD_MONTHLY: P.standard.month, STRIPE_PRICE_STANDARD_ANNUAL: P.standard.year, STRIPE_PRICE_GROUP_MONTHLY: P.group.month,
  STRIPE_PRICE_GROUP_ANNUAL: P.group.year, STRIPE_PRICE_LARGE_MONTHLY: P.large.month, STRIPE_PRICE_LARGE_ANNUAL: P.large.year,
};

describe('Console: add a customer', () => {
  let app: FastifyInstance; let repo: FakeRepo; let mailer: FakeMailer; let alerts: string[]; let bstore: FakeBillingStore; let stripe: FakeStripe;
  const U = { staff: randomUUID(), cust: randomUUID(), newOwner: randomUUID() };

  async function make(env: Record<string, unknown> = { ...testConfig, STACKED_STAFF_EMAILS: 'chris@stacked.io' }) {
    repo = new FakeRepo(); mailer = new FakeMailer(); alerts = []; bstore = new FakeBillingStore(); stripe = new FakeStripe();
    const org = repo.addOrg('Existing Co'); repo.addMember(org, 'owner@existing.co', 'owner', null, U.cust);
    // the billing store needs to see the venues the identity API creates
    bstore.listSites = async (o) => repo.sites.filter((s) => s.org_id === o).map((s) => ({ id: s.id, org_id: s.org_id, name: s.name, billing_tier: 'standard' as const, active: true }));
    app = await buildApp({ ...env, STACKED_STAFF_EMAILS: 'chris@stacked.io' } as typeof testConfig, {
      repo, mailer, consoleStore: new FakeConsoleStore(), billingStore: bstore, stripe, notify: async (t) => { alerts.push(t); },
      verifyToken: fakeVerifier({ s: { userId: U.staff, email: 'Chris@Stacked.io' }, c: { userId: U.cust, email: 'owner@existing.co' }, n: { userId: U.newOwner, email: 'bea@bistro.co.uk' } }),
    });
  }
  beforeEach(() => make());
  const create = (tok: string, body: object, key?: string) => app.inject({ method: 'POST', url: '/api/v1/console/customers', headers: { authorization: 'Bearer ' + tok, ...(key ? { 'idempotency-key': key } : {}) }, payload: body });
  const good = { company_name: 'Bistro Group', owner_email: 'Bea@Bistro.co.uk', owner_name: 'Bea K', start_trial: false };

  it('creates the company, its first venue and an invited owner, emails the invitation and tells Stacked', async () => {
    const r = await create('s', good);
    expect(r.statusCode).toBe(201);
    const body = r.json();
    const org = repo.orgs.find((o) => o.id === body.org_id)!;
    expect(org.name).toBe('Bistro Group'); expect(org.slug).toMatch(/^bistro-group-[0-9a-f]{4}$/);
    expect(repo.sites.find((s) => s.id === body.site_id)).toMatchObject({ org_id: org.id, name: 'Bistro Group' }); // first venue defaults to the company name
    expect(repo.members.find((m) => m.id === body.member_id)).toMatchObject({ email: 'bea@bistro.co.uk', role: 'owner', site_id: null, status: 'invited', display_name: 'Bea K' });
    expect(body.invite).toBe('sent'); expect(mailer.sent[0]).toMatchObject({ to: 'bea@bistro.co.uk' }); expect(mailer.sent[0]!.text).toContain('/manage/'); expect(mailer.sent[0]!.text).toContain('an owner');
    expect(alerts[0]).toContain('New customer'); expect(alerts[0]).toContain('Bistro Group'); expect(alerts[0]).toContain('chris@stacked.io');
  });
  it('the new owner can then sign in and is the owner of their company', async () => {
    const body = (await create('s', good)).json();
    const me = (await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: 'Bearer n' } })).json();
    expect(me.memberships).toEqual([expect.objectContaining({ role: 'owner', organisation: expect.objectContaining({ id: body.org_id }) })]);
  });
  it('takes a named first venue, and two customers with the same name get different addresses', async () => {
    const a = (await create('s', { ...good, venue_name: 'Bistro One' })).json(); const b = (await create('s', { ...good, owner_email: 'x@y.co' })).json();
    expect(repo.sites.find((s) => s.id === a.site_id)!.name).toBe('Bistro One');
    expect(repo.orgs.find((o) => o.id === a.org_id)!.slug).not.toBe(repo.orgs.find((o) => o.id === b.org_id)!.slug);
  });
  it('a double click (same Idempotency-Key) makes one customer, not two', async () => {
    const before = repo.orgs.length;
    const one = await create('s', good, 'key-12345678'); const two = await create('s', good, 'key-12345678');
    expect(two.json()).toEqual(one.json()); expect(repo.orgs.length).toBe(before + 1); expect(mailer.sent).toHaveLength(1);
  });
  it('only Stacked staff: customers, company owners and anonymous callers are refused, and nothing is created', async () => {
    const before = repo.orgs.length;
    expect((await create('c', good)).statusCode).toBe(403); expect((await create('n', good)).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/console/customers', payload: good })).statusCode).toBe(401);
    expect(repo.orgs.length).toBe(before); expect(mailer.sent).toHaveLength(0);
  });
  it('rejects bad input', async () => {
    for (const body of [{ ...good, owner_email: 'not-an-email' }, { ...good, company_name: 'A' }, { ...good, company_name: '<b>Evil</b>' }, { ...good, venue_name: '<i>x</i>' }, { ...good, owner_name: '<script>' }, { owner_email: 'a@b.co' }]) {
      expect((await create('s', body)).statusCode, JSON.stringify(body)).toBe(400);
    }
  });
  it('the owner still exists when the email fails to send (you can resend from People)', async () => {
    mailer.result = 'failed';
    const r = await create('s', good);
    expect(r.statusCode).toBe(201); expect(r.json().invite).toBe('failed'); expect(repo.members.some((m) => m.email === 'bea@bistro.co.uk')).toBe(true);
  });
  it('starts the 30-day trial when billing is on (and says so when it is not)', async () => {
    await make({ ...billingEnv, STACKED_STAFF_EMAILS: 'chris@stacked.io' });
    const on = (await create('s', { ...good, start_trial: true })).json();
    expect(on.trial).toBe('started');
    expect(await bstore.getAccount(on.org_id)).toMatchObject({ status: 'trialing', interval: 'month' });
    expect(alerts[0]).toContain('30 days started');
    const off = (await create('s', { ...good, owner_email: 'z@z.co', start_trial: false })).json();
    expect(off.trial).toBe('skipped'); expect(await bstore.getAccount(off.org_id)).toBeNull();
    await make();
    expect((await create('s', { ...good, start_trial: true })).json().trial).toBe('not_available'); // billing not configured here
  });
  it('is in the OpenAPI document', async () => {
    const spec = (await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })).json() as { paths: Record<string, Record<string, unknown>> };
    expect(spec.paths['/api/v1/console/customers']).toHaveProperty('post');
  });
});
