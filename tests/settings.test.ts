import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { BrandingStore, SiteBranding } from '../src/modules/branding/store.js';
import { BrandingPatch } from '../src/modules/branding/validate.js';
import { FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { testConfig } from './helpers.js';

describe('branding validation (these values are pasted into the chat page)', () => {
  const ok = (b: object) => BrandingPatch.safeParse(b);
  it('accepts normal wording, a hex colour and an https logo', () => {
    const r = ok({ bot_name: "Dave's Diner Helper", welcome_heading: 'Ask us anything, 24/7!', welcome_message: 'Hi there. Ask about rotas, allergens & more (we reply fast).', primary_color: '#E87830', logo_url: 'https://cdn.example.com/logo.png' });
    expect(r.success).toBe(true);
  });
  it('refuses anything that could break out of HTML, CSS, a quoted attribute or the page builder', () => {
    for (const bad of ['<script>alert(1)</script>', 'x"onload="alert(1)', 'a`b', 'a\\b', 'a{b}', 'costs $&', 'cost $\'', 'two\nlines', 'tab\there']) {
      expect(ok({ bot_name: bad }).success, bad).toBe(false);
      expect(ok({ welcome_message: bad }).success, bad).toBe(false);
      expect(ok({ welcome_heading: bad }).success, bad).toBe(false);
    }
  });
  it('colours must be a plain #RRGGBB (no CSS injection)', () => {
    for (const bad of ['red', '#fff', '#12345g', 'url(javascript:alert(1))', '#E87830; background:url(x)', 'expression(1)']) expect(ok({ primary_color: bad }).success, bad).toBe(false);
    expect(ok({ primary_color: '#e87830' }).success).toBe(true);
  });
  it('logo links must be https with no quotes, spaces or brackets', () => {
    for (const bad of ['http://x.co/a.png', 'javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'https://x.co/a b.png', 'https://x.co/a".png', 'https://x.co/<a>.png', '//x.co/a.png']) expect(ok({ logo_url: bad }).success, bad).toBe(false);
  });
  it('an empty string means "use the default" (null), and unknown or paid fields are refused', () => {
    expect(ok({ bot_name: '' }).data).toEqual({ bot_name: null });
    expect(ok({ white_label: true }).success).toBe(false); // removing "Powered by" is not self-serve
    expect(ok({}).success).toBe(false);
    expect(ok({ bot_name: 'x'.repeat(41) }).success).toBe(false);
  });
});

describe('settings API', () => {
  let app: FastifyInstance; let repo: FakeRepo; let branding: FakeBranding;
  const U = { owner: randomUUID(), hq: randomUUID(), mgr: randomUUID(), staff: randomUUID() };
  let org: ReturnType<FakeRepo['addOrg']>; let n: ReturnType<FakeRepo['addSite']>;

  class FakeBranding implements BrandingStore {
    rows = new Map<string, SiteBranding>();
    async list(orgId: string) { return repo.sites.filter((s) => s.org_id === orgId).map((s) => this.get(s.id, s.name)); }
    get(id: string, name: string): SiteBranding { return this.rows.get(id) ?? { id, name, bot_name: null, welcome_heading: null, welcome_message: null, primary_color: null, logo_url: null }; }
    async update(id: string, patch: Partial<SiteBranding>) { const cur = this.get(id, repo.sites.find((s) => s.id === id)!.name); const next = { ...cur, ...patch }; this.rows.set(id, next); return next; }
  }

  beforeEach(async () => {
    repo = new FakeRepo(); branding = new FakeBranding();
    org = repo.addOrg('Acme'); n = repo.addSite(org, 'North');
    repo.addMember(org, 'owner@a.com', 'owner', null, U.owner); repo.addMember(org, 'hq@a.com', 'hq_admin', null, U.hq);
    repo.addMember(org, 'mgr@a.com', 'site_manager', n, U.mgr); repo.addMember(org, 'staff@a.com', 'staff', n, U.staff);
    app = await buildApp(testConfig, { repo, brandingStore: branding, verifyToken: fakeVerifier({
      o: { userId: U.owner, email: 'owner@a.com' }, h: { userId: U.hq, email: 'hq@a.com' }, m: { userId: U.mgr, email: 'mgr@a.com' }, s: { userId: U.staff, email: 'staff@a.com' } }) });
  });
  const call = (method: 'GET' | 'PATCH', url: string, tok: string, body?: object) => app.inject({ method, url, headers: { authorization: 'Bearer ' + tok }, payload: body });
  const O = () => `/api/v1/orgs/${org.id}`;

  it('shows the company to any member and lets owners and HQ admins rename it', async () => {
    expect((await call('GET', O(), 's')).json()).toMatchObject({ name: 'Acme' });
    expect((await call('PATCH', O(), 'h', { name: 'Acme Hospitality' })).json().name).toBe('Acme Hospitality');
    expect((await call('PATCH', O(), 'o', { name: 'Acme Group' })).statusCode).toBe(200);
    expect((await call('PATCH', O(), 'm', { name: 'Hacked' })).statusCode).toBe(403);
    expect((await call('PATCH', O(), 's', { name: 'Hacked' })).statusCode).toBe(403);
    expect(repo.orgs[0]!.name).toBe('Acme Group');
  });
  it('rejects bad company names', async () => {
    for (const name of ['', 'A', '<b>x</b>', 'x'.repeat(81)]) expect((await call('PATCH', O(), 'o', { name })).statusCode, name).toBe(400);
  });
  it('does not reveal another organisation', async () => {
    const other = repo.addOrg('Other');
    expect((await call('GET', `/api/v1/orgs/${other.id}`, 'o')).statusCode).toBe(404);
    expect((await call('PATCH', `/api/v1/orgs/${other.id}`, 'o', { name: 'Mine now' })).statusCode).toBe(404);
  });
  it('renames a site (admins only, and only sites of this company)', async () => {
    expect((await call('PATCH', `${O()}/sites/${n.id}`, 'h', { name: 'North Branch' })).json().name).toBe('North Branch');
    expect((await call('PATCH', `${O()}/sites/${n.id}`, 'm', { name: 'x y' })).statusCode).toBe(403);
    const foreign = repo.addSite(repo.addOrg('Other'), 'Theirs');
    expect((await call('PATCH', `${O()}/sites/${foreign.id}`, 'o', { name: 'Stolen' })).statusCode).toBeGreaterThanOrEqual(400);
    expect(repo.sites.find((s) => s.id === foreign.id)!.name).toBe('Theirs');
  });
  it('lists and changes how each site chat looks (admins only)', async () => {
    expect((await call('GET', `${O()}/branding`, 'h')).json().data).toEqual([expect.objectContaining({ id: n.id, name: 'North', bot_name: null })]);
    expect((await call('GET', `${O()}/branding`, 'm')).statusCode).toBe(403);
    const r = await call('PATCH', `${O()}/sites/${n.id}/branding`, 'o', { bot_name: 'Nora', primary_color: '#112233', welcome_message: 'Welcome to North.' });
    expect(r.statusCode).toBe(200); expect(r.json()).toMatchObject({ bot_name: 'Nora', primary_color: '#112233' });
    expect((await call('PATCH', `${O()}/sites/${n.id}/branding`, 'o', { bot_name: '' })).json().bot_name).toBeNull();
    expect((await call('PATCH', `${O()}/sites/${n.id}/branding`, 'm', { bot_name: 'x' })).statusCode).toBe(403);
    expect((await call('PATCH', `${O()}/sites/${n.id}/branding`, 's', { bot_name: 'x' })).statusCode).toBe(403);
  });
  it('turns away markup, injection attempts and paid options', async () => {
    for (const body of [{ bot_name: '<img src=x onerror=alert(1)>' }, { primary_color: 'red;}body{display:none' }, { logo_url: 'http://x.co/a.png' }, { white_label: true }, { welcome_message: '$&$&$&' }, {}]) {
      expect((await call('PATCH', `${O()}/sites/${n.id}/branding`, 'o', body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(branding.rows.size).toBe(0);
  });
  it('will not touch the branding of a site from another company', async () => {
    const foreign = repo.addSite(repo.addOrg('Other'), 'Theirs');
    expect((await call('PATCH', `${O()}/sites/${foreign.id}/branding`, 'o', { bot_name: 'Mine' })).statusCode).toBeGreaterThanOrEqual(400);
    expect(branding.rows.size).toBe(0);
  });
  it('is in the OpenAPI document', async () => {
    const spec = (await call('GET', '/api/v1/openapi.json', 'o')).json() as { paths: Record<string, unknown> };
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/api/v1/orgs/{orgId}/branding', '/api/v1/orgs/{orgId}/sites/{siteId}/branding', '/api/v1/orgs/{orgId}/sites/{siteId}']));
  });
});
