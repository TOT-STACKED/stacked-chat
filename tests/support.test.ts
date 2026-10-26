import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { TicketRow } from '../src/modules/chat/help.js';
import { supportEmail } from '../src/modules/support/service.js';
import { FakeMailer, FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { testConfig } from './helpers.js';

describe('support requests', () => {
  let repo: FakeRepo; let app: FastifyInstance; let mailer: FakeMailer; let slack: string[]; let tickets: TicketRow[];
  const U = { mgr: randomUUID(), staff: randomUUID(), other: randomUUID() };
  let org: ReturnType<FakeRepo['addOrg']>; let n: ReturnType<FakeRepo['addSite']>; let elsewhere: ReturnType<FakeRepo['addSite']>;
  beforeEach(async () => {
    repo = new FakeRepo(); mailer = new FakeMailer(); slack = []; tickets = [];
    org = repo.addOrg('Acme'); n = repo.addSite(org, 'North');
    const other = repo.addOrg('Other Co'); elsewhere = repo.addSite(other, 'Their site');
    repo.addMember(org, 'mgr@a.com', 'site_manager', n, U.mgr).display_name = 'Amy Manager'; repo.addMember(org, 'staff@a.com', 'staff', n, U.staff);
    repo.addMember(other, 'x@o.com', 'owner', null, U.other);
    app = await buildApp({ ...testConfig, SUPPORT_EMAIL: 'support@stacked.test' }, { repo, mailer, notify: async (t) => { slack.push(t); }, ticketStore: { save: async (t) => { tickets.push(t); } },
      verifyToken: fakeVerifier({ m: { userId: U.mgr, email: 'mgr@a.com' }, s: { userId: U.staff, email: 'staff@a.com' }, o: { userId: U.other, email: 'x@o.com' } }) });
  });
  const send = (tok: string | null, body: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1/support', headers: tok ? { authorization: 'Bearer ' + tok } : {}, payload: body });

  it('tells Slack straight away with who, where and what, and logs a ticket', async () => {
    const r = await send('m', { message: 'The Operations page will not load', kind: 'problem', org_id: org.id, site_id: n.id, page: '#/operations', source: 'manage', device: 'iPhone Safari' });
    expect(r.statusCode).toBe(200); expect(r.json()).toEqual({ sent: true, emailed: true, ticket: true });
    expect(slack).toHaveLength(1);
    expect(slack[0]).toContain('Amy Manager (mgr@a.com), Site manager'); expect(slack[0]).toContain('Acme'); expect(slack[0]).toContain('North');
    expect(slack[0]).toContain('Something is not working'); expect(slack[0]).toContain('Manage (#/operations)'); expect(slack[0]).toContain('The Operations page will not load'); expect(slack[0]).toContain('iPhone Safari');
    expect(tickets[0]).toMatchObject({ email: 'mgr@a.com', venue: 'North', escalated: true, status: 'open' }); expect(tickets[0]!.issue).toContain('The Operations page will not load');
  });
  it('emails the support inbox so a reply goes to the customer, and sends the customer a receipt', async () => {
    await send('s', { message: 'How do I change my name?', source: 'chat', site_id: n.id });
    const inbox = mailer.sent.find((m) => m.to === 'support@stacked.test')!;
    expect(inbox.replyTo).toBe('staff@a.com'); expect(inbox.subject).toBe('[Support] A question: How do I change my name?'); expect(inbox.text).toContain('Staff at Acme, North'); expect(inbox.text).toContain('the chat');
    const receipt = mailer.sent.find((m) => m.to === 'staff@a.com')!;
    expect(receipt.subject).toBe('We have your message'); expect(receipt.text).toContain('support@stacked.test');
  });
  it('works for staff and for people with no venue chosen, and ignores a venue that is not theirs', async () => {
    expect((await send('s', { message: 'Hello support' })).statusCode).toBe(200);
    expect(tickets).toHaveLength(1); expect(tickets[0]!.venue_id).toBe(n.id); // filed under their company's first venue
    slack.length = 0;
    await send('m', { message: 'Trying another venue', site_id: elsewhere.id });
    expect(slack[0]).not.toContain('Their site'); expect(slack[0]).not.toContain('Other Co');
  });
  it('cleans the message and refuses an empty one or a visitor who is not signed in', async () => {
    await send('m', { message: '  <script>alert(1)</script> hello  ' });
    expect(slack[0]).not.toContain('<script>');
    expect((await send('m', { message: ' a ' })).statusCode).toBe(400);
    expect((await send(null, { message: 'hello there' })).statusCode).toBe(401);
  });
  it('still reaches Slack if the log or the email fails, and limits floods', async () => {
    mailer.result = 'failed';
    const r = await send('m', { message: 'Email is down' });
    expect(r.json()).toMatchObject({ sent: true, emailed: false });
    for (let i = 0; i < 5; i++) expect((await send('m', { message: `message ${i}` })).statusCode).toBe(200);
    expect((await send('m', { message: 'one too many' })).statusCode).toBe(429);
  });
  it('writes a safe email', () => {
    const e = supportEmail({ to: 'a@b.co', replyTo: 'u@x.co', from: 'u@x.co', name: '<b>Eve</b>', role: 'Owner', org: '<i>Co</i>', venue: null, kind: 'idea', message: '<script>x</script>', where: 'Manage', device: null });
    expect(e.html).not.toContain('<script>'); expect(e.html).not.toContain('<b>Eve'); expect(e.replyTo).toBe('u@x.co');
  });
});

import { checkSlack, createSlackNotifier } from '../src/lib/slack.js';

describe('support is honest about delivery', () => {
  const U = { mgr: randomUUID() };
  const setup = async (over: Record<string, unknown> = {}, cfg: Record<string, unknown> = {}) => {
    const repo = new FakeRepo(); const org = repo.addOrg('Acme'); const n = repo.addSite(org, 'North'); repo.addMember(org, 'mgr@a.com', 'site_manager', n, U.mgr);
    return buildApp({ ...testConfig, ...cfg }, { repo, ...over, verifyToken: fakeVerifier({ m: { userId: U.mgr, email: 'mgr@a.com' } }) });
  };
  const send = (app: FastifyInstance) => app.inject({ method: 'POST', url: '/api/v1/support', headers: { authorization: 'Bearer m' }, payload: { message: 'Is anyone there?' } });
  it('does not say "sent" when nothing reached a person', async () => {
    const none = await send(await setup({ notify: null, mailer: undefined }));
    expect(none.statusCode).toBe(503); expect(none.json().error.message).toContain('could not pass your message on');
    const refused = await send(await setup({ notify: async () => false, mailer: new FakeMailer() })); // Slack refuses, no support inbox set
    expect(refused.statusCode).toBe(503);
  });
  it('is fine if Slack is refused but the support inbox got it, or the reverse', async () => {
    const inbox = await send(await setup({ notify: async () => false, mailer: new FakeMailer() }, { SUPPORT_EMAIL: 'support@x.test' }));
    expect(inbox.statusCode).toBe(200); expect(inbox.json()).toMatchObject({ slack: false, emailed: true });
    const slack = await send(await setup({ notify: async () => true, mailer: undefined }));
    expect(slack.json()).toMatchObject({ slack: true, emailed: false });
  });
  it('says what Slack answered, in plain words, without showing the link', async () => {
    const reply = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch;
    expect(await createSlackNotifier('https://hooks/x', reply(200, 'ok'))('hi')).toBe(true);
    expect(await createSlackNotifier('https://hooks/x', reply(404, 'no_service'))('hi')).toBe(false);
    expect((await checkSlack(undefined, 'x')).configured).toBe(false);
    const ok = await checkSlack('https://hooks/secret-link', 'x', reply(200, 'ok')); expect(ok).toMatchObject({ ok: true, status: 200 });
    const gone = await checkSlack('https://hooks/secret-link', 'x', reply(404, 'no_service')); expect(gone.ok).toBe(false); expect(gone.detail).toContain('no_service'); expect(gone.detail).not.toContain('secret-link');
  });
  it('lets only Stacked staff see which connections are set and run the test', async () => {
    const app = await setup({ mailer: new FakeMailer() }, { STACKED_STAFF_EMAILS: 'mgr@a.com', SUPPORT_EMAIL: 'support@x.test' });
    const info = await app.inject({ method: 'GET', url: '/api/v1/console/connections', headers: { authorization: 'Bearer m' } });
    expect(info.statusCode).toBe(200); expect(info.json()).toMatchObject({ slack_alerts: false, email: false, support_inbox: 'support@x.test' }); expect(JSON.stringify(info.json())).not.toContain('hooks.slack');
    const test = await app.inject({ method: 'POST', url: '/api/v1/console/connections/test', headers: { authorization: 'Bearer m' } });
    expect(test.json()).toMatchObject({ alerts: { configured: false, ok: false }, email: 'sent', email_to: 'mgr@a.com' });
    const other = await setup({}, { STACKED_STAFF_EMAILS: 'someone@else.com' });
    expect((await other.inject({ method: 'GET', url: '/api/v1/console/connections', headers: { authorization: 'Bearer m' } })).statusCode).toBe(403);
  });
});
