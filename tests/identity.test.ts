import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { FakeRepo, fakeVerifier } from './fakes.js';
import { testConfig } from './helpers.js';

// ---- world ---------------------------------------------------------------------------------
let repo: FakeRepo;
let app: FastifyInstance;
let acme: ReturnType<FakeRepo['addOrg']>;
let north: ReturnType<FakeRepo['addSite']>;
let south: ReturnType<FakeRepo['addSite']>;
let other: ReturnType<FakeRepo['addOrg']>;

const U = { owner: randomUUID(), hq: randomUUID(), mgrN: randomUUID(), staffN: randomUUID(), outsider: randomUUID(), stranger: randomUUID() };
const tokens = {
  owner: 'tok-owner', hq: 'tok-hq', mgrN: 'tok-mgrN', staffN: 'tok-staffN', outsider: 'tok-outsider', stranger: 'tok-stranger',
};

async function world(limits?: { user?: number; key?: number }) {
  repo = new FakeRepo();
  acme = repo.addOrg('Acme'); north = repo.addSite(acme, 'North'); south = repo.addSite(acme, 'South'); other = repo.addOrg('Other');
  repo.addMember(acme, 'owner@acme.com', 'owner', null, U.owner);
  repo.addMember(acme, 'hq@acme.com', 'hq_admin', null, U.hq);
  repo.addMember(acme, 'mgr@acme.com', 'site_manager', north, U.mgrN);
  repo.addMember(acme, 'staff@acme.com', 'staff', north, U.staffN);
  repo.addMember(acme, 'sstaff@acme.com', 'staff', south, randomUUID());
  repo.addMember(other, 'out@other.com', 'owner', null, U.outsider);
  app = await buildApp(testConfig, {
    repo, limits,
    verifyToken: fakeVerifier({
      [tokens.owner]: { userId: U.owner, email: 'owner@acme.com' }, [tokens.hq]: { userId: U.hq, email: 'hq@acme.com' },
      [tokens.mgrN]: { userId: U.mgrN, email: 'mgr@acme.com' }, [tokens.staffN]: { userId: U.staffN, email: 'staff@acme.com' },
      [tokens.outsider]: { userId: U.outsider, email: 'out@other.com' }, [tokens.stranger]: { userId: U.stranger, email: 'nobody@example.com' },
    }),
  });
}
beforeEach(() => world());

type Tok = keyof typeof tokens;
async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, who?: Tok | `key:${string}`, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { ...headers };
  if (who?.startsWith('key:')) h['x-api-key'] = who.slice(4); else if (who) h.authorization = 'Bearer ' + tokens[who as Tok];
  const res = await app.inject({ method, url, headers: h, payload: body as object | undefined });
  return { status: res.statusCode, body: res.json() as any, headers: res.headers };
}
const sitesUrl = () => `/api/v1/orgs/${acme.id}/sites`;
const membersUrl = () => `/api/v1/orgs/${acme.id}/members`;
const keysUrl = () => `/api/v1/orgs/${acme.id}/api-keys`;

// ---- authentication ------------------------------------------------------------------------
describe('authentication', () => {
  it('rejects missing and invalid credentials with the standard envelope', async () => {
    const none = await call('GET', '/api/v1/me');
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe('unauthorized');
    const bad = await app.inject({ url: '/api/v1/me', headers: { authorization: 'Bearer nope' } });
    expect(bad.statusCode).toBe(401);
  });

  it('/me returns the verified user with named memberships', async () => {
    const r = await call('GET', '/api/v1/me', 'mgrN');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: 'user', user: { email: 'mgr@acme.com' } });
    expect(r.body.memberships).toEqual([{ member_id: expect.any(String), role: 'site_manager', organisation: { id: acme.id, name: 'Acme' }, site: { id: north.id, name: 'North' } }]);
  });

  it('first sign-in links an invited member (by verified email) to the user', async () => {
    const invited = repo.addMember(acme, 'newbie@acme.com', 'staff', south, null, 'active');
    const uid = randomUUID();
    app = await buildApp(testConfig, { repo, verifyToken: fakeVerifier({ 'tok-new': { userId: uid, email: 'newbie@acme.com' } }) });
    const res = await app.inject({ url: '/api/v1/me', headers: { authorization: 'Bearer tok-new' } });
    expect(res.json().memberships).toHaveLength(1);
    expect(invited.user_id).toBe(uid);
  });

  it("someone else's already-linked membership is never picked up by email", async () => {
    // staff@acme.com is linked to U.staffN; a different user with the same email string gets nothing
    app = await buildApp(testConfig, { repo, verifyToken: fakeVerifier({ 'tok-imp': { userId: randomUUID(), email: 'staff@acme.com' } }) });
    const res = await app.inject({ url: '/api/v1/me', headers: { authorization: 'Bearer tok-imp' } });
    expect(res.json().memberships).toEqual([]);
  });

  it('a valid session with no memberships gets 404 on organisation endpoints (existence not revealed)', async () => {
    expect((await call('GET', '/api/v1/me', 'stranger')).body.memberships).toEqual([]);
    expect((await call('GET', sitesUrl(), 'stranger')).status).toBe(404);
    expect((await call('GET', sitesUrl(), 'outsider')).status).toBe(404);
  });

  it('503s cleanly when identity is not configured (no service key)', async () => {
    const bare = await buildApp(testConfig);
    const res = await bare.inject({ url: '/api/v1/me', headers: { authorization: 'Bearer x' } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('not_configured');
  });
});

// ---- sites & member visibility ---------------------------------------------------------------
describe('sites and member visibility', () => {
  it('organisation-wide members see every site; site-level members only their own', async () => {
    expect((await call('GET', sitesUrl(), 'owner')).body.data.map((s: any) => s.name).sort()).toEqual(['North', 'South']);
    expect((await call('GET', sitesUrl(), 'mgrN')).body.data.map((s: any) => s.name)).toEqual(['North']);
  });

  it('owners see all members; a site manager sees only their site; staff see none', async () => {
    expect((await call('GET', membersUrl(), 'owner')).body.data).toHaveLength(5);
    const mgr = (await call('GET', membersUrl(), 'mgrN')).body.data.map((m: any) => m.email).sort();
    expect(mgr).toEqual(['mgr@acme.com', 'staff@acme.com']);
    expect((await call('GET', membersUrl(), 'staffN')).body.data).toEqual([]);
  });

  it('never exposes phone numbers or internal ids in member records', async () => {
    const m = (await call('GET', membersUrl(), 'owner')).body.data[0];
    expect(Object.keys(m).sort()).toEqual(['created_at', 'display_name', 'email', 'id', 'org_id', 'role', 'site_id', 'status']);
  });
});

// ---- granting roles ----------------------------------------------------------------------------
describe('granting roles', () => {
  const add = (who: Tok, body: Record<string, unknown>) => call('POST', membersUrl(), who, body);

  it('hq_admin can add staff and site managers, but not hq_admin or owner', async () => {
    expect((await add('hq', { email: 'a@acme.com', role: 'staff', site_id: south.id })).status).toBe(201);
    expect((await add('hq', { email: 'b@acme.com', role: 'site_manager', site_id: south.id })).status).toBe(201);
    expect((await add('hq', { email: 'c@acme.com', role: 'hq_admin' })).status).toBe(403);
    expect((await add('hq', { email: 'd@acme.com', role: 'owner' })).status).toBe(403);
  });

  it('only an owner can create another admin or owner', async () => {
    expect((await add('owner', { email: 'e@acme.com', role: 'hq_admin' })).status).toBe(201);
    expect((await add('owner', { email: 'f@acme.com', role: 'owner' })).status).toBe(201);
  });

  it('a site manager can add staff at THEIR site only, and cannot promote anyone to site manager', async () => {
    expect((await add('mgrN', { email: 'g@acme.com', role: 'staff', site_id: north.id })).status).toBe(201);
    expect((await add('mgrN', { email: 'h@acme.com', role: 'staff', site_id: south.id })).status).toBe(403);
    expect((await add('mgrN', { email: 'i@acme.com', role: 'site_manager', site_id: north.id })).status).toBe(403);
    expect((await add('mgrN', { email: 'j@acme.com', role: 'staff' })).status).toBe(403); // org-wide
  });

  it('staff and outsiders cannot add members', async () => {
    expect((await add('staffN', { email: 'k@acme.com', role: 'staff', site_id: north.id })).status).toBe(403);
    expect((await add('outsider', { email: 'l@acme.com', role: 'staff' })).status).toBe(404);
  });

  it('validates role/scope combinations, emails and site ownership', async () => {
    expect((await add('owner', { email: 'm@acme.com', role: 'hq_admin', site_id: north.id })).status).toBe(400);
    expect((await add('hq', { email: 'n@acme.com', role: 'site_manager' })).status).toBe(400);
    const bad = await add('owner', { email: 'not-an-email', role: 'staff' });
    expect(bad.status).toBe(400); expect(bad.body.error.code).toBe('validation_error');
    const otherSite = repo.addSite(other, 'Elsewhere');
    expect((await add('owner', { email: 'o@acme.com', role: 'staff', site_id: otherSite.id })).status).toBe(400);
  });

  it('rejects duplicates with 409', async () => {
    expect((await add('hq', { email: 'dup@acme.com', role: 'staff', site_id: south.id })).status).toBe(201);
    expect((await add('hq', { email: 'DUP@acme.com', role: 'staff', site_id: south.id })).status).toBe(409);
  });
});

describe('changing members', () => {
  const find = (email: string) => repo.members.find((m) => m.email === email)!;
  const patch = (who: Tok, email: string, body: Record<string, unknown>) =>
    call('PATCH', `${membersUrl()}/${find(email).id}`, who, body);

  it('hq_admin can demote a site manager and disable staff; cannot touch an equal/higher rank', async () => {
    expect((await patch('hq', 'mgr@acme.com', { role: 'staff' })).body.role).toBe('staff');
    expect((await patch('hq', 'sstaff@acme.com', { status: 'disabled' })).body.status).toBe('disabled');
    repo.addMember(acme, 'hq2@acme.com', 'hq_admin');
    expect((await patch('hq', 'hq2@acme.com', { role: 'staff' })).status).toBe(403);
    expect((await patch('hq', 'owner@acme.com', { role: 'staff' })).status).toBe(403);
  });

  it('a site manager cannot promote themselves or a peer', async () => {
    expect((await patch('mgrN', 'mgr@acme.com', { role: 'hq_admin' })).status).toBe(403);
    expect((await patch('mgrN', 'staff@acme.com', { role: 'site_manager' })).status).toBe(403);
    expect((await patch('mgrN', 'staff@acme.com', { role: 'kiosk' })).status).toBe(200);
  });

  it("protects the organisation's last owner", async () => {
    expect((await patch('owner', 'owner@acme.com', { role: 'staff' })).status).toBe(409);
    expect((await patch('owner', 'owner@acme.com', { status: 'disabled' })).status).toBe(409);
    repo.addMember(acme, 'owner2@acme.com', 'owner');
    expect((await patch('owner', 'owner@acme.com', { role: 'hq_admin' })).status).toBe(200);
  });

  it('cannot touch members of another organisation, and needs a change', async () => {
    const foreign = repo.members.find((m) => m.email === 'out@other.com')!;
    expect((await call('PATCH', `${membersUrl()}/${foreign.id}`, 'owner', { role: 'staff' })).status).toBe(404);
    expect((await patch('owner', 'staff@acme.com', {})).status).toBe(400);
  });
});

// ---- API keys ------------------------------------------------------------------------------------
describe('API keys', () => {
  const create = (who: Tok, body: Record<string, unknown> = { name: 'Zapier', scopes: ['sites:read'] }) => call('POST', keysUrl(), who, body);

  it('creates a key once, never stores or re-shows it, and lists safely', async () => {
    const r = await create('owner');
    expect(r.status).toBe(201);
    expect(r.body.key).toMatch(/^sk_live_[A-Za-z0-9_-]{40}$/);
    expect(JSON.stringify(repo.keys)).not.toContain(r.body.key);
    expect(r.body.api_key).not.toHaveProperty('key_hash');
    const list = await call('GET', keysUrl(), 'owner');
    expect(list.body.data).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(r.body.key);
    expect(list.body.data[0].key_prefix).toBe(r.body.key.slice(0, 14));
  });

  it('only organisation admins (people) can manage keys', async () => {
    expect((await create('hq')).status).toBe(201);
    expect((await create('mgrN')).status).toBe(403);
    expect((await create('staffN')).status).toBe(403);
    expect((await call('GET', keysUrl(), 'mgrN')).status).toBe(403);
    expect((await create('outsider')).status).toBe(404);
    const k = (await create('owner')).body.key;
    expect((await call('GET', keysUrl(), `key:${k}`)).status).toBe(403); // a key cannot manage keys
  });

  it('validates scopes and sites', async () => {
    expect((await create('owner', { name: 'x', scopes: ['admin:everything'] })).status).toBe(400);
    expect((await create('owner', { name: 'x', scopes: [] })).status).toBe(400);
    const foreign = repo.addSite(other, 'Z');
    expect((await create('owner', { name: 'x', scopes: ['chat'], site_id: foreign.id })).status).toBe(400);
  });

  it('a key authenticates (X-API-Key and Bearer), and its use is recorded', async () => {
    const { key } = (await create('owner')).body;
    const viaHeader = await call('GET', '/api/v1/me', `key:${key}`);
    expect(viaHeader.body).toMatchObject({ kind: 'api_key', api_key: { organisation_id: acme.id, scopes: ['sites:read'] } });
    const viaBearer = await app.inject({ url: '/api/v1/me', headers: { authorization: 'Bearer ' + key } });
    expect(viaBearer.statusCode).toBe(200);
    expect(repo.touched.length).toBeGreaterThan(0);
  });

  it('enforces scopes and the key\'s site restriction', async () => {
    const { key } = (await create('owner', { name: 'n', scopes: ['sites:read'], site_id: north.id })).body;
    expect((await call('GET', sitesUrl(), `key:${key}`)).body.data.map((s: any) => s.name)).toEqual(['North']);
    expect((await call('GET', membersUrl(), `key:${key}`)).status).toBe(403); // lacks members:read
    const m = (await create('owner', { name: 'm', scopes: ['members:read'] })).body.key;
    expect((await call('POST', membersUrl(), `key:${m}`, { email: 'x@acme.com', role: 'staff', site_id: south.id })).status).toBe(403); // writes are human-only
  });

  it("a key only works inside its own organisation", async () => {
    const { key } = (await create('owner')).body;
    const res = await call('GET', `/api/v1/orgs/${other.id}/sites`, `key:${key}`);
    expect(res.status).toBe(404);
  });

  it('revocation is immediate; expired keys and unknown keys get the same 401', async () => {
    const { key, api_key } = (await create('owner')).body;
    expect((await call('GET', '/api/v1/me', `key:${key}`)).status).toBe(200);
    expect((await call('DELETE', `${keysUrl()}/${api_key.id}`, 'owner')).body).toEqual({ revoked: true });
    const revoked = await call('GET', '/api/v1/me', `key:${key}`);
    expect(revoked.status).toBe(401);
    expect((await call('DELETE', `${keysUrl()}/${api_key.id}`, 'owner')).status).toBe(404);

    const exp = (await create('owner', { name: 'e', scopes: ['chat'], expires_in_days: 1 })).body.key;
    repo.keys.find((k) => k.key_prefix === exp.slice(0, 14))!.expires_at = new Date(Date.now() - 1000).toISOString();
    const expired = await call('GET', '/api/v1/me', `key:${exp}`);
    const unknown = await call('GET', '/api/v1/me', ('key:sk_live_' + 'x'.repeat(40)) as `key:${string}`);
    expect(expired.status).toBe(401);
    expect(expired.body.error).toEqual(unknown.body.error); // no hint which case it was
    expect(revoked.body.error).toEqual(unknown.body.error);
  });
});

// ---- limits & retries ------------------------------------------------------------------------------
describe('rate limits and idempotency', () => {
  it('rate-limits per principal with standard headers', async () => {
    await world({ user: 3 });
    for (let i = 0; i < 3; i++) expect((await call('GET', '/api/v1/me', 'owner')).status).toBe(200);
    const blocked = await call('GET', '/api/v1/me', 'owner');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.body.error.code).toBe('rate_limited');
    expect((await call('GET', '/api/v1/me', 'hq')).status).toBe(200); // other people unaffected
  });

  it('Idempotency-Key makes a retried POST safe (replays instead of duplicating)', async () => {
    const body = { email: 'retry@acme.com', role: 'staff', site_id: south.id };
    const h = { 'idempotency-key': 'abc-12345-key' };
    const first = await call('POST', membersUrl(), 'hq', body, h);
    const again = await call('POST', membersUrl(), 'hq', body, h);
    expect(first.status).toBe(201); expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(repo.members.filter((m) => m.email === 'retry@acme.com')).toHaveLength(1);
    // same key, different body: refused
    const clash = await call('POST', membersUrl(), 'hq', { ...body, email: 'other@acme.com' }, h);
    expect(clash.status).toBe(422); expect(clash.body.error.code).toBe('idempotency_key_reuse');
    // without a key a repeat is a plain duplicate
    expect((await call('POST', membersUrl(), 'hq', body)).status).toBe(409);
  });
});

describe('OpenAPI', () => {
  it('documents the identity endpoints and both auth schemes', async () => {
    const doc = (await app.inject('/api/v1/openapi.json')).json();
    for (const p of ['/api/v1/me', '/api/v1/orgs/{orgId}/sites', '/api/v1/orgs/{orgId}/members', '/api/v1/orgs/{orgId}/members/{memberId}', '/api/v1/orgs/{orgId}/api-keys', '/api/v1/orgs/{orgId}/api-keys/{keyId}']) {
      expect(doc.paths[p], p).toBeDefined();
    }
    expect(doc.paths['/api/v1/me'].get.security).toEqual([{ bearerAuth: [] }, { apiKey: [] }]);
  });
});
