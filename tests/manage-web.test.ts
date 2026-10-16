import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createModernHandler } from '../src/index.js';
import {
  bannerFor, formatGbp, planName, usageRatio,
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

describe('manage lib: billing wording', () => {
  it('formats pounds plainly', () => {
    expect(formatGbp(4500)).toBe('£45');
    expect(formatGbp(19550)).toBe('£195.50');
  });
  it('names the plan from the lines on the bill', () => {
    expect(planName({ lines: [{ label: 'Venue' }] })).toBe('Venue');
    expect(planName({ lines: [{ label: 'Group' }, { label: 'Large venue' }] })).toBe('Group + Large venue');
    expect(planName({ lines: [] })).toBe('No venues yet');
  });
  it('tells admins what to do for each state, and nothing when all is well', () => {
    expect(bannerFor({ banner: null })).toBeNull();
    expect(bannerFor({ banner: 'trial', trial_days_left: 1 })).toMatchObject({ tone: 'info', cta: 'card' });
    expect(bannerFor({ banner: 'trial', trial_days_left: 1 })!.text).toContain('1 day left');
    expect(bannerFor({ banner: 'past_due', grace_ends_at: '2026-10-20T00:00:00Z' })!.text).toContain('20 October');
    expect(bannerFor({ banner: 'restricted' })).toMatchObject({ tone: 'warn', cta: 'portal' });
    expect(bannerFor({ banner: 'canceled' })!.text).toContain('90 days');
  });
  it('keeps usage bars within 0 to 1', () => {
    expect(usageRatio(500, 2000)).toBe(0.25);
    expect(usageRatio(5000, 2000)).toBe(1);
    expect(usageRatio(5, 0)).toBe(0);
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

import { audienceLabel, filterKnowledge, knowledgeCounts } from '../web/manage/lib.js';
describe('manage lib: knowledge list', () => {
  const sites = [{ id: 's1', name: 'North' }];
  const items = [
    { kind: 'document', title: 'Allergen policy', status: 'published', site_id: null },
    { kind: 'document', title: 'Opening checklist', status: 'draft', site_id: 's1' },
    { kind: 'video', title: 'Fire drill', status: 'published', site_id: null },
  ];
  it('labels the audience', () => {
    expect(audienceLabel(items[0], sites)).toBe('Whole company');
    expect(audienceLabel(items[1], sites)).toBe('North');
  });
  it('filters by type, audience and a search word', () => {
    expect(filterKnowledge(items, { kind: 'video' })).toHaveLength(1);
    expect(filterKnowledge(items, { audience: 'company' })).toHaveLength(2);
    expect(filterKnowledge(items, { audience: 's1' })).toHaveLength(1);
    expect(filterKnowledge(items, { q: ' ALLERGEN ' })).toHaveLength(1);
    expect(filterKnowledge(items, {})).toHaveLength(3);
  });
  it('counts by type and drafts', () => {
    expect(knowledgeCounts(items)).toEqual({ all: 3, document: 2, video: 1, image: 0, draft: 1 });
  });
});

import { answerRateText, asksText, barPercent, wherePhrase } from '../web/manage/lib.js';
describe('manage lib: insights wording', () => {
  it('words the numbers plainly', () => {
    expect(answerRateText(0.634)).toBe('63%'); expect(answerRateText(null)).toBe('No questions yet');
    expect(asksText(1)).toBe('1 ask'); expect(asksText(5)).toBe('5 asks');
    expect(wherePhrase({ sites: 0 })).toBe(''); expect(wherePhrase({ sites: 1, site_names: ['North'] })).toBe('North'); expect(wherePhrase({ sites: 3 })).toBe('3 sites');
  });
  it('sizes bars against the biggest value, never invisible', () => {
    expect(barPercent(10, 10)).toBe(100); expect(barPercent(5, 10)).toBe(50); expect(barPercent(0.1, 100)).toBe(4); expect(barPercent(3, 0)).toBe(0);
  });
});

import { isHexColour, keyStatus, lastUsedText, normColour, scopeLabel, KEY_SCOPES } from '../web/manage/lib.js';
describe('manage lib: settings helpers', () => {
  it('only offers key access that does something today, with friendly names', () => {
    expect(KEY_SCOPES.map(([k]) => k)).toEqual(['sites:read', 'teams:read', 'members:read', 'kb:read']);
    expect(scopeLabel('kb:read')).toBe('Read knowledge'); expect(scopeLabel('odd:scope')).toBe('odd:scope');
  });
  it('knows a key status', () => {
    const now = new Date('2026-10-16T12:00:00Z');
    expect(keyStatus({ revoked: true }, now)).toBe('Revoked');
    expect(keyStatus({ revoked: false, expires_at: '2026-10-01T00:00:00Z' }, now)).toBe('Expired');
    expect(keyStatus({ revoked: false, expires_at: null }, now)).toBe('Active');
  });
  it('words last used plainly', () => {
    const now = new Date('2026-10-16T12:00:00Z');
    expect(lastUsedText(null, now)).toBe('Never'); expect(lastUsedText('2026-10-16T01:00:00Z', now)).toBe('Today');
    expect(lastUsedText('2026-10-15T01:00:00Z', now)).toBe('Yesterday'); expect(lastUsedText('2026-10-11T12:00:00Z', now)).toBe('5 days ago');
  });
  it('checks colours', () => {
    expect(isHexColour('#E87830')).toBe(true); expect(isHexColour('red')).toBe(false); expect(isHexColour('#fff')).toBe(false);
    expect(normColour(' #E87830 ')).toBe('#e87830');
  });
});
