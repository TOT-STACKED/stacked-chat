import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { welcomeEmail } from '../src/lib/email.js';
import { createCustomers } from '../src/modules/console/customers.js';
import { createSignup } from '../src/modules/signup/service.js';
import { MIN_FILL_MS } from '../src/modules/signup/routes.js';
import { FakeMailer, FakeRepo } from '../src/testing/fakes.js';
import { testConfig } from './helpers.js';

const good = { company_name: 'The Old Crown Group', venue_name: 'The Old Crown, Leeds', owner_name: 'Priya Shah', owner_email: 'Priya@OldCrown.co.uk', elapsed_ms: 9000 };

describe('the sign-up service', () => {
  let repo: FakeRepo; let mailer: FakeMailer; let alerts: string[]; let trials: string[];
  const make = () => createSignup({ repo, customers: createCustomers({ repo, mailer, publicUrl: 'https://stackedchat.io', notify: async (t) => { alerts.push(t); },
    billing: { startOrAddCard: async (orgId: string) => { trials.push(orgId); return {}; } } as never }) });
  beforeEach(() => { repo = new FakeRepo(); mailer = new FakeMailer(); alerts = []; trials = []; });

  it('creates the company, its first venue, the owner (invited) and the 30-day trial, then emails a welcome', async () => {
    expect(await make().start({ company_name: 'The Old Crown Group', venue_name: 'The Old Crown, Leeds', owner_name: 'Priya Shah', owner_email: 'Priya@OldCrown.co.uk' })).toBe('created');
    expect(repo.orgs).toHaveLength(1); expect(repo.orgs[0]!.name).toBe('The Old Crown Group');
    expect(repo.sites.map((s) => s.name)).toEqual(['The Old Crown, Leeds']);
    expect(repo.members).toHaveLength(1);
    expect(repo.members[0]).toMatchObject({ email: 'priya@oldcrown.co.uk', role: 'owner', status: 'invited', site_id: null, display_name: 'Priya Shah' });
    expect(trials).toEqual([repo.orgs[0]!.id]);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe('priya@oldcrown.co.uk'); expect(mailer.sent[0]!.subject).toContain('Welcome to Stacked Chat'); expect(mailer.sent[0]!.text).toContain('Hi Priya,');
    expect(mailer.sent[0]!.text).toContain('https://stackedchat.io/manage/'); expect(mailer.sent[0]!.text).not.toContain('The Stacked team');
    expect(alerts[0]).toContain('New self-serve sign-up'); expect(alerts[0]).toContain('priya@oldcrown.co.uk'); expect(alerts[0]).toContain('30 days started');
  });
  it('uses the company name for the venue when none is given', async () => {
    await make().start({ company_name: 'Solo Cafe', owner_name: 'Sam', owner_email: 'sam@solo.co' });
    expect(repo.sites.map((s) => s.name)).toEqual(['Solo Cafe']);
  });
  it('an address that already belongs to anyone creates nothing and sends nothing', async () => {
    const other = repo.addOrg('Existing'); repo.addMember(other, 'priya@oldcrown.co.uk', 'staff', null);
    expect(await make().start({ company_name: 'Another', owner_name: 'Priya', owner_email: 'PRIYA@oldcrown.co.uk' })).toBe('exists');
    expect(repo.orgs).toHaveLength(1); expect(mailer.sent).toEqual([]); expect(trials).toEqual([]); expect(alerts).toEqual([]);
    expect(await make().start({ company_name: 'Third', owner_name: 'P', owner_email: 'new@x.co' })).toBe('created');
    expect(await make().start({ company_name: 'Third again', owner_name: 'P', owner_email: 'NEW@x.co' })).toBe('exists'); // a double click or a retry makes one company, not two
    expect(repo.orgs).toHaveLength(2);
  });
});

describe('the welcome email', () => {
  it('greets by first name, says the trial has started and needs no card, and treats everything typed as plain text', () => {
    const e = welcomeEmail({ to: 'p@x.co', name: 'Priya Shah', orgName: 'The Old Crown', url: 'https://stackedchat.io/manage/' });
    expect(e.text).toContain('Hi Priya,'); expect(e.text).toContain('30-day free trial'); expect(e.text).toContain('No card is needed');
    expect(welcomeEmail({ to: 'p@x.co', name: null, orgName: 'X', url: 'u' }).text).toContain('Hello,');
    const evil = welcomeEmail({ to: 'p@x.co', name: '<b>Eve</b>', orgName: '<script>alert(1)</script>', url: 'https://x.co/' });
    expect(evil.html).not.toMatch(/<script|<b>Eve/); expect(evil.html).toContain('&lt;script&gt;');
  });
});

describe('the sign-up API and page', () => {
  let app: FastifyInstance; let repo: FakeRepo; let mailer: FakeMailer; let alerts: string[];
  const boot = async (limits: { perIpPerHour?: number; perEmailPerHour?: number; allPerHour?: number } = {}) => {
    repo = new FakeRepo(); mailer = new FakeMailer(); alerts = [];
    app = await buildApp(testConfig, { repo, mailer, notify: async (t) => { alerts.push(t); }, signupLimits: limits });
  };
  const post = (body: object, ip = '203.0.113.7') => app.inject({ method: 'POST', url: '/api/v1/signup', payload: body, remoteAddress: ip });
  beforeEach(async () => { await boot(); });

  it('needs no sign-in, creates one trial, and says only "ok"', async () => {
    const r = await post(good);
    expect(r.statusCode).toBe(200); expect(r.json()).toEqual({ ok: true });
    expect(repo.orgs).toHaveLength(1); expect(mailer.sent).toHaveLength(1); expect(mailer.sent[0]!.to).toBe('priya@oldcrown.co.uk');
  });
  it('answers exactly the same for an address that already has an account, so it reveals nothing about who is a customer', async () => {
    const first = await post(good);
    const again = await post({ ...good, company_name: 'A different name' });
    expect(again.statusCode).toBe(200); expect(again.json()).toEqual(first.json());
    expect(repo.orgs).toHaveLength(1); expect(mailer.sent).toHaveLength(1);
  });
  it('a bot gets the same answer but nothing is created: a filled hidden field, or a form submitted faster than a person can', async () => {
    expect((await post({ ...good, website: 'http://spam.example' })).json()).toEqual({ ok: true });
    expect((await post({ ...good, owner_email: 'fast@x.co', elapsed_ms: MIN_FILL_MS - 1 })).json()).toEqual({ ok: true });
    expect(repo.orgs).toHaveLength(0); expect(mailer.sent).toEqual([]);
    expect((await post({ ...good, owner_email: 'slow@x.co', elapsed_ms: MIN_FILL_MS })).statusCode).toBe(200);
    expect(repo.orgs).toHaveLength(1);
  });
  it('refuses missing or odd input with a clear message', async () => {
    const bad = async (patch: object, why: string) => { const r = await post({ ...good, owner_email: 'ok@x.co', ...patch }); expect(r.statusCode, why).toBe(400); };
    await bad({ company_name: 'X' }, 'too short');
    await bad({ company_name: '<script>alert(1)</script>' }, 'markup');
    await bad({ company_name: 'Visit http://spam.example' }, 'web address');
    await bad({ venue_name: 'www.spam.co' }, 'web address in venue');
    await bad({ owner_name: '' }, 'no name');
    await bad({ owner_email: 'not-an-email' }, 'bad email');
    await bad({ elapsed_ms: undefined }, 'missing timer');
    await bad({ company_name: 'x'.repeat(81) }, 'too long');
    expect(repo.orgs).toHaveLength(0);
  });
  it('limits how many sign-ups one address, one person and the whole service can make in an hour', async () => {
    await boot({ perIpPerHour: 3 });
    for (let i = 0; i < 3; i++) expect((await post({ ...good, owner_email: `a${i}@x.co` }, '198.51.100.1')).statusCode).toBe(200);
    const blocked = await post({ ...good, owner_email: 'a9@x.co' }, '198.51.100.1');
    expect(blocked.statusCode).toBe(429); expect(blocked.headers['retry-after']).toBeDefined(); expect(blocked.json().error.code).toBe('rate_limited');
    expect((await post({ ...good, owner_email: 'b0@x.co' }, '198.51.100.2')).statusCode).toBe(200); // someone else is not affected

    await boot({ perEmailPerHour: 2 });
    for (let i = 0; i < 2; i++) expect((await post(good, `198.51.100.${10 + i}`)).statusCode).toBe(200);
    expect((await post(good, '198.51.100.30')).statusCode).toBe(429);

    await boot({ allPerHour: 2 });
    for (let i = 0; i < 2; i++) expect((await post({ ...good, owner_email: `c${i}@x.co` }, `198.51.100.${40 + i}`)).statusCode).toBe(200);
    expect((await post({ ...good, owner_email: 'c9@x.co' }, '198.51.100.99')).statusCode).toBe(429);
  });
  it('is off (404) without a database, and is listed in the OpenAPI file', async () => {
    const spec = (await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })).json();
    expect(Object.keys(spec.paths)).toContain('/api/v1/signup');
    expect(spec.paths['/api/v1/signup'].post.security ?? []).toEqual([]); // public
    const off = await buildApp(testConfig, {});
    expect((await off.inject({ method: 'POST', url: '/api/v1/signup', payload: good })).statusCode).toBe(404);
  });
  it('serves the page with a strict content policy that allows no outside connections', async () => {
    const page = await app.inject({ method: 'GET', url: '/start/' });
    expect(page.statusCode).toBe(200); expect(page.body).toContain('Start your free trial');
    const csp = String(page.headers['content-security-policy']);
    expect(csp).toContain("connect-src 'self'"); expect(csp).toContain("script-src 'self'"); expect(csp).not.toContain('unsafe-inline'); expect(csp).toContain("frame-ancestors 'none'");
    expect((await app.inject({ method: 'GET', url: '/start' })).statusCode).toBe(301);
    for (const f of ['start.js', 'start.css']) expect((await app.inject({ method: 'GET', url: '/start/' + f })).statusCode, f).toBe(200);
  });
  it('the Console\'s Add customer still sends the "you have been invited" email', async () => {
    const svc = createCustomers({ repo, mailer, publicUrl: 'https://stackedchat.io' });
    await svc.create('staff@stacked.io', { company_name: 'Acme', owner_email: 'o@acme.co', start_trial: false });
    expect(mailer.sent[0]!.subject).toContain("You've been invited"); expect(mailer.sent[0]!.text).toContain('The Stacked team');
  });
});
