import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { cleanItems, createOps, ukDate } from '../src/modules/operations/service.js';
import { FakeOpsStore } from '../src/testing/ops-fakes.js';
import { FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { testConfig } from './helpers.js';

describe('checklist helpers', () => {
  it('turns lines into items, dropping blanks, and keeps ids of items that stay', () => {
    const a = cleanItems(['  Unlock the front door ', '', 'Switch on the ovens']);
    expect(a.map((i) => i.text)).toEqual(['Unlock the front door', 'Switch on the ovens']);
    const b = cleanItems(['Switch on the ovens', 'Count the float'], a);
    expect(b[0]!.id).toBe(a[1]!.id); expect(b[1]!.id).not.toBe(a[0]!.id);
  });
  it('refuses an empty list, too many items and very long items', () => {
    expect(() => cleanItems(['', '  '])).toThrow(/at least one/);
    expect(() => cleanItems(Array.from({ length: 61 }, (_, i) => `item ${i}`))).toThrow(/up to 60/);
    expect(() => cleanItems(['x'.repeat(201)])).toThrow(/200/);
  });
  it('counts the day in UK time', () => {
    expect(ukDate(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02'); // BST: already past midnight
    expect(ukDate(new Date('2026-01-01T23:30:00Z'))).toBe('2026-01-01');
  });
});

describe('checklist service', () => {
  let store: FakeOpsStore; let t: Date; let ops: ReturnType<typeof createOps>;
  const ORG = 'org-1'; const NORTH = 'north'; const SOUTH = 'south';
  const who = (siteId = NORTH, email = 'amy@a.com') => ({ orgId: ORG, siteId, email });
  beforeEach(() => { store = new FakeOpsStore(); store.addSite(ORG, NORTH); store.addSite(ORG, SOUTH); t = new Date('2026-03-10T07:00:00Z'); ops = createOps({ store, now: () => t }); });
  const open = () => ops.create(ORG, { title: 'Opening', kind: 'opening', site_id: null, items: ['Unlock', 'Ovens on', 'Count float'], by: 'o@a.com' });

  it('shows a company-wide list at every venue, and a venue list only there', async () => {
    await open(); await ops.create(ORG, { title: 'North extras', kind: 'custom', site_id: NORTH, items: ['Check the cellar'], by: 'o@a.com' });
    expect((await ops.today(ORG, NORTH)).map((x) => x.checklist.title)).toEqual(['Opening', 'North extras']);
    expect((await ops.today(ORG, SOUTH)).map((x) => x.checklist.title)).toEqual(['Opening']);
  });
  it('ticks, unticks and completes, remembering who and when', async () => {
    const l = await open(); const [a, b, c] = l.items;
    let r = await ops.tick(who(), l.id, a!.id, true);
    expect(r.run).toMatchObject({ done: 1, total: 3, started: true, completed_at: null });
    expect(r.run.ticks[a!.id]).toMatchObject({ by: 'amy@a.com' });
    r = await ops.tick(who(NORTH, 'bob@a.com'), l.id, b!.id, true); expect(r.run.done).toBe(2);
    r = await ops.tick(who(), l.id, a!.id, false); expect(r.run.done).toBe(1);
    await ops.tick(who(), l.id, a!.id, true); await ops.tick(who(), l.id, c!.id, true);
    const done = await ops.complete(who(), l.id, null);
    expect(done.run).toMatchObject({ done: 3, completed_by: 'amy@a.com' }); expect(done.run.completed_at).toBeTruthy();
  });
  it('each venue has its own run of the same company-wide list', async () => {
    const l = await open();
    await ops.tick(who(NORTH), l.id, l.items[0]!.id, true);
    expect((await ops.today(ORG, SOUTH))[0]!.run.done).toBe(0);
  });
  it('needs a note to finish with items skipped, and locks once finished', async () => {
    const l = await open(); await ops.tick(who(), l.id, l.items[0]!.id, true);
    await expect(ops.complete(who(), l.id, null)).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('note') });
    const r = await ops.complete(who(), l.id, 'Ovens broken, engineer booked');
    expect(r.run.note).toBe('Ovens broken, engineer booked');
    await expect(ops.tick(who(), l.id, l.items[1]!.id, true)).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('already completed') });
  });
  it('starts afresh the next day', async () => {
    const l = await open(); await ops.tick(who(), l.id, l.items[0]!.id, true);
    t = new Date('2026-03-11T07:00:00Z');
    expect((await ops.today(ORG, NORTH))[0]!.run).toMatchObject({ done: 0, started: false });
  });
  it('keeps ticks for items that stay when the list is edited, and ignores ticks for removed ones', async () => {
    const l = await open(); await ops.tick(who(), l.id, l.items[0]!.id, true); await ops.tick(who(), l.id, l.items[2]!.id, true);
    await ops.update(ORG, l.id, { items: ['Unlock', 'Ovens on', 'Lock the safe'] });
    expect((await ops.today(ORG, NORTH))[0]!.run).toMatchObject({ done: 1, total: 3 });
  });
  it('never lets staff tick a list from another venue or an inactive list', async () => {
    const l = await ops.create(ORG, { title: 'North only', kind: 'custom', site_id: NORTH, items: ['a'], by: 'o@a.com' });
    await expect(ops.tick(who(SOUTH), l.id, l.items[0]!.id, true)).rejects.toMatchObject({ statusCode: 404 });
    await ops.update(ORG, l.id, { active: false });
    await expect(ops.tick(who(NORTH), l.id, l.items[0]!.id, true)).rejects.toMatchObject({ statusCode: 404 });
    expect(await ops.today(ORG, NORTH)).toEqual([]);
  });
  it('builds the manager board and recent history', async () => {
    const l = await open(); await ops.tick(who(NORTH), l.id, l.items[0]!.id, true);
    const board = await ops.board(ORG, [NORTH, SOUTH]);
    expect(board.map((b) => [b.site_id, b.run.done])).toEqual([[NORTH, 1], [SOUTH, 0]]);
    t = new Date('2026-03-12T07:00:00Z');
    const recent = await ops.recent(ORG, [NORTH, SOUTH], 7);
    expect(recent).toHaveLength(1); expect(recent[0]!.date).toBe('2026-03-10');
  });
  it('refuses a venue from another company', async () => {
    await expect(ops.create(ORG, { title: 'x', kind: 'custom', site_id: 'elsewhere', items: ['a'], by: 'o@a.com' })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('checklist routes', () => {
  let repo: FakeRepo; let app: FastifyInstance; let store: FakeOpsStore;
  const U = { owner: randomUUID(), mgr: randomUUID(), staff: randomUUID(), other: randomUUID() };
  let org: ReturnType<FakeRepo['addOrg']>; let n: ReturnType<FakeRepo['addSite']>; let s: ReturnType<FakeRepo['addSite']>;
  beforeEach(async () => {
    repo = new FakeRepo(); store = new FakeOpsStore();
    org = repo.addOrg('Acme'); n = repo.addSite(org, 'North'); s = repo.addSite(org, 'South');
    store.addSite(org.id, n.id); store.addSite(org.id, s.id);
    repo.addMember(org, 'owner@a.com', 'owner', null, U.owner); repo.addMember(org, 'mgr@a.com', 'site_manager', n, U.mgr);
    repo.addMember(org, 'staff@a.com', 'staff', n, U.staff);
    app = await buildApp(testConfig, { repo, opsStore: store, verifyToken: fakeVerifier({
      o: { userId: U.owner, email: 'owner@a.com' }, m: { userId: U.mgr, email: 'mgr@a.com' }, s: { userId: U.staff, email: 'staff@a.com' } }) });
  });
  const call = (tok: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { authorization: 'Bearer ' + tok }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const base = () => `/api/v1/orgs/${org.id}/checklists`;

  it('lets an owner write company-wide and a site manager write for their own venue only', async () => {
    const own = await call('o', 'POST', base(), { title: 'Opening', kind: 'opening', items: ['Unlock', 'Ovens on'] });
    expect(own.statusCode).toBe(201); expect(own.json()).toMatchObject({ title: 'Opening', kind: 'opening', site_id: null });
    expect((await call('m', 'POST', base(), { title: 'x', items: ['a'] })).statusCode).toBe(403);
    expect((await call('m', 'POST', base(), { title: 'North close', kind: 'closing', site_id: n.id, items: ['Lock up'] })).statusCode).toBe(201);
    expect((await call('m', 'POST', base(), { title: 'South', site_id: s.id, items: ['a'] })).statusCode).toBe(403);
    expect((await call('s', 'POST', base(), { title: 'x', site_id: n.id, items: ['a'] })).statusCode).toBe(403);
  });
  it('shows managers the lists for their audience, and staff none', async () => {
    await call('o', 'POST', base(), { title: 'Opening', items: ['a'] });
    await call('o', 'POST', base(), { title: 'South only', site_id: s.id, items: ['a'] });
    expect((await call('m', 'GET', base())).json().data.map((x: { title: string }) => x.title)).toEqual(['Opening']);
    expect((await call('o', 'GET', base())).json().data).toHaveLength(2);
    expect((await call('s', 'GET', base())).json().data).toEqual([]);
  });
  it('edits and deletes only what you may manage', async () => {
    const mine = (await call('m', 'POST', base(), { title: 'North', site_id: n.id, items: ['a'] })).json();
    const wide = (await call('o', 'POST', base(), { title: 'Wide', items: ['a'] })).json();
    expect((await call('m', 'PATCH', `${base()}/${mine.id}`, { title: 'North renamed', items: ['a', 'b'] })).json()).toMatchObject({ title: 'North renamed' });
    expect((await call('m', 'PATCH', `${base()}/${wide.id}`, { title: 'hijack' })).statusCode).toBe(403);
    expect((await call('m', 'DELETE', `${base()}/${wide.id}`)).statusCode).toBe(403);
    expect((await call('m', 'DELETE', `${base()}/${mine.id}`)).statusCode).toBe(200);
  });
  it('staff see today\'s lists for their venue, tick, and finish them', async () => {
    const l = (await call('o', 'POST', base(), { title: 'Opening', kind: 'opening', items: ['Unlock', 'Ovens on'] })).json();
    const today = await call('s', 'GET', `/api/v1/chat/checklists?site_id=${n.id}`);
    expect(today.statusCode).toBe(200); expect(today.json().data[0]).toMatchObject({ checklist: { title: 'Opening' }, run: { done: 0, total: 2 } });
    const t1 = await call('s', 'POST', `/api/v1/chat/checklists/${l.id}/tick`, { site_id: n.id, item_id: l.items[0].id, done: true });
    expect(t1.json().run).toMatchObject({ done: 1 });
    expect((await call('s', 'POST', `/api/v1/chat/checklists/${l.id}/complete`, { site_id: n.id })).statusCode).toBe(400);
    await call('s', 'POST', `/api/v1/chat/checklists/${l.id}/tick`, { site_id: n.id, item_id: l.items[1].id, done: true });
    const done = await call('s', 'POST', `/api/v1/chat/checklists/${l.id}/complete`, { site_id: n.id });
    expect(done.json().run).toMatchObject({ done: 2, completed_by: 'staff@a.com' });
  });
  it('keeps staff out of venues that are not theirs', async () => {
    const l = (await call('o', 'POST', base(), { title: 'Opening', items: ['a'] })).json();
    expect((await call('s', 'GET', `/api/v1/chat/checklists?site_id=${s.id}`)).statusCode).toBe(403);
    expect((await call('s', 'POST', `/api/v1/chat/checklists/${l.id}/tick`, { site_id: s.id, item_id: l.items[0].id, done: true })).statusCode).toBe(403);
  });
  it('gives managers a board for the venues they run', async () => {
    const l = (await call('o', 'POST', base(), { title: 'Opening', items: ['a', 'b'] })).json();
    await call('s', 'POST', `/api/v1/chat/checklists/${l.id}/tick`, { site_id: n.id, item_id: l.items[0].id, done: true });
    const mgr = (await call('m', 'GET', `${base()}/board`)).json();
    expect(mgr.sites.map((x: { name: string }) => x.name)).toEqual(['North']);
    expect(mgr.today).toHaveLength(1); expect(mgr.today[0]).toMatchObject({ site_id: n.id, run: { done: 1, total: 2 } });
    expect((await call('o', 'GET', `${base()}/board`)).json().today).toHaveLength(2);
    expect(mgr.recent).toHaveLength(1);
  });
});
