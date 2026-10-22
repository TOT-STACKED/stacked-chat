import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { announcementEmail } from '../src/lib/email.js';
import { recipientsOf, visibleTo } from '../src/modules/communicate/service.js';
import { FakeCommsStore } from '../src/testing/comms-fakes.js';
import { FakeMailer, FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { testConfig } from './helpers.js';

describe('who an update is for', () => {
  const m = (id: string, email: string, site: string | null, status: 'active' | 'invited' = 'active') => ({ id, org_id: 'o', site_id: site, user_id: null, email, display_name: null, role: 'staff' as const, status, created_at: '' });
  const members = [m('1', 'a@x.co', 'n'), m('2', 'b@x.co', 'n'), m('3', 'c@x.co', 's'), m('4', 'boss@x.co', null), m('5', 'd@x.co', 'n', 'invited')];
  it('counts the people at a venue, or every venue person for the whole company, but not company admins or the invited', () => {
    expect(recipientsOf({ site_id: 'n', team_id: null }, members, []).map((x) => x.email)).toEqual(['a@x.co', 'b@x.co']);
    expect(recipientsOf({ site_id: null, team_id: null }, members, []).map((x) => x.email)).toEqual(['a@x.co', 'b@x.co', 'c@x.co']);
    expect(recipientsOf({ site_id: 'n', team_id: 't' }, members, [{ member_id: '2', team_id: 't' }, { member_id: '4', team_id: 't' }]).map((x) => x.email)).toEqual(['b@x.co', 'boss@x.co']);
  });
  it('shows an update to its venue, its team, or everyone', () => {
    const who = { siteId: 'n', teamIds: ['t'] };
    expect(visibleTo({ site_id: null, team_id: null }, who)).toBe(true);
    expect(visibleTo({ site_id: 'n', team_id: null }, who)).toBe(true);
    expect(visibleTo({ site_id: 's', team_id: null }, who)).toBe(false);
    expect(visibleTo({ site_id: 'n', team_id: 't' }, who)).toBe(true);
    expect(visibleTo({ site_id: 'n', team_id: 'other' }, who)).toBe(false);
  });
});

describe('updates', () => {
  let repo: FakeRepo; let app: FastifyInstance; let store: FakeCommsStore; let mailer: FakeMailer;
  const U = { owner: randomUUID(), mgr: randomUUID(), s1: randomUUID(), s2: randomUUID(), s3: randomUUID() };
  let org: ReturnType<FakeRepo['addOrg']>; let n: ReturnType<FakeRepo['addSite']>; let s: ReturnType<FakeRepo['addSite']>; let kitchen: ReturnType<FakeRepo['addTeam']>;
  beforeEach(async () => {
    repo = new FakeRepo(); store = new FakeCommsStore(); mailer = new FakeMailer();
    org = repo.addOrg('Acme'); n = repo.addSite(org, 'North'); s = repo.addSite(org, 'South'); kitchen = repo.addTeam(org, 'Kitchen', n);
    repo.addMember(org, 'owner@a.com', 'owner', null, U.owner); repo.addMember(org, 'mgr@a.com', 'site_manager', n, U.mgr);
    const s1 = repo.addMember(org, 'one@a.com', 'staff', n, U.s1); repo.addMember(org, 'two@a.com', 'staff', n, U.s2); repo.addMember(org, 'three@a.com', 'staff', s, U.s3);
    await repo.setMemberTeams(s1.id, [kitchen.id]);
    app = await buildApp(testConfig, { repo, commsStore: store, mailer, verifyToken: fakeVerifier({
      o: { userId: U.owner, email: 'owner@a.com' }, m: { userId: U.mgr, email: 'mgr@a.com' }, a: { userId: U.s1, email: 'one@a.com' }, b: { userId: U.s2, email: 'two@a.com' }, c: { userId: U.s3, email: 'three@a.com' } }) });
  });
  const call = (tok: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { authorization: 'Bearer ' + tok }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const base = () => `/api/v1/orgs/${org.id}/announcements`;
  const send = async (tok: string, body: Record<string, unknown>) => call(tok, 'POST', base(), { title: 'Fire drill', body: 'Friday at 3pm. Meet at the car park.', ...body });
  const feed = async (tok: string, site = n.id) => (await call(tok, 'GET', `/api/v1/chat/updates?site_id=${site}`)).json();

  it('lets an owner write to everyone and a site manager to their own venue or its teams only', async () => {
    expect((await send('o', {})).statusCode).toBe(201);
    expect((await send('m', {})).statusCode).toBe(403);
    expect((await send('m', { site_id: n.id })).statusCode).toBe(201);
    expect((await send('m', { site_id: s.id })).statusCode).toBe(403);
    const team = await send('m', { team_id: kitchen.id }); expect(team.statusCode).toBe(201); expect(team.json()).toMatchObject({ team_id: kitchen.id, site_id: n.id });
    expect((await send('a', { site_id: n.id })).statusCode).toBe(403);
  });
  it('shows staff the updates for their company, venue and teams, and nothing else', async () => {
    await send('o', { title: 'Everyone' }); await send('o', { title: 'North only', site_id: n.id }); await send('o', { title: 'Kitchen only', team_id: kitchen.id });
    expect((await feed('a')).data.map((d: { title: string }) => d.title).sort()).toEqual(['Everyone', 'Kitchen only', 'North only']);
    expect((await feed('b')).data.map((d: { title: string }) => d.title).sort()).toEqual(['Everyone', 'North only']);
    expect((await feed('c', s.id)).data.map((d: { title: string }) => d.title)).toEqual(['Everyone']);
    expect((await call('c', 'GET', `/api/v1/chat/updates?site_id=${n.id}`)).statusCode).toBe(403);
  });
  it('counts who has read it and who has confirmed', async () => {
    const u = (await send('o', { requires_ack: true })).json();
    expect((await feed('a')).unread).toBe(1);
    expect((await call('a', 'POST', `/api/v1/chat/updates/${u.id}/read`, { site_id: n.id })).statusCode).toBe(200);
    expect((await feed('a')).unread).toBe(1); // read, but still has to confirm
    await call('a', 'POST', `/api/v1/chat/updates/${u.id}/read`, { site_id: n.id, ack: true });
    expect((await feed('a')).unread).toBe(0);
    await call('b', 'POST', `/api/v1/chat/updates/${u.id}/read`, { site_id: n.id });
    const list = (await call('o', 'GET', base())).json().data[0];
    expect(list.stats).toEqual({ recipients: 4, read: 2, acked: 1 }); // mgr, one, two, three
    const d = (await call('o', 'GET', `${base()}/${u.id}/readers`)).json();
    expect(d.people.map((p: { email: string; read_at: string | null }) => [p.email, !!p.read_at])).toEqual([['mgr@a.com', false], ['three@a.com', false], ['one@a.com', true], ['two@a.com', true]]);
  });
  it('only asks for confirmation when the sender asked, and only for updates you can see', async () => {
    const plain = (await send('o', {})).json();
    expect((await call('a', 'POST', `/api/v1/chat/updates/${plain.id}/read`, { site_id: n.id, ack: true })).statusCode).toBe(400);
    const northOnly = (await send('o', { site_id: n.id })).json();
    expect((await call('c', 'POST', `/api/v1/chat/updates/${northOnly.id}/read`, { site_id: s.id })).statusCode).toBe(404);
  });
  it('emails the people it is for only when asked', async () => {
    await send('o', { site_id: n.id });
    expect(mailer.sent).toHaveLength(0);
    const r = await send('o', { site_id: n.id, email: true, title: 'Rota change' });
    expect(r.json().emailed).toBe(3); // mgr, one, two
    expect(mailer.sent.map((x) => x.to).sort()).toEqual(['mgr@a.com', 'one@a.com', 'two@a.com']);
    expect(mailer.sent[0]!.subject).toBe('Rota change');
  });
  it('lets a manager correct or take down only what they can manage', async () => {
    const mine = (await send('m', { site_id: n.id })).json(); const wide = (await send('o', {})).json();
    expect((await call('m', 'PATCH', `${base()}/${mine.id}`, { title: 'Fire drill moved' })).json()).toMatchObject({ title: 'Fire drill moved' });
    expect((await call('m', 'PATCH', `${base()}/${wide.id}`, { title: 'hijack' })).statusCode).toBe(403);
    expect((await call('m', 'DELETE', `${base()}/${wide.id}`)).statusCode).toBe(403);
    expect((await call('m', 'DELETE', `${base()}/${mine.id}`)).statusCode).toBe(200);
    expect((await call('a', 'GET', base())).json().data).toEqual([]); // staff see no manager list
  });
  it('refuses an empty title or message and a venue from another company', async () => {
    expect((await send('o', { title: ' ' })).statusCode).toBe(400);
    expect((await send('o', { body: '' })).statusCode).toBe(400);
    expect((await send('o', { site_id: randomUUID() })).statusCode).toBe(400);
  });
  it('writes a safe email', () => {
    const e = announcementEmail({ to: 'a@b.co', org: 'Acme', title: 'Fire <b>drill</b>', body: 'Line one\n\nLine two <script>', from: 'amy@a.com', ask: true, url: 'https://stackedchat.io/chat/' });
    expect(e.html).not.toContain('<script>'); expect(e.html).not.toContain('<b>drill'); expect(e.html).toContain('confirm you have read this'); expect(e.text).toContain('Line two');
  });
});
