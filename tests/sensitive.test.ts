import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { ChatModel, ChatTurn } from '../src/modules/chat/model.js';
import { createChat, type Who } from '../src/modules/chat/service.js';
import { createHelp, helpEmail } from '../src/modules/chat/help.js';
import { createKnowledge } from '../src/modules/knowledge/service.js';
import { createSensitiveSettings } from '../src/modules/sensitive/store.js';
import { CONFIRM_LINE, detectSensitive, TOPIC_IDS, TOPICS, withConfirmLine, type TopicId } from '../src/modules/sensitive/topics.js';
import { FakeConversationStore } from '../src/testing/chat-fakes.js';
import { FakeKnowledgeStore } from '../src/testing/knowledge-fakes.js';
import { FakeSensitiveStore } from '../src/testing/sensitive-fakes.js';
import { FakeMailer, FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { testConfig } from './helpers.js';

const ALL = new Set<TopicId>(TOPIC_IDS);
const hit = (msg: string, on: ReadonlySet<TopicId> = ALL) => detectSensitive(msg, on)?.id ?? null;

describe('spotting a sensitive question', () => {
  it('sends HR matters to a manager', () => {
    for (const q of ['I want to raise a grievance', 'my manager is bullying me', 'I am being harassed on shift', 'what is the disciplinary process?', 'am I going to be sacked', 'is this unfair dismissal', 'I got a written warning', 'will there be redundancies', 'he made an inappropriate comment to me', 'who do I tell about discrimination'])
      expect(hit(q), q).toBe('hr');
  });
  it('sends accidents and incidents to a manager', () => {
    for (const q of ['a guest fainted at table 4', 'I cut myself in the kitchen', 'there has been an accident', 'a customer was assaulted', 'someone is having an allergic reaction', 'we think it is food poisoning', 'there was a break-in last night', 'RIDDOR report'])
      expect(hit(q), q).toBe('incidents');
  });
  it('sends legal matters, complaints and claims to a manager', () => {
    for (const q of ['should I speak to a solicitor', 'the police are at the door', 'a guest is threatening legal action', 'how do I make a formal complaint', 'trading standards visited', 'we got a compensation claim'])
      expect(hit(q), q).toBe('legal');
  });
  it('answers-then-confirms allergen questions', () => {
    for (const q of ['is the brownie nut free?', 'does the soup contain gluten', 'what allergens are in the burger', 'Is there nuts in the brownie?', 'can a coeliac eat this', 'is it safe for a vegan guest', 'which dishes are dairy-free', 'lactose intolerant customer asking', 'sesame in the bun?'])
      expect(hit(q), q).toBe('allergens');
    expect(TOPICS.find((t) => t.id === 'allergens')!.mode).toBe('confirm');
    for (const t of TOPICS.filter((x) => x.id !== 'allergens')) expect(t.mode).toBe('manager');
  });
  it('leaves everyday questions alone', () => {
    for (const q of ['What is the guest Wi-Fi password?', 'How do I reset the card terminal?', 'when do I get paid', 'where is the first aid kit', 'how do I swap a shift', 'how do we light the wood-fired oven', 'directions to the food court entrance', 'what time do we open', 'how do I do a void after 11pm', 'the kitchen printer is dead', 'what is the holiday request process', 'who do I call about a delivery problem', 'how do I fire the grill'])
      expect(hit(q), q).toBeNull();
  });
  it('puts people first when a message touches several topics', () => {
    expect(hit('a guest had an allergic reaction to nuts')).toBe('incidents'); // not a mere allergen question
    expect(hit('I want to make a formal complaint about harassment')).toBe('hr');
    expect(hit('is the brownie nut free? the guest is threatening legal action')).toBe('legal');
  });
  it('ignores a topic that has been switched off', () => {
    const noAllergens = new Set<TopicId>(['hr', 'incidents', 'legal']);
    expect(hit('is it nut free?', noAllergens)).toBeNull();
    expect(hit('I want to raise a grievance', new Set<TopicId>(['allergens']))).toBeNull();
    expect(hit('anything at all', new Set())).toBeNull();
  });
  it('adds the "confirm" reminder before any Source line, once, and not when the answer already says it', () => {
    expect(withConfirmLine('Yes, it has walnuts.')).toBe(`Yes, it has walnuts.\n\n${CONFIRM_LINE}`);
    expect(withConfirmLine('Yes, it has walnuts.\nSource: Menu spec')).toBe(`Yes, it has walnuts.\n${CONFIRM_LINE}\n\nSource: Menu spec`);
    const already = 'I do not have verified allergen information. Please check with the kitchen or duty manager before serving.';
    expect(withConfirmLine(already)).toBe(already);
  });
});

describe('the switches', () => {
  it('everything is on to begin with, a change applies at once, and each organisation has its own', async () => {
    const store = new FakeSensitiveStore(); const s = createSensitiveSettings(store);
    expect([...await s.enabled('o1')].sort()).toEqual([...TOPIC_IDS].sort());
    await s.set('o1', 'hr', false);
    expect((await s.enabled('o1')).has('hr')).toBe(false); expect((await s.enabled('o2')).has('hr')).toBe(true);
    expect((await s.list('o1')).find((t) => t.id === 'hr')).toMatchObject({ enabled: false, mode: 'manager' });
    await s.set('o1', 'hr', true);
    expect((await s.enabled('o1')).has('hr')).toBe(true);
  });
  it('reads once and then uses its short memory, but never keeps a stale answer after a change', async () => {
    let t = 0; const store = new FakeSensitiveStore(); const s = createSensitiveSettings(store, { now: () => t });
    await s.enabled('o'); await s.enabled('o'); expect(store.reads).toBe(1);
    t = 31_000; await s.enabled('o'); expect(store.reads).toBe(2);
    await s.set('o', 'legal', false); await s.enabled('o'); expect(store.reads).toBe(3);
  });
  it('if the database cannot be read, every topic counts as ON (the safe way round)', async () => {
    const store = new FakeSensitiveStore(); store.fail = true;
    expect([...await createSensitiveSettings(store).enabled('o')].sort()).toEqual([...TOPIC_IDS].sort());
  });
});

class FakeModel implements ChatModel {
  calls: Array<{ system: string; messages: ChatTurn[] }> = []; reply: string | null = 'The brownie contains walnuts.\nSource: Allergen matrix';
  async complete(i: { system: string; messages: ChatTurn[] }) { this.calls.push(i); return this.reply; }
}

describe('what the chat does', () => {
  const ORG = 'org-1';
  let kstore: FakeKnowledgeStore; let convs: FakeConversationStore; let model: FakeModel; let answered: string[]; let north: string; let on: ReadonlySet<TopicId>;
  const me = (): Who => ({ email: 'amy@a.com', name: 'Amy', orgId: ORG, orgName: 'Acme', siteId: north, siteName: 'North', teamIds: [], botName: null });
  const make = (over: Partial<Parameters<typeof createChat>[0]> = {}) =>
    createChat({ items: async (o) => kstore.listItems(o), conversations: convs, model, onAnswered: (s) => { answered.push(s); }, sensitive: async () => on, ...over });
  beforeEach(async () => {
    kstore = new FakeKnowledgeStore(); convs = new FakeConversationStore(); model = new FakeModel(); answered = []; on = ALL;
    kstore.addOrg(ORG, 'acme', 'acme'); north = kstore.addSite(ORG).id;
    await createKnowledge({ store: kstore }).createDocument(ORG, { title: 'Allergen matrix', body: 'The brownie contains walnuts. The gluten free brownie is nut free.', site_id: null, status: 'published', by: 'a@b.co' });
  });

  it('HR, incident and legal questions are not answered by the AI: no model call, no AI question counted, a person is offered', async () => {
    const chat = make();
    const r = await chat.ask(me(), { message: 'I want to raise a grievance about my manager' });
    expect(model.calls).toEqual([]); expect(answered).toEqual([]);
    expect(r.sensitive).toEqual({ topic: 'hr', label: 'Discipline, grievances and HR matters', mode: 'manager' });
    expect(r.reply).toContain('Ask my manager'); expect(r.reply).toContain('HR');
    expect(r).toMatchObject({ unanswered: false, sources: [], videos: [], images: [], support: null, nps: null });
    expect((convs.rows[0]!.messages ?? []).map((m) => m.role)).toEqual(['user', 'assistant']); // saved, so the Ask my manager button has a conversation to send
    const inc = await chat.ask(me(), { message: 'a guest fainted', conversation_id: r.conversation_id });
    expect(inc.reply).toContain('999'); expect(inc.sensitive).toMatchObject({ topic: 'incidents', mode: 'manager' });
    expect((await chat.ask(me(), { message: 'we are being sued', conversation_id: r.conversation_id })).sensitive).toMatchObject({ topic: 'legal' });
    expect(model.calls).toEqual([]); expect(convs.rows[0]!.messages).toHaveLength(6);
  });
  it('still routes to a person when the assistant is switched off, but ordinary questions get the usual 503', async () => {
    const chat = make({ model: null });
    expect((await chat.ask(me(), { message: 'I am being bullied' })).sensitive).toMatchObject({ topic: 'hr' });
    await expect(chat.ask(me(), { message: 'what time do we open' })).rejects.toMatchObject({ statusCode: 503 });
  });
  it('allergen questions are answered from the documents, then the person is told to confirm', async () => {
    const r = await make().ask(me(), { message: 'Is there nuts in the brownie?' });
    expect(model.calls).toHaveLength(1); expect(answered).toEqual([north]); // a normal AI answer
    expect(r.sensitive).toEqual({ topic: 'allergens', label: 'Allergens and food safety', mode: 'confirm' });
    expect(r.reply).toBe(`The brownie contains walnuts.\n${CONFIRM_LINE}\n\nSource: Allergen matrix`);
    expect(r.sources.map((s) => s.title)).toEqual(['Allergen matrix']); // the source still shows
    expect((convs.rows[0]!.messages ?? [])[1]!.content).toContain(CONFIRM_LINE); // and it is there when the conversation is reopened
  });
  it('an allergen answer that already tells them to check with a manager is not repeated', async () => {
    model.reply = "I don't have verified allergen information for that in your knowledge base. Please check with the kitchen or duty manager before serving.";
    const r = await make().ask(me(), { message: 'is the soup gluten free?' });
    expect(r.reply).toBe(model.reply); expect(r.unanswered).toBe(true); /* still a gap for Insights: they should add the allergen document */ expect(r.sensitive?.mode).toBe('confirm');
  });
  it('with a topic switched off, that question is handled as normal', async () => {
    on = new Set<TopicId>(['allergens', 'incidents', 'legal']); // HR off
    const hr = await make().ask(me(), { message: 'I want to raise a grievance' });
    expect(model.calls).toHaveLength(1); expect(hr.sensitive).toBeNull(); expect(hr.reply).not.toContain('Ask my manager');
    on = new Set<TopicId>(['hr', 'incidents', 'legal']); // allergens off
    const al = await make().ask(me(), { message: 'is it nut free?' });
    expect(al.sensitive).toBeNull(); expect(al.reply).not.toContain(CONFIRM_LINE);
  });
  it('if the switches cannot be read, it errs on the safe side and treats every topic as on', async () => {
    const r = await make({ sensitive: async () => { throw new Error('db down'); } }).ask(me(), { message: 'I want to raise a grievance' });
    expect(r.sensitive).toMatchObject({ topic: 'hr' }); expect(model.calls).toEqual([]);
  });
  it('ordinary questions are untouched', async () => {
    const r = await make().ask(me(), { message: 'How do I reset the card terminal?' });
    expect(r.sensitive).toBeNull(); expect(model.calls).toHaveLength(1);
  });
});

describe('asking a person about a sensitive question', () => {
  it('flags the email so the manager sees why, and says whether the AI answered', () => {
    const base = { to: 'a@a.com', toName: 'Alex', from: 'amy@a.com', fromName: 'Amy', venue: 'North', org: 'Acme', question: 'q', answer: null, note: null, manageUrl: 'https://x.co/' };
    const routed = helpEmail({ ...base, flag: { label: 'Discipline, grievances and HR matters', answered: false } });
    expect(routed.text).toContain('Flagged as sensitive: Discipline, grievances and HR matters. The assistant did not answer this'); expect(routed.html).toContain('Flagged as sensitive');
    expect(helpEmail({ ...base, flag: { label: 'Allergens and food safety', answered: true } }).text).toContain('asked them to confirm with a manager');
    expect(helpEmail(base).text).not.toContain('Flagged');
  });
  it('is flagged only while the topic is switched on', async () => {
    const repo = new FakeRepo(); const org = repo.addOrg('Acme'); const north = repo.addSite(org, 'North');
    repo.addMember(org, 'alex@a.com', 'site_manager', north); repo.addMember(org, 'amy@a.com', 'staff', north);
    const convs = new FakeConversationStore(); const mailer = new FakeMailer(); let on: ReadonlySet<TopicId> = ALL;
    const help = createHelp({ repo, tickets: null, mailer, conversations: convs, publicUrl: 'https://stackedchat.io', sensitive: async () => on });
    const who: Who = { email: 'amy@a.com', name: 'Amy', orgId: org.id, orgName: 'Acme', siteId: north.id, siteName: 'North', teamIds: [], botName: null };
    const cid = await convs.create({ email: 'amy@a.com', venue_id: north.id, messages: [{ role: 'user', content: 'I want to raise a grievance' }] } as never);
    await help.ask(who, { target: 'manager', conversation_id: cid });
    expect(mailer.sent[0]!.text).toContain('Flagged as sensitive');
    on = new Set<TopicId>(['allergens']); mailer.sent.length = 0;
    const help2 = createHelp({ repo, tickets: null, mailer, conversations: convs, publicUrl: 'https://stackedchat.io', sensitive: async () => on, perHour: 50 });
    await help2.ask(who, { target: 'manager', conversation_id: cid });
    expect(mailer.sent[0]!.text).not.toContain('Flagged');
  });
});

describe('sensitive topics API', () => {
  let app: FastifyInstance; let store: FakeSensitiveStore; let model: FakeModel; let kstore: FakeKnowledgeStore;
  let org: ReturnType<FakeRepo['addOrg']>; let other: ReturnType<FakeRepo['addOrg']>; let n: ReturnType<FakeRepo['addSite']>;
  const U = { owner: randomUUID(), hq: randomUUID(), mgr: randomUUID(), staff: randomUUID(), otherOwner: randomUUID() };
  beforeEach(async () => {
    const repo = new FakeRepo(); store = new FakeSensitiveStore(); model = new FakeModel(); kstore = new FakeKnowledgeStore();
    org = repo.addOrg('Acme'); n = repo.addSite(org, 'North'); other = repo.addOrg('Other');
    kstore.addOrg(org.id, 'acme', 'acme'); kstore.sites.push({ id: n.id, org_id: org.id });
    repo.addMember(org, 'owner@a.com', 'owner', null, U.owner); repo.addMember(org, 'hq@a.com', 'hq_admin', null, U.hq);
    repo.addMember(org, 'mgr@a.com', 'site_manager', n, U.mgr); repo.addMember(org, 'staff@a.com', 'staff', n, U.staff); repo.addMember(other, 'oo@o.com', 'owner', null, U.otherOwner);
    app = await buildApp(testConfig, { repo, sensitiveStore: store, knowledgeStore: kstore, conversationStore: new FakeConversationStore(), chatModel: model,
      verifyToken: fakeVerifier({ o: { userId: U.owner, email: 'owner@a.com' }, h: { userId: U.hq, email: 'hq@a.com' }, m: { userId: U.mgr, email: 'mgr@a.com' }, s: { userId: U.staff, email: 'staff@a.com' }, x: { userId: U.otherOwner, email: 'oo@o.com' } }) });
  });
  const call = (method: 'GET' | 'PUT' | 'POST', url: string, tok: string, body?: object) => app.inject({ method, url, headers: { authorization: 'Bearer ' + tok }, payload: body });
  const url = (id = org.id) => `/api/v1/orgs/${id}/sensitive-topics`;

  it('lists the four topics, all on to begin with, saying what each does', async () => {
    const r = (await call('GET', url(), 'o')).json();
    expect(r.data.map((t: any) => [t.id, t.mode, t.enabled])).toEqual([['incidents', 'manager', true], ['hr', 'manager', true], ['legal', 'manager', true], ['allergens', 'confirm', true]]);
    expect(r.data.every((t: any) => t.label && t.summary)).toBe(true);
  });
  it('company admins can switch a topic off and on, and it sticks', async () => {
    let r = await call('PUT', `${url()}/hr`, 'h', { enabled: false });
    expect(r.statusCode).toBe(200); expect(r.json().data.find((t: any) => t.id === 'hr').enabled).toBe(false);
    expect((await call('GET', url(), 'o')).json().data.find((t: any) => t.id === 'hr').enabled).toBe(false);
    r = await call('PUT', `${url()}/hr`, 'o', { enabled: true });
    expect(r.json().data.every((t: any) => t.enabled)).toBe(true);
  });
  it('site managers and staff can neither see nor change them', async () => {
    for (const t of ['m', 's']) {
      expect((await call('GET', url(), t)).statusCode, t).toBe(403);
      expect((await call('PUT', `${url()}/hr`, t, { enabled: false })).statusCode, t).toBe(403);
    }
    expect(store.off.size).toBe(0);
  });
  it("one company cannot read or change another's, and strangers are turned away", async () => {
    expect([403, 404]).toContain((await call('GET', url(), 'x')).statusCode);
    expect([403, 404]).toContain((await call('PUT', `${url()}/hr`, 'x', { enabled: false })).statusCode);
    expect((await app.inject({ method: 'GET', url: url() })).statusCode).toBe(401);
    expect(store.off.size).toBe(0);
  });
  it('refuses an unknown topic or a bad body', async () => {
    expect((await call('PUT', `${url()}/payroll`, 'o', { enabled: false })).statusCode).toBe(400);
    expect((await call('PUT', `${url()}/hr`, 'o', { enabled: 'no' })).statusCode).toBe(400);
    expect((await call('PUT', `${url()}/hr`, 'o', {})).statusCode).toBe(400);
  });
  it('end to end: the chat follows the switch', async () => {
    const ask = async (message: string) => (await call('POST', '/api/v1/chat', 's', { site_id: n.id, message })).json();
    let r = await ask('I want to raise a grievance');
    expect(r.sensitive).toMatchObject({ topic: 'hr', mode: 'manager' }); expect(model.calls).toHaveLength(0);
    await call('PUT', `${url()}/hr`, 'o', { enabled: false });
    r = await ask('I want to raise a grievance');
    expect(r.sensitive).toBeNull(); expect(model.calls).toHaveLength(1); // now handled as an ordinary question
    await call('PUT', `${url()}/hr`, 'o', { enabled: true });
    expect((await ask('I want to raise a grievance')).sensitive).toMatchObject({ topic: 'hr' });
  });
  it('is documented in the OpenAPI file', async () => {
    const spec = (await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })).json();
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/api/v1/orgs/{orgId}/sensitive-topics', '/api/v1/orgs/{orgId}/sensitive-topics/{topic}']));
    expect(JSON.stringify(spec.paths['/api/v1/chat'])).toContain('sensitive');
  });
});
