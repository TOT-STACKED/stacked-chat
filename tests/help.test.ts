import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createHelp, helpEmail, pickRecipients, type TicketRow } from '../src/modules/chat/help.js';
import type { Who } from '../src/modules/chat/service.js';
import type { MemberRow } from '../src/lib/repo.js';
import { FakeConversationStore } from '../src/testing/chat-fakes.js';
import { FakeKnowledgeStore } from '../src/testing/knowledge-fakes.js';
import { FakeMailer, FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { testConfig } from './helpers.js';

const m = (o: Partial<MemberRow>): MemberRow => ({ id: randomUUID(), org_id: 'o', site_id: null, user_id: null, email: 'x@a.com', display_name: null, role: 'staff', status: 'active', created_at: '', ...o });

describe('who gets told', () => {
  const members = [
    m({ email: 'owner@a.com', role: 'owner' }), m({ email: 'hq@a.com', role: 'hq_admin', display_name: 'Harper' }),
    m({ email: 'mgrN@a.com', role: 'site_manager', site_id: 'north', display_name: 'Alex' }), m({ email: 'mgrS@a.com', role: 'site_manager', site_id: 'south' }),
    m({ email: 'amy@a.com', role: 'staff', site_id: 'north' }), m({ email: 'gone@a.com', role: 'owner', status: 'disabled' }), m({ email: 'wait@a.com', role: 'site_manager', site_id: 'north', status: 'invited' }),
  ];
  it("the venue's own managers first, then company admins; nobody from other venues, staff, invited or disabled", () => {
    expect(pickRecipients(members, 'north', 'amy@a.com').map((r) => r.email)).toEqual(['mgrn@a.com', 'owner@a.com', 'hq@a.com']);
    expect(pickRecipients(members, 'north', 'amy@a.com')[0]).toEqual({ email: 'mgrn@a.com', name: 'Alex' });
  });
  it('never emails the person who asked, and lists each person once', () => {
    expect(pickRecipients(members, 'north', 'OWNER@a.com').map((r) => r.email)).not.toContain('owner@a.com');
    expect(pickRecipients([...members, m({ email: 'MGRN@a.com', role: 'site_manager', site_id: 'north' })], 'north', 'x').filter((r) => r.email === 'mgrn@a.com')).toHaveLength(1);
  });
});

describe('the email', () => {
  it('carries the question, what the AI said and a way to fix it for everyone, with the asker as reply-to', () => {
    const e = helpEmail({ to: 'a@a.com', toName: 'Alex', from: 'amy@a.com', fromName: 'Amy', venue: 'North', org: 'Acme', question: 'Do we get paid for training?', answer: "I don't have that.", note: 'Starting Monday', manageUrl: 'https://x.co/manage/#/knowledge' });
    expect(e.subject).toBe('Amy at North needs help: Do we get paid for training?'); expect(e.replyTo).toBe('amy@a.com');
    expect(e.text).toContain('Question: Do we get paid for training?'); expect(e.text).toContain('Starting Monday'); expect(e.html).toContain('Add the answer to Knowledge');
  });
  it('treats everything the person typed as plain text', () => {
    const e = helpEmail({ to: 'a@a.com', toName: 'A', from: 'amy@a.com', fromName: '<b>Amy</b>', venue: 'N', org: 'O', question: '<script>alert(1)</script>', answer: '<img src=x onerror=1>', note: '"><svg onload=1>', manageUrl: 'https://x.co/' });
    expect(e.html).not.toMatch(/<script|<img|<svg|<b>Amy/); expect(e.html).toContain('&lt;script&gt;');
  });
});

describe('asking a person', () => {
  let convs: FakeConversationStore; let mailer: FakeMailer; let tickets: TicketRow[]; let alerts: string[]; let repo: FakeRepo; let cid: number;
  let org: ReturnType<FakeRepo['addOrg']>; let north: ReturnType<FakeRepo['addSite']>; let who: Who;
  const help = (over: Partial<Parameters<typeof createHelp>[0]> = {}) => createHelp({ repo, tickets: { save: async (t) => { tickets.push(t); } }, mailer, conversations: convs, publicUrl: 'https://stackedchat.io', notify: async (t) => { alerts.push(t); }, ...over });
  beforeEach(async () => {
    convs = new FakeConversationStore(); mailer = new FakeMailer(); tickets = []; alerts = []; repo = new FakeRepo();
    org = repo.addOrg('Acme'); north = repo.addSite(org, 'North');
    repo.addMember(org, 'owner@a.com', 'owner', null); repo.addMember(org, 'alex@a.com', 'site_manager', north); repo.addMember(org, 'amy@a.com', 'staff', north);
    repo.members.find((x) => x.email === 'alex@a.com')!.display_name = 'Alex';
    who = { email: 'amy@a.com', name: 'Amy', orgId: org.id, orgName: 'Acme', siteId: north.id, siteName: 'North', teamIds: [], botName: null };
    cid = await convs.create({ email: 'amy@a.com', venue_id: north.id, messages: [{ role: 'user', content: 'Do we get paid for training?' }, { role: 'assistant', content: "I don't have that in your knowledge base yet." }] } as never);
  });

  it('emails the managers with the question and answer, records a ticket, and says who was told', async () => {
    const r = await help().ask(who, { target: 'manager', conversation_id: cid, note: 'Starting Monday' });
    expect(r).toEqual({ target: 'manager', logged: true, notified: ['Alex', 'owner'] });
    expect(mailer.sent.map((x) => x.to)).toEqual(['alex@a.com', 'owner@a.com']);
    expect(mailer.sent[0]).toMatchObject({ replyTo: 'amy@a.com' }); expect(mailer.sent[0]!.text).toContain('Do we get paid for training?');
    expect(tickets[0]).toMatchObject({ email: 'amy@a.com', venue: 'North', status: 'open', escalated: false }); expect(tickets[0]!.issue).toContain('Starting Monday');
    expect(alerts).toEqual([]); // a manager question is private to the company: nothing goes to Stacked's Slack
  });
  it('when there is nobody to email, it still logs it and says so', async () => {
    const empty = new FakeRepo(); const o = empty.addOrg('Solo'); const s = empty.addSite(o, 'Only'); empty.addMember(o, 'amy@a.com', 'staff', s);
    const r = await help({ repo: empty }).ask({ ...who, orgId: o.id, siteId: s.id }, { target: 'manager', conversation_id: await convs.create({ email: 'amy@a.com', venue_id: s.id, messages: [{ role: 'user', content: 'Where is the key?' }] } as never) });
    expect(r).toEqual({ target: 'manager', logged: true, notified: [] }); expect(mailer.sent).toHaveLength(0);
  });
  it('can go to Stacked support through Slack instead, marked as escalated, with no email', async () => {
    const r = await help().ask(who, { target: 'stacked', conversation_id: cid });
    expect(r).toEqual({ target: 'stacked', logged: true, notified: ['Stacked support'] });
    expect(alerts[0]).toContain('*Company:* Acme'); expect(alerts[0]).toContain('Do we get paid for training?'); expect(mailer.sent).toHaveLength(0); expect(tickets[0]!.escalated).toBe(true);
    expect((await help({ notify: null }).ask(who, { target: 'stacked', conversation_id: cid })).notified).toEqual([]); // not configured: logged only
  });
  it("only works on your own conversation at your own venue", async () => {
    await expect(help().ask({ ...who, email: 'eve@a.com' }, { target: 'manager', conversation_id: cid })).rejects.toMatchObject({ statusCode: 404 });
    await expect(help().ask({ ...who, siteId: randomUUID() }, { target: 'manager', conversation_id: cid })).rejects.toMatchObject({ statusCode: 404 });
    await expect(help().ask(who, { target: 'manager', conversation_id: 999 })).rejects.toMatchObject({ statusCode: 404 });
    expect(mailer.sent).toHaveLength(0);
  });
  it('is limited to a few requests an hour, and a failed ticket save never stops the email', async () => {
    const h2 = help({ perHour: 2, tickets: { save: async () => { throw new Error('db'); } } });
    expect((await h2.ask(who, { target: 'manager', conversation_id: cid })).logged).toBe(false);
    expect(mailer.sent.length).toBeGreaterThan(0);
    await h2.ask(who, { target: 'manager', conversation_id: cid });
    await expect(h2.ask(who, { target: 'manager', conversation_id: cid })).rejects.toMatchObject({ statusCode: 429 });
  });
  it('cleans what the person typed before it is stored or sent', async () => {
    await help().ask(who, { target: 'manager', conversation_id: cid, note: '<b>hi</b>' });
    expect(tickets[0]!.issue).not.toContain('<b>'); expect(mailer.sent[0]!.html).not.toContain('<b>hi');
  });
});

describe('help API', () => {
  let app: FastifyInstance; let mailer: FakeMailer;
  const U = { amy: randomUUID(), sam: randomUUID() };
  it('works end to end for a member, and refuses other venues', async () => {
    const repo = new FakeRepo(); mailer = new FakeMailer(); const convs = new FakeConversationStore(); const k = new FakeKnowledgeStore();
    const org = repo.addOrg('Acme'); const n = repo.addSite(org, 'North'); const s = repo.addSite(org, 'South'); k.addOrg(org.id, 'acme', 'acme');
    repo.addMember(org, 'amy@a.com', 'staff', n, U.amy); repo.addMember(org, 'alex@a.com', 'site_manager', n); repo.addMember(org, 'sam@a.com', 'staff', s, U.sam);
    app = await buildApp(testConfig, { repo, mailer, knowledgeStore: k, conversationStore: convs, chatModel: { complete: async () => "I don't have that in your knowledge base yet." }, ticketStore: { save: async () => undefined }, notify: null,
      verifyToken: fakeVerifier({ a: { userId: U.amy, email: 'amy@a.com' }, s: { userId: U.sam, email: 'sam@a.com' } }) });
    const post = (t: string, url: string, body: object) => app.inject({ method: 'POST', url, headers: { authorization: 'Bearer ' + t }, payload: body });
    const chat = (await post('a', '/api/v1/chat', { site_id: n.id, message: 'Do we get paid for training days?' })).json();
    const ok = await post('a', '/api/v1/chat/help', { site_id: n.id, conversation_id: chat.conversation_id, target: 'manager', note: 'please' });
    expect(ok.statusCode).toBe(200); expect(ok.json()).toMatchObject({ target: 'manager', notified: ['alex'] }); expect(mailer.sent[0]!.to).toBe('alex@a.com');
    expect((await post('s', '/api/v1/chat/help', { site_id: n.id, conversation_id: chat.conversation_id })).statusCode).toBe(403);
    expect((await post('s', '/api/v1/chat/help', { site_id: s.id, conversation_id: chat.conversation_id })).statusCode).toBe(404);
    expect((await post('a', '/api/v1/chat/help', { site_id: n.id, conversation_id: chat.conversation_id, target: 'everyone' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/chat/help', payload: { site_id: n.id, conversation_id: 1 } })).statusCode).toBe(401);
  });
});
