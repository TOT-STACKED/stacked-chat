import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createModernHandler } from '../src/index.js';
import {
  bestRole, canEditMember, canManage, filterMembers, grantableRoles, inviteResultText, parseEmails, rolesFor,
} from '../web/manage/lib.js';
import { testConfig } from './helpers.js';

const ms = (role: string, siteId: string | null = null) => [{ orgId: 'o1', siteId, role }];

describe('manage lib: who can do what (display only, the server is the authority)', () => {
  it('grants only roles below your own, owners any', () => {
    expect(grantableRoles('owner')).toContain('owner');
    expect(grantableRoles('hq_admin')).toEqual(['site_manager', 'staff', 'kiosk']);
    expect(grantableRoles('site_manager')).toEqual(['staff', 'kiosk']);
    expect(grantableRoles('staff')).toEqual(['kiosk']);
    expect(grantableRoles(null)).toEqual([]);
  });
  it('respects scope: company-wide roles have no site, site roles need one', () => {
    expect(rolesFor('owner', null)).toEqual(['owner', 'hq_admin', 'staff']);
    expect(rolesFor('owner', 's1')).toEqual(['site_manager', 'staff', 'kiosk']);
  });
  it('site managers manage their site only', () => {
    expect(canManage(ms('site_manager', 's1'), 'o1', 's1')).toBe(true);
    expect(canManage(ms('site_manager', 's1'), 'o1', 's2')).toBe(false);
    expect(canManage(ms('site_manager', 's1'), 'o1', null)).toBe(false);
    expect(canManage(ms('hq_admin'), 'o1', 's9')).toBe(true);
    expect(bestRole(ms('staff', 's1'), 'o2', 's1')).toBeNull();
  });
  it('never lets you edit someone of equal or higher rank, unless you own', () => {
    expect(canEditMember('site_manager', { role: 'site_manager' })).toBe(false);
    expect(canEditMember('site_manager', { role: 'staff' })).toBe(true);
    expect(canEditMember('owner', { role: 'owner' })).toBe(true);
  });
});

describe('manage lib: lists and forms', () => {
  const people = [
    { role: 'site_manager', status: 'active', site_id: 's1', team_ids: ['t1'] },
    { role: 'staff', status: 'invited', site_id: 's1', team_ids: [] },
    { role: 'staff', status: 'active', site_id: 's2', team_ids: ['t1'] },
  ];
  it('filters by selection and chip', () => {
    expect(filterMembers(people, { kind: 'site', id: 's1' }, 'everyone')).toHaveLength(2);
    expect(filterMembers(people, { kind: 'team', id: 't1' }, 'everyone')).toHaveLength(2);
    expect(filterMembers(people, { kind: 'company' }, 'managers')).toHaveLength(1);
    expect(filterMembers(people, { kind: 'company' }, 'invited')).toHaveLength(1);
  });
  it('parses pasted emails: dedupes, lower-cases, separates the invalid', () => {
    expect(parseEmails('A@x.com, a@x.com\nb@y.co; nope')).toEqual({ valid: ['a@x.com', 'b@y.co'], invalid: ['nope'] });
  });
  it('words the invite outcome plainly', () => {
    expect(inviteResultText([{ ok: true, invite: 'sent' }, { ok: true, invite: 'sent' }])).toBe('2 invitations emailed.');
    expect(inviteResultText([{ ok: false, email: 'a@x.com', error: 'exists' }])).toContain('could not be added');
  });
});

describe('/manage is served safely', () => {
  let server: http.Server; let base = '';
  beforeAll(async () => {
    const modern = createModernHandler({ config: { ...testConfig, SUPABASE_SERVICE_KEY: 'service-secret-value' } });
    await modern.ready;
    server = http.createServer((req, res) => (modern.handles(req.url ?? '') ? modern.handle(req, res) : (res.writeHead(404), res.end())));
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('serves the page with a strict content policy', async () => {
    const res = await fetch(base + '/manage/');
    expect(res.status).toBe(200);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(await res.text()).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>\s*\S/); // no inline script bodies
  });
  it('config.json exposes only public values', async () => {
    const body = await (await fetch(base + '/manage/config.json')).text();
    expect(body).toContain('anon-test-key');
    expect(body).not.toContain('service-secret-value');
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(['anonKey', 'dev', 'supabaseUrl']);
  });
});
