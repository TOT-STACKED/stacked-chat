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
