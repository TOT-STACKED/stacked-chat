import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { checklistReminderEmail } from '../src/lib/email.js';
import { createOps } from '../src/modules/operations/service.js';
import { createReminders, dueMinutes, isPastDue, recipientsFor, ukClock } from '../src/modules/operations/reminders.js';
import { FakeOpsStore } from '../src/testing/ops-fakes.js';
import { FakeMailer, FakeRepo } from '../src/testing/fakes.js';
import { testConfig } from './helpers.js';

describe('reminder clock', () => {
  it('reads the day and time in UK time', () => {
    expect(ukClock(new Date('2026-03-10T09:05:00Z'))).toEqual({ dow: 2, minutes: 9 * 60 + 5 }); // Tuesday, GMT
    expect(ukClock(new Date('2026-07-04T08:05:00Z'))).toEqual({ dow: 6, minutes: 9 * 60 + 5 }); // Saturday, BST
    expect(dueMinutes('09:30')).toBe(570);
  });
  it('knows when a list is past due on a day it is checked', () => {
    const l = { due_time: '09:00', remind_days: [1, 2, 3, 4, 5] };
    expect(isPastDue(l, new Date('2026-03-10T09:00:00Z'))).toBe(true);
    expect(isPastDue(l, new Date('2026-03-10T08:59:00Z'))).toBe(false);
    expect(isPastDue(l, new Date('2026-03-08T12:00:00Z'))).toBe(false); // a Sunday
    expect(isPastDue({ due_time: null, remind_days: [0, 1, 2, 3, 4, 5, 6] }, new Date())).toBe(false);
  });
});

describe('reminder job', () => {
  let repo: FakeRepo; let store: FakeOpsStore; let mailer: FakeMailer; let t: Date;
  let org: ReturnType<FakeRepo['addOrg']>; let n: ReturnType<FakeRepo['addSite']>; let s: ReturnType<FakeRepo['addSite']>;
  const job = () => createReminders({ store, repo, mailer, publicUrl: 'https://stackedchat.io/', now: () => t });
  const ops = () => createOps({ store, now: () => t });
  beforeEach(() => {
    repo = new FakeRepo(); store = new FakeOpsStore(); mailer = new FakeMailer(); t = new Date('2026-03-10T09:30:00Z'); // Tuesday 09:30
    org = repo.addOrg('Acme'); n = repo.addSite(org, 'North'); s = repo.addSite(org, 'South'); store.addSite(org.id, n.id); store.addSite(org.id, s.id);
    repo.addMember(org, 'owner@a.com', 'owner'); repo.addMember(org, 'amy@a.com', 'site_manager', n); repo.addMember(org, 'staff@a.com', 'staff', n);
  });
  const opening = (extra: Record<string, unknown> = {}) => ops().create(org.id, { title: 'Opening checklist', kind: 'opening', site_id: null, items: ['Unlock', 'Ovens on', 'Float'], due_time: '09:00', by: 'o@a.com', ...extra });

  it('emails the venue manager when a list is not finished by its due time, once a day', async () => {
    await opening();
    const first = await job().run();
    expect(first.sent).toBe(2); // North's manager, and South has no manager so the owner is told
    const to = mailer.sent.map((m) => m.to).sort();
    expect(to).toEqual(['amy@a.com', 'owner@a.com']);
    expect(mailer.sent.find((m) => m.to === 'amy@a.com')!.subject).toBe('Opening checklist not finished at North');
    expect(mailer.sent[0]!.text).toContain('has not been started');
    expect((await job().run()).sent).toBe(0); // already sent today
    t = new Date('2026-03-11T09:30:00Z');
    expect((await job().run()).sent).toBe(2); // tomorrow it asks again
  });
  it('says how far it got when it was started', async () => {
    const l = await opening({ site_id: n.id });
    await ops().tick({ orgId: org.id, siteId: n.id, email: 'staff@a.com' }, l.id, l.items[0]!.id, true);
    await job().run();
    expect(mailer.sent[0]!.text).toContain('is only 1 of 3 ticked');
  });
  it('stays quiet when the list is finished, before the due time, much later, on other days, or with no due time', async () => {
    const l = await opening({ site_id: n.id });
    for (const it of l.items) await ops().tick({ orgId: org.id, siteId: n.id, email: 'staff@a.com' }, l.id, it.id, true);
    await ops().complete({ orgId: org.id, siteId: n.id, email: 'staff@a.com' }, l.id, null);
    expect((await job().run()).sent).toBe(0);
    store.lists = []; await opening({ site_id: n.id });
    t = new Date('2026-03-10T08:59:00Z'); expect((await job().run()).sent).toBe(0);
    t = new Date('2026-03-10T12:01:00Z'); expect((await job().run()).sent).toBe(0); // over 3 hours late: stale
    store.lists = []; await opening({ site_id: n.id, remind_days: [1, 3, 5] }); t = new Date('2026-03-10T09:30:00Z');
    expect((await job().run()).sent).toBe(0); // Tuesday is not a checked day
    store.lists = []; await opening({ site_id: n.id, due_time: null });
    expect((await job().run()).sent).toBe(0);
  });
  it('ignores inactive lists and people who are not active, and does nothing without email', async () => {
    const l = await opening({ site_id: n.id }); await ops().update(org.id, l.id, { active: false });
    expect((await job().run()).sent).toBe(0);
    await ops().update(org.id, l.id, { active: true });
    repo.addMember(org, 'ben@a.com', 'site_manager', n, null, 'invited');
    await job().run();
    expect(mailer.sent.map((m) => m.to)).toEqual(['amy@a.com']);
    const none = await createReminders({ store, repo, mailer: null, publicUrl: 'https://x', now: () => t }).run();
    expect(none).toEqual({ checked: 0, sent: 0 });
  });
  it('picks recipients: the venue managers, else the company admins', () => {
    const m = repo.members;
    expect(recipientsFor(m, n.id)).toEqual(['amy@a.com']);
    expect(recipientsFor(m, s.id)).toEqual(['owner@a.com']);
  });
  it('writes a readable email', () => {
    const e = checklistReminderEmail({ to: 'a@b.co', checklist: 'Opening', venue: 'North', due: '09:00', done: 2, total: 5, url: 'https://stackedchat.io/manage/#/operations' });
    expect(e.subject).toBe('Opening not finished at North'); expect(e.text).toContain('2 of 5 ticked'); expect(e.html).toContain('bgcolor="#FF5014"');
    const evil = checklistReminderEmail({ to: 'a@b.co', checklist: '<b>x</b>', venue: '<script>', due: '09:00', done: 0, total: 1, url: 'https://x' });
    expect(evil.html).not.toContain('<script>');
  });
});

describe('reminder endpoint', () => {
  it('needs the cron secret', async () => {
    const repo = new FakeRepo(); const store = new FakeOpsStore();
    const app = await buildApp({ ...testConfig, CRON_SECRET: 'sekret' }, { repo, opsStore: store, mailer: new FakeMailer() });
    expect((await app.inject({ method: 'POST', url: '/api/v1/internal/operations/remind' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/v1/internal/operations/remind', headers: { 'x-cron-secret': 'wrong' } })).statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/v1/internal/operations/remind', headers: { 'x-cron-secret': 'sekret' } });
    expect(ok.statusCode).toBe(200); expect(ok.json()).toEqual({ checked: 0, sent: 0 });
  });
});
