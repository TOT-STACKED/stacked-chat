import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createModernHandler } from '../src/index.js';
import {
  bannerFor, formatGbp, planName, usageRatio,
  bestRole, canEditMember, canManage, filterMembers, grantableRoles, contactOf, formatPhone, inviteResultText, parseEmails, parsePeople, whoIs, rolesFor,
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
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(['anonKey', 'dev', 'phone', 'supabaseUrl']);
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
    expect(filterKnowledge(items, { audience: 's1' })).toHaveLength(3); // the venue's own item plus both company-wide ones
    expect(filterKnowledge(items, { audience: 's2' })).toHaveLength(2); // a venue with nothing of its own still sees company-wide items
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

import { audienceParams, audienceValue } from '../web/manage/lib.js';
describe('manage lib: knowledge audience picker', () => {
  it('round-trips company, site and team audiences', () => {
    expect(audienceValue({ site_id: null, team_id: null })).toBe('');
    expect(audienceValue({ site_id: 's1', team_id: null })).toBe('site:s1');
    expect(audienceValue({ site_id: 's1', team_id: 't1' })).toBe('team:t1'); // a team wins, and brings its own site
    expect(audienceParams('')).toEqual({ site_id: null, team_id: null });
    expect(audienceParams('site:s1')).toEqual({ site_id: 's1', team_id: null });
    expect(audienceParams('team:t1')).toEqual({ site_id: null, team_id: 't1' });
    expect(audienceLabel({ team_id: 't1', site_id: 's1' }, [{ id: 's1', name: 'North' }], [{ id: 't1', name: 'Kitchen' }])).toBe('Team: Kitchen');
  });
});

import { homeAttention, pastDue } from '../web/manage/lib.js';
describe('manage lib: what needs attention on Home', () => {
  const now = new Date('2026-03-10T10:00:00Z'); // Tuesday 10:00 UK
  const list = (over: Record<string, unknown> = {}) => ({ title: 'Opening checklist', due_time: '09:00', remind_days: [0, 1, 2, 3, 4, 5, 6], ...over });
  const row = (over: Record<string, unknown> = {}, done = false) => ({ checklist: list(over), site_id: 's1', siteName: 'North', run: { completed_at: done ? 'x' : null } });
  it('says all clear when nothing is wrong', () => { expect(homeAttention({}, now)).toEqual([]); });
  it('knows when a checklist is past due', () => {
    expect(pastDue(list(), now)).toBe(true); expect(pastDue(list({ due_time: '11:00' }), now)).toBe(false);
    expect(pastDue(list({ remind_days: [0, 6] }), now)).toBe(false); expect(pastDue(list({ due_time: null }), now)).toBe(false);
  });
  it('puts money and overdue checklists first, then people to chase, then tidying', () => {
    const items = homeAttention({
      billing: { account: { status: 'trialing' }, state: { mode: 'full', trial_days_left: 3 } },
      board: [row(), row({ title: 'Closing checklist', due_time: '23:00' }), row({ title: 'Done one' }, true)],
      courses: [{ id: 'c1', title: 'Fire safety', active: true, stats: { recipients: 10, done: 6, todo: 3, renew: 1 } }, { id: 'c2', title: 'Off', active: false, stats: { recipients: 5, done: 0, todo: 5, renew: 0 } }],
      updates: [{ id: 'u1', title: 'Fire drill', requires_ack: true, created_at: '2026-03-05T10:00:00Z', stats: { recipients: 10, read: 8, acked: 5 } }, { id: 'u2', title: 'Old', requires_ack: false, created_at: '2025-01-01T00:00:00Z', stats: { recipients: 10, read: 1, acked: 0 } }],
      insights: { unanswered: [{ draft_item_id: null }, { draft_item_id: null }, { draft_item_id: 'd' }] },
      knowledge: [{ status: 'draft' }, { status: 'published' }], members: [{ status: 'invited' }, { status: 'active' }],
    }, now);
    expect(items.map((i: { id: string }) => i.id)).toEqual(['late', 'trial', 'course-c1', 'unanswered', 'update-u1', 'drafts', 'invited']);
    expect(items[0]!.title).toBe('1 checklist is overdue today'); expect(items[0]!.sub).toBe('Opening checklist at North');
    expect(items[1]!.title).toBe('Your free trial ends in 3 days'); expect(items[2]!.title).toBe('Fire safety: 3 not done, 1 due a refresher');
    expect(items[3]!.title).toBe('2 questions the AI could not answer'); expect(items[4]!.title).toBe('“Fire drill”: 5 people have not confirmed it');
  });
  it('flags a payment problem as urgent', () => {
    expect(homeAttention({ billing: { account: { status: 'past_due' }, state: { mode: 'grace' } } }, now)[0]).toMatchObject({ tone: 'bad', title: 'Your payment is overdue' });
  });
});

describe('people who sign in with a mobile number', () => {
  it('reads a pasted list of names and numbers, and says which lines are not usable', () => {
    const r = parsePeople('Amy Smith 07700 900123\nBen Jones, +44 7700 900456\nCat - 07700-900789\nNo Number Here\n07700 900999\nAmy Again 07700900123');
    expect(r.valid).toEqual([{ name: 'Amy Smith', phone: '07700 900123' }, { name: 'Ben Jones', phone: '+44 7700 900456' }, { name: 'Cat', phone: '07700-900789' }]);
    expect(r.invalid).toEqual(['No Number Here', '07700 900999']);
  });
  it('shows a number people can read instead of the placeholder address', () => {
    expect(formatPhone('+447700900123')).toBe('07700 900123');
    expect(contactOf({ phone: '+447700900123', email: '447700900123@phone.invalid' })).toBe('07700 900123');
    expect(contactOf({ email: '447700900123@phone.invalid' })).toBe('07700 900123');
    expect(contactOf({ email: 'amy@acme.com' })).toBe('amy@acme.com');
    expect(whoIs('447700900123@phone.invalid')).toBe('07700 900123'); expect(whoIs('amy@acme.com')).toBe('amy');
  });
  it('says texted, not emailed, when everyone was added by number', () => {
    expect(inviteResultText([{ ok: true, via: 'text', invite: 'sent' }, { ok: true, via: 'text', invite: 'sent' }])).toBe('2 invitations texted.');
    expect(inviteResultText([{ ok: true, via: 'text', invite: 'failed' }])).toContain('the text did not go');
  });
});
