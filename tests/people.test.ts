import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { FakeMailer, FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { testConfig } from './helpers.js';

let repo: FakeRepo; let mailer: FakeMailer; let app: FastifyInstance;
let acme: ReturnType<FakeRepo['addOrg']>; let north: ReturnType<FakeRepo['addSite']>; let south: ReturnType<FakeRepo['addSite']>;
const U = { owner: randomUUID(), hq: randomUUID(), mgrN: randomUUID(), staffN: randomUUID() };
const tok = { owner: 'tok-owner', hq: 'tok-hq', mgrN: 'tok-mgrN', staffN: 'tok-staffN' } as const;
type Who = keyof typeof tok;

async function world(opts: { mailer?: boolean } = {}) {
  repo = new FakeRepo(); mailer = new FakeMailer();
  acme = repo.addOrg('Acme'); north = repo.addSite(acme, 'North'); south = repo.addSite(acme, 'South');
  repo.addMember(acme, 'owner@acme.com', 'owner', null, U.owner);
  repo.addMember(acme, 'hq@acme.com', 'hq_admin', null, U.hq);
  repo.addMember(acme, 'mgr@acme.com', 'site_manager', north, U.mgrN);
  repo.addMember(acme, 'staff@acme.com', 'staff', north, U.staffN);
  app = await buildApp(testConfig, {
    repo, mailer: opts.mailer === false ? undefined : mailer,
    verifyToken: fakeVerifier({
      [tok.owner]: { userId: U.owner, email: 'owner@acme.com' }, [tok.hq]: { userId: U.hq, email: 'hq@acme.com' },
      [tok.mgrN]: { userId: U.mgrN, email: 'mgr@acme.com' }, [tok.staffN]: { userId: U.staffN, email: 'staff@acme.com' },
    }),
  });
}
beforeEach(() => world());

async function call(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, who: Who, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({ method, url, headers: { authorization: 'Bearer ' + tok[who], ...headers }, payload: body as object | undefined });
  return { status: res.statusCode, body: res.json() as any };
}
const T = () => `/api/v1/orgs/${acme.id}/teams`;
const M = () => `/api/v1/orgs/${acme.id}/members`;
const S = () => `/api/v1/orgs/${acme.id}/sites`;
const member = (email: string) => repo.members.find((m) => m.email === email)!;

describe('teams', () => {
  it('an HQ admin creates organisation-wide teams and site teams; duplicates are refused (any case)', async () => {
    expect((await call('POST', T(), 'hq', { name: 'Compliance' })).status).toBe(201);
    expect((await call('POST', T(), 'hq', { name: 'Kitchen', site_id: north.id })).status).toBe(201);
    expect((await call('POST', T(), 'hq', { name: 'kitchen', site_id: south.id })).status).toBe(201); // same name, different site: fine
    expect((await call('POST', T(), 'hq', { name: 'KITCHEN', site_id: north.id })).status).toBe(409);
    expect((await call('POST', T(), 'hq', { name: '  ' })).status).toBe(400);
  });

  it('a site manager can only create teams at their own site; staff cannot create any', async () => {
    expect((await call('POST', T(), 'mgrN', { name: 'Bar', site_id: north.id })).status).toBe(201);
    expect((await call('POST', T(), 'mgrN', { name: 'Bar', site_id: south.id })).status).toBe(403);
    expect((await call('POST', T(), 'mgrN', { name: 'Everyone' })).status).toBe(403);
    expect((await call('POST', T(), 'staffN', { name: 'Mine', site_id: north.id })).status).toBe(403);
  });

  it("refuses a site from another organisation", async () => {
    const other = repo.addOrg('Other'); const foreign = repo.addSite(other, 'Z');
    expect((await call('POST', T(), 'owner', { name: 'X', site_id: foreign.id })).status).toBe(400);
  });

  it('list shows organisation-wide teams plus teams at the sites you belong to', async () => {
    repo.addTeam(acme, 'Compliance'); repo.addTeam(acme, 'Kitchen', north); repo.addTeam(acme, 'Bar', south);
    const mgr = (await call('GET', T(), 'mgrN')).body.data.map((t: any) => t.name).sort();
    expect(mgr).toEqual(['Compliance', 'Kitchen']);
    expect((await call('GET', T(), 'owner')).body.data).toHaveLength(3);
  });

  it('rename and delete follow the same scope rules; deleting a team only removes the links', async () => {
    const t = repo.addTeam(acme, 'Kitchen', north);
    expect((await call('PATCH', `${T()}/${t.id}`, 'mgrN', { name: 'Kitchen team' })).body.name).toBe('Kitchen team');
    const southTeam = repo.addTeam(acme, 'Bar', south);
    expect((await call('PATCH', `${T()}/${southTeam.id}`, 'mgrN', { name: 'x' })).status).toBe(403);
    await repo.setMemberTeams(member('staff@acme.com').id, [t.id]);
    expect((await call('DELETE', `${T()}/${t.id}`, 'mgrN')).body).toEqual({ deleted: true });
    expect(repo.memberTeams).toHaveLength(0);
    expect(repo.members.some((m) => m.email === 'staff@acme.com')).toBe(true); // the person is untouched
    expect((await call('DELETE', `${T()}/${t.id}`, 'mgrN')).status).toBe(404);
  });
});

describe('putting people in teams', () => {
  it('assigns teams, replaces the list, and members then show their team_ids', async () => {
    const k = repo.addTeam(acme, 'Kitchen', north); const b = repo.addTeam(acme, 'Bar', north); const all = repo.addTeam(acme, 'Compliance');
    const url = `${M()}/${member('staff@acme.com').id}/teams`;
    expect((await call('PUT', url, 'mgrN', { team_ids: [k.id, all.id] })).body.team_ids.sort()).toEqual([k.id, all.id].sort());
    expect((await call('PUT', url, 'mgrN', { team_ids: [b.id] })).body.team_ids).toEqual([b.id]);
    const list = (await call('GET', M(), 'owner')).body.data;
    expect(list.find((m: any) => m.email === 'staff@acme.com').team_ids).toEqual([b.id]);
    expect(list.find((m: any) => m.email === 'owner@acme.com').team_ids).toEqual([]);
  });

  it("rejects a team from another site, an unknown team, and managing a peer or someone senior", async () => {
    const southTeam = repo.addTeam(acme, 'Bar', south);
    const url = `${M()}/${member('staff@acme.com').id}/teams`;
    expect((await call('PUT', url, 'mgrN', { team_ids: [southTeam.id] })).status).toBe(400);
    expect((await call('PUT', url, 'mgrN', { team_ids: [randomUUID()] })).status).toBe(400);
    expect((await call('PUT', `${M()}/${member('mgr@acme.com').id}/teams`, 'mgrN', { team_ids: [] })).status).toBe(403); // peer
    expect((await call('PUT', url, 'staffN', { team_ids: [] })).status).toBe(403);
  });

  it('an organisation-wide member can only join organisation-wide teams', async () => {
    const siteTeam = repo.addTeam(acme, 'Kitchen', north); const wide = repo.addTeam(acme, 'Compliance');
    const url = `${M()}/${member('hq@acme.com').id}/teams`;
    expect((await call('PUT', url, 'owner', { team_ids: [siteTeam.id] })).status).toBe(400);
    expect((await call('PUT', url, 'owner', { team_ids: [wide.id] })).status).toBe(200);
  });
});

describe('inviting people', () => {
  const invite = (who: Who, body: Record<string, unknown>, headers: Record<string, string> = {}) => call('POST', M(), who, body, headers);

  it('saves the invitation AND emails the person, naming the company, site and role', async () => {
    const r = await invite('hq', { email: 'New.Starter@Acme.com', role: 'staff', site_id: south.id });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ email: 'new.starter@acme.com', status: 'invited', invite: 'sent', team_ids: [] });
    expect(mailer.sent).toHaveLength(1);
    const mail = mailer.sent[0]!;
    expect(mail.to).toBe('new.starter@acme.com');
    expect(mail.subject).toBe("You've been invited to Acme on Stacked Chat");
    expect(mail.text).toContain('hq@acme.com has added you to Acme, South on Stacked Chat as a team member');
    expect(mail.text).toContain('https://stackedchat.io/manage/');
    expect(mail.text).toContain('one-time code');
  });

  it('puts them straight into teams when asked, and validates those teams first', async () => {
    const t = repo.addTeam(acme, 'Bar', south); const wrong = repo.addTeam(acme, 'Kitchen', north);
    const ok = await invite('hq', { email: 'a@acme.com', role: 'staff', site_id: south.id, team_ids: [t.id] });
    expect(ok.body.team_ids).toEqual([t.id]);
    expect((await invite('hq', { email: 'b@acme.com', role: 'staff', site_id: south.id, team_ids: [wrong.id] })).status).toBe(400);
    expect(repo.members.some((m) => m.email === 'b@acme.com')).toBe(false); // nothing half-created
  });

  it('escapes anything a customer typed into the email (no HTML injection)', async () => {
    repo.orgs[0]!.name = 'Evil <img src=x onerror=alert(1)> & Co';
    await invite('hq', { email: 'c@acme.com', role: 'staff', site_id: south.id });
    const html = mailer.sent[0]!.html;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('still saves the invitation if the email fails, or if no mail service is configured', async () => {
    mailer.result = 'failed';
    const failed = await invite('hq', { email: 'd@acme.com', role: 'staff', site_id: south.id });
    expect(failed.status).toBe(201); expect(failed.body.invite).toBe('failed');
    await world({ mailer: false });
    const none = await invite('hq', { email: 'e@acme.com', role: 'staff', site_id: south.id });
    expect(none.status).toBe(201); expect(none.body.invite).toBe('skipped');
  });

  it('a retried invite with the same Idempotency-Key emails only once', async () => {
    const h = { 'idempotency-key': 'invite-123456' };
    const body = { email: 'f@acme.com', role: 'staff', site_id: south.id };
    const a = await invite('hq', body, h); const b = await invite('hq', body, h);
    expect(b.body.id).toBe(a.body.id);
    expect(mailer.sent).toHaveLength(1);
  });

  it('resend works only for pending invitations, only for managers, and at most once a minute', async () => {
    const created = (await invite('hq', { email: 'g@acme.com', role: 'staff', site_id: north.id })).body;
    const url = `${M()}/${created.id}/resend-invite`;
    expect((await call('POST', url, 'mgrN')).body).toEqual({ invite: 'sent' });
    expect(mailer.sent).toHaveLength(2);
    expect((await call('POST', url, 'mgrN')).status).toBe(429);
    expect((await call('POST', url, 'staffN')).status).toBe(403);
    expect((await call('POST', `${M()}/${member('staff@acme.com').id}/resend-invite`, 'hq')).status).toBe(400); // already active
    expect((await call('POST', `${M()}/${randomUUID()}/resend-invite`, 'hq')).status).toBe(404);
  });
});

describe('adding a site', () => {
  it('an HQ admin adds a site with a URL-safe unique slug; others cannot', async () => {
    const r = await call('POST', S(), 'hq', { name: "Mary's Bar & Grill!" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ org_id: acme.id, name: "Mary's Bar & Grill!" });
    expect(r.body.slug).toMatch(/^mary-s-bar-grill-[0-9a-f]{4}$/);
    expect((await call('POST', S(), 'mgrN', { name: 'Nope' })).status).toBe(403);
    expect((await call('POST', S(), 'staffN', { name: 'Nope' })).status).toBe(403);
    expect((await call('POST', S(), 'hq', { name: 'x' })).status).toBe(400);
  });

  it('is retry-safe with an Idempotency-Key, and shows up in the site list', async () => {
    const h = { 'idempotency-key': 'site-abc-123456' };
    const a = await call('POST', S(), 'owner', { name: 'Harbour' }, h); const b = await call('POST', S(), 'owner', { name: 'Harbour' }, h);
    expect(b.body.id).toBe(a.body.id);
    expect(repo.sites.filter((s) => s.name === 'Harbour')).toHaveLength(1);
    expect((await call('GET', S(), 'owner')).body.data.map((s: any) => s.name)).toContain('Harbour');
  });
});

describe('OpenAPI', () => {
  it('documents the new endpoints', async () => {
    const doc = (await app.inject('/api/v1/openapi.json')).json();
    for (const p of ['/api/v1/orgs/{orgId}/teams', '/api/v1/orgs/{orgId}/teams/{teamId}', '/api/v1/orgs/{orgId}/members/{memberId}/teams', '/api/v1/orgs/{orgId}/members/{memberId}/resend-invite']) expect(doc.paths[p], p).toBeDefined();
    expect(doc.paths['/api/v1/orgs/{orgId}/sites'].post).toBeDefined();
  });
});
