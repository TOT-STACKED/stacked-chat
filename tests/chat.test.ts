import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { ChatModel, ChatTurn } from '../src/modules/chat/model.js';
import { buildSystemPrompt } from '../src/modules/chat/prompt.js';
import { pickMedia, retrievePassages, splitPassages, visibleTo } from '../src/modules/chat/retrieve.js';
import { cleanReply, createChat, isUnanswered, type Who } from '../src/modules/chat/service.js';
import type { ConversationRow, ConversationStore, StoredMessage } from '../src/modules/chat/store.js';
import type { ItemRow } from '../src/modules/knowledge/store.js';
import { createKnowledge } from '../src/modules/knowledge/service.js';
import { FakeInsightsStore } from '../src/testing/insights-fakes.js';
import { FakeKnowledgeStore } from '../src/testing/knowledge-fakes.js';
import { FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { testConfig } from './helpers.js';

const item = (o: Partial<ItemRow>): ItemRow => ({
  id: randomUUID(), org_id: 'o', kind: 'document', title: 'Doc', status: 'published', site_id: null, team_id: null, body: 'text', url: null, description: null,
  doc_filename: null, video_id: null, image_id: null, source: 'manager', source_question: null, created_by: null, created_at: '', updated_at: '', published_at: null, ...o,
});

class FakeConversations implements ConversationStore {
  rows: ConversationRow[] = []; private n = 1;
  async create(c: { email: string; venue_id: string; messages: StoredMessage[] }) { const row = { id: this.n++, email: c.email.toLowerCase(), venue_id: c.venue_id, messages: c.messages, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; this.rows.push(row); return row.id; }
  async save(id: number, messages: StoredMessage[]) { this.rows.find((r) => r.id === id)!.messages = messages; }
  async get(id: number) { return structuredClone(this.rows.find((r) => r.id === id) ?? null); }
  async listMine(email: string, siteId: string) { return structuredClone(this.rows.filter((r) => r.email === email.toLowerCase() && r.venue_id === siteId).reverse()); }
}
class FakeModel implements ChatModel {
  calls: Array<{ system: string; messages: ChatTurn[] }> = []; reply: string | null = 'Here is the answer.\nSource: Handbook';
  async complete(i: { system: string; messages: ChatTurn[] }) { this.calls.push(i); return this.reply; }
}

describe('who can see what', () => {
  const who = { siteId: 'north', teamIds: ['kitchen'] };
  it('shows published knowledge for the company, the site or the team, never drafts or other audiences', () => {
    expect(visibleTo(item({}), who)).toBe(true);
    expect(visibleTo(item({ site_id: 'north' }), who)).toBe(true);
    expect(visibleTo(item({ site_id: 'south' }), who)).toBe(false);
    expect(visibleTo(item({ team_id: 'kitchen', site_id: 'north' }), who)).toBe(true);
    expect(visibleTo(item({ team_id: 'bar', site_id: 'north' }), who)).toBe(false);
    expect(visibleTo(item({ team_id: 'kitchen', site_id: 'south' }), { siteId: 'north', teamIds: ['kitchen'] })).toBe(true); // a company-wide team follows the person
    expect(visibleTo(item({ status: 'draft' }), who)).toBe(false);
  });
});

describe('finding the right passages', () => {
  const handbook = item({ title: 'Staff handbook', body: 'Holiday requests go to your manager four weeks ahead.\n\nBreaks are twenty minutes per six hours worked.\n\nUniform must be clean at every shift.' });
  const fire = item({ title: 'Fire safety', body: 'If the alarm sounds, leave by the nearest exit and meet at the car park.' });
  it('splits long text into readable passages', () => {
    expect(splitPassages('a\n\nb\n\nc')).toEqual(['a\n\nb\n\nc']);
    const long = 'Sentence one is here. '.repeat(100);
    expect(splitPassages(long).every((p) => p.length <= 900)).toBe(true);
    expect(splitPassages('').length).toBe(0);
  });
  it('returns the best matches first and nothing when nothing matches', () => {
    const r = retrievePassages([handbook, fire], 'Where do we meet if the fire alarm sounds?');
    expect(r[0]!.title).toBe('Fire safety');
    expect(retrievePassages([handbook, fire], 'What is the wifi password?')).toEqual([]);
    expect(retrievePassages([handbook, fire], 'hi')).toEqual([]);
  });
  it('copes with typos typed on a phone', () => {
    const doc = { ...fire, id: 'o1', title: 'Opening a restaurant', body: 'Opening procedures: unlock the restaurant, switch on the ovens and check the fridges.' };
    expect(retrievePassages([doc], 'what can you tell me about openoing a restrautn?')[0]!.title).toBe('Opening a restaurant');
    expect(retrievePassages([doc], 'what is the wifi password?')).toEqual([]);
  });
  it('title matches count extra, and one document cannot fill every slot', () => {
    const big = item({ title: 'Big', body: Array.from({ length: 10 }, (_, i) => `Rota paragraph ${i} about shifts and rota changes.`).join('\n\n'.repeat(1) + '\n\n') });
    const r = retrievePassages([big, item({ title: 'Rota rules', body: 'Rota swaps need approval.' })], 'rota shifts', 5);
    expect(r.filter((p) => p.item_id === big.id).length).toBeLessThanOrEqual(3);
    expect(r.some((p) => p.title === 'Rota rules')).toBe(true);
  });
  it('attaches a video when it matches, and a photo only when one is asked for', () => {
    const video = item({ kind: 'video', title: 'How to void a payment on the till', body: null, url: 'https://youtu.be/dQw4w9WgXcQ' });
    const photo = item({ kind: 'image', title: 'Signature burger plating', body: null, url: 'https://x/b.png' });
    expect(pickMedia([video, photo], 'how do I void a payment on the till').videos).toHaveLength(1);
    expect(pickMedia([video, photo], 'what time is lunch').videos).toHaveLength(0);
    expect(pickMedia([video, photo], 'how should the burger be plated').images).toHaveLength(0);
    expect(pickMedia([video, photo], 'show me a photo of the burger plating').images).toHaveLength(1);
  });
  it('builds a prompt that holds the strict rules and only the matched knowledge', () => {
    const p = buildSystemPrompt({ botName: 'Nora', orgName: 'Acme', siteName: 'North', personName: 'Amy', passages: [{ item_id: '1', title: 'Fire safety', text: 'Meet at the car park.', score: 3 }], hasVideo: false, hasImage: false });
    expect(p).toContain('You are Nora'); expect(p).toContain('ANSWER ONLY FROM TWO SOURCES'); expect(p).toContain('ALLERGENS ARE SAFETY-CRITICAL');
    expect(p).toContain('[Fire safety]\nMeet at the car park.'); expect(p).toContain("I don't have that in your knowledge base yet");
  });
});

describe('the chat service', () => {
  const ORG = 'org-1';
  let kstore: FakeKnowledgeStore; let convs: FakeConversations; let model: FakeModel; let answered: string[]; let chat: ReturnType<typeof createChat>; let north: string; let south: string;
  const me = (over: Partial<Who> = {}): Who => ({ email: 'amy@a.com', name: 'Amy', orgId: ORG, orgName: 'Acme', siteId: north, siteName: 'North', teamIds: [], botName: null, ...over });
  const make = (signUrls?: (u: string[]) => Promise<Array<string | null>>) =>
    createChat({ items: async (o) => kstore.listItems(o), conversations: convs, model, signUrls, onAnswered: (s) => { answered.push(s); } });
  const kb = () => createKnowledge({ store: kstore });
  beforeEach(() => {
    kstore = new FakeKnowledgeStore(); convs = new FakeConversations(); model = new FakeModel(); answered = [];
    kstore.addOrg(ORG, 'acme', 'acme'); north = kstore.addSite(ORG).id; south = kstore.addSite(ORG).id; chat = make();
  });
  const publish = (title: string, body: string, aud: { site_id?: string | null; team_id?: string | null } = {}) =>
    kb().createDocument(ORG, { title, body, site_id: aud.site_id ?? null, team_id: aud.team_id ?? null, status: 'published', by: 'a@b.co' });

  it('answers using only knowledge this person may see', async () => {
    await publish('Fire safety', 'Meet at the car park when the fire alarm sounds.');
    await publish('South fire plan', 'South fire alarm: meet at the south yard.', { site_id: south });
    await kb().createDocument(ORG, { title: 'Draft fire memo', body: 'Fire alarm secret draft text', site_id: null, status: 'draft', by: 'a@b.co' });
    model.reply = 'Meet at the car park.\nSource: Fire safety';
    const r = await chat.ask(me(), { message: 'Where do we meet when the fire alarm sounds?' });
    const sys = model.calls[0]!.system;
    expect(sys).toContain('car park'); expect(sys).not.toContain('south yard'); expect(sys).not.toContain('secret draft');
    expect(r).toMatchObject({ reply: expect.stringContaining('car park'), unanswered: false });
    expect(r.sources).toEqual([expect.objectContaining({ title: 'Fire safety' })]);
  });
  it('team knowledge reaches that team only', async () => {
    kstore.teamRows.push({ id: 'kitchen', org_id: ORG, name: 'Kitchen', site_id: north });
    await publish('Kitchen close-down', 'Kitchen close-down: wipe the pass and log fridge temperatures.', { team_id: 'kitchen' });
    await chat.ask(me({ teamIds: [] }), { message: 'What is the kitchen close-down?' });
    expect(model.calls[0]!.system).not.toContain('fridge temperatures');
    await chat.ask(me({ teamIds: ['kitchen'] }), { message: 'What is the kitchen close-down?' });
    expect(model.calls[1]!.system).toContain('fridge temperatures');
  });
  it('flags "not in the knowledge base" answers and attaches no sources', async () => {
    await publish('Fire safety', 'Meet at the car park when the fire alarm sounds.');
    model.reply = "I don't have that in your knowledge base yet. Ask your manager to add it.";
    const r = await chat.ask(me(), { message: 'Where do we meet when the fire alarm sounds?' });
    expect(r.unanswered).toBe(true); expect(r.sources).toEqual([]);
  });
  it('saves the conversation, continues it with history, and meters the question', async () => {
    await publish('Handbook', 'Breaks are twenty minutes per six hours.');
    const first = await chat.ask(me(), { message: 'How long are breaks?' });
    expect(first.conversation_id).toBe(1); expect(answered).toEqual([north]);
    const second = await chat.ask(me(), { message: 'and for a nine hour shift?', conversation_id: first.conversation_id });
    expect(second.conversation_id).toBe(1);
    expect(model.calls[1]!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(model.calls[1]!.system).toContain('twenty minutes'); // the short follow-up still finds the right document
    expect(convs.rows[0]!.messages).toHaveLength(4);
  });
  it("keeps other people's and other venues' conversations private", async () => {
    await publish('Handbook', 'Breaks are twenty minutes per six hours.');
    const c = await chat.ask(me(), { message: 'How long are breaks?' });
    await expect(chat.ask(me({ email: 'eve@a.com' }), { message: 'hi there friend', conversation_id: c.conversation_id })).rejects.toMatchObject({ statusCode: 404 });
    await expect(chat.ask(me({ siteId: south }), { message: 'hi there friend', conversation_id: c.conversation_id })).rejects.toMatchObject({ statusCode: 404 });
    await expect(chat.open('eve@a.com', north, c.conversation_id)).rejects.toMatchObject({ statusCode: 404 });
    expect((await chat.open('AMY@a.com', north, c.conversation_id)).messages).toHaveLength(2);
    expect(await chat.list('eve@a.com', north)).toEqual([]);
    expect((await chat.list('amy@a.com', north))[0]).toMatchObject({ id: 1, title: 'How long are breaks?' });
  });
  it('says so plainly when the assistant is off or fails, and saves nothing', async () => {
    const off = createChat({ items: async () => [], conversations: convs, model: null });
    await expect(off.ask(me(), { message: 'hello there' })).rejects.toMatchObject({ statusCode: 503, code: 'assistant_unavailable' });
    model.reply = null;
    await expect(chat.ask(me(), { message: 'How long are breaks?' })).rejects.toMatchObject({ statusCode: 503 });
    expect(convs.rows).toHaveLength(0); expect(answered).toEqual([]);
  });
  it('tells the assistant what the attached video is, from its title and description only', () => {
    const p = buildSystemPrompt({ botName: 'Nora', orgName: 'Acme', siteName: 'North', personName: 'Amy', passages: [], hasVideo: true, videoNotes: ['Managing Guest Feedback: Taking feedback on the spot and logging it'], hasImage: false });
    expect(p).toContain('Managing Guest Feedback: Taking feedback on the spot and logging it');
    expect(p).toMatch(/never guess/i);
  });
  it('rejects empty and over-long messages', async () => {
    await expect(chat.ask(me(), { message: '   ' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(chat.ask(me(), { message: 'x'.repeat(2001) })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('attaches a matching video with a signed link, even when no document answered the question', async () => {
    await kb().createVideo(ORG, { title: 'How to void a payment on the till', url: 'https://cdn.x/clip.mp4', site_id: null, status: 'published', by: 'a@b.co' });
    chat = make(async (urls) => urls.map((u) => u + '?signed=1'));
    const r = await chat.ask(me(), { message: 'video: how do I void a payment on the till?' });
    expect(r.videos).toEqual([expect.objectContaining({ title: 'How to void a payment on the till', url: 'https://cdn.x/clip.mp4?signed=1' })]);
    model.reply = "I don't have that in your knowledge base yet.";
    const again = await chat.ask(me(), { message: 'video: how do I void a payment on the till?' });
    expect(again.unanswered).toBe(true); expect(again.videos).toHaveLength(1); // the gap is still logged, the video still shows
  });
  it('answers from a picture\'s details and shows that picture with the answer, without anyone asking for a photo', async () => {
    await kb().createImage(ORG, { title: 'Espresso martini', url: 'https://cdn.x/em.jpg', description: 'Espresso martini: 50ml vodka, 25ml coffee liqueur, 30ml espresso. Shake hard, strain into a coupe.', site_id: null, status: 'published', by: 'a@b.co' });
    chat = make(async (urls) => urls.map((u) => u + '?signed=1'));
    model.reply = 'Use 25ml of coffee liqueur.\nSource: Espresso martini';
    const r = await chat.ask(me(), { message: 'how much coffee liqueur in an espresso martini?' });
    expect(r.unanswered).toBe(false);
    expect(r.images).toEqual([expect.objectContaining({ title: 'Espresso martini', url: 'https://cdn.x/em.jpg?signed=1' })]);
    expect(r.sources.map((x) => x.title)).toEqual(['Espresso martini']);
    expect(model.calls.at(-1)!.system).toContain('25ml coffee liqueur');
  });
  it('shows a picture once, not again on every follow-up, but always when asked for it', async () => {
    await kb().createImage(ORG, { title: 'Margarita serve', url: 'https://cdn.x/m.jpg', description: 'Margarita: rub a lime wedge round the glass, dip the rim in salt. Shake tequila, Cointreau and lime juice, strain.', site_id: null, status: 'published', by: 'a@b.co' });
    chat = make(async (urls) => urls);
    model.reply = 'Shake tequila, Cointreau and lime.\nSource: Margarita serve';
    const first = await chat.ask(me(), { message: 'how do I make a margarita?' });
    expect(first.images).toHaveLength(1);
    const shown = first.images.map((i) => i.id);
    const again = await chat.ask(me(), { message: 'how much lime juice in the margarita?', shown_media: shown });
    expect(again.images).toEqual([]);
    const asked = await chat.ask(me(), { message: 'have you got a picture of the margarita serve', shown_media: shown });
    expect(asked.images).toHaveLength(1);
  });
  it('knows about the person\'s own training when they ask about it, and only then', async () => {
    chat = createChat({ items: async (o) => kstore.listItems(o), conversations: convs, model, training: async () => [
      { title: 'Fire safety', status: 'todo', completed_at: null, expires_at: null },
      { title: 'Food hygiene basics', status: 'renew', completed_at: '2025-01-10T10:00:00.000Z', expires_at: '2026-01-10T10:00:00.000Z' },
      { title: 'Allergens', status: 'done', completed_at: '2026-09-01T10:00:00.000Z', expires_at: null }] });
    await chat.ask(me(), { message: 'i need to take my fire training?' });
    const sys = model.calls.at(-1)!.system;
    expect(sys).toContain('Fire safety: not done yet'); expect(sys).toContain('Food hygiene basics: time for a refresher (last done 10 Jan 2025)'); expect(sys).toMatch(/Allergens: done on 1 Sep(t)? 2026/);
    expect(sys).toContain('four-square button');
    await chat.ask(me(), { message: 'where is the fire assembly point?' });
    expect(model.calls.at(-1)!.system).not.toContain('THIS PERSON\'S TRAINING');
  });
  it('always knows what the person has to do today, whatever they ask, and says nothing is waiting when they ask and there is nothing', async () => {
    const ctx = (notes: string[], docs: Array<{ id: string; title: string; body: string }> = []) => createChat({ items: async (o) => kstore.listItems(o), conversations: convs, model, work: async () => ({ notes, docs }) });
    chat = ctx(['Checklist "Opening" (opening): 2 of 7 items ticked, due by 09:00', 'Update "New menu": not read yet', 'Training "Fire safety": not done yet']);
    for (const q of ['what do i need to do today?', 'have i got any updates?', 'is the opening checklist done', 'whats on my list', 'where is the fire assembly point?']) {
      await chat.ask(me(), { message: q });
      const sys = model.calls.at(-1)!.system;
      expect(sys, q).toContain('Checklist "Opening" (opening): 2 of 7 items ticked, due by 09:00'); expect(sys).toContain('Update "New menu": not read yet'); expect(sys).toContain('Training "Fire safety"'); expect(sys).toContain('four-square button');
    }
    chat = ctx([]);
    await chat.ask(me(), { message: 'what do i need to do today?' });
    expect(model.calls.at(-1)!.system).toContain('Nothing is waiting for them');
    await chat.ask(me(), { message: 'where is the fire assembly point?' });
    expect(model.calls.at(-1)!.system).not.toContain("THIS PERSON'S WORK TODAY");
    chat = createChat({ items: async (o) => kstore.listItems(o), conversations: convs, model, work: async () => { throw new Error('db down'); } });
    await chat.ask(me(), { message: 'what do i need to do today?' }); // a failing lookup must not break the answer
    expect(model.calls.at(-1)!.system).not.toContain("THIS PERSON'S WORK TODAY");
  });
  it('searches updates, checklists and course lessons like documents, and cites them', async () => {
    chat = createChat({ items: async (o) => kstore.listItems(o), conversations: convs, model, work: async () => ({ notes: [], docs: [{ id: randomUUID(), title: 'Update: New menu', body: 'The new autumn menu starts on Monday. The pumpkin soup replaces the tomato soup.' }] }) });
    model.reply = 'It starts Monday.\nSource: Update: New menu';
    const r = await chat.ask(me(), { message: 'when does the new autumn menu start?' });
    expect(model.calls.at(-1)!.system).toContain('pumpkin soup replaces the tomato soup');
    expect(r.sources.map((s) => s.title)).toEqual(['Update: New menu']);
  });
  it('lists every course when asked what training is available, and says so when there are none', async () => {
    const mk = (list: Array<{ title: string; status: 'todo' | 'done' | 'renew'; completed_at: string | null; expires_at: string | null }>) => createChat({ items: async (o) => kstore.listItems(o), conversations: convs, model, training: async () => list });
    await mk([{ title: 'Fire safety', status: 'todo', completed_at: null, expires_at: null }, { title: 'Food hygiene basics', status: 'todo', completed_at: null, expires_at: null }]).ask(me(), { message: 'what training is available?' });
    const sys = model.calls.at(-1)!.system;
    expect(sys).toContain('list EVERY course above'); expect(sys).toContain('- Fire safety: not done yet'); expect(sys).toContain('- Food hygiene basics: not done yet');
    await mk([]).ask(me(), { message: 'what training is available?' });
    expect(model.calls.at(-1)!.system).toContain('No courses have been set up for them yet');
  });
  it('shows only the sources the answer cites, not everything that was searched', async () => {
    await publish('Fire safety', 'Meet at the car park when the fire alarm sounds.');
    await publish('Handbook', 'Breaks are twenty minutes. Fire alarm tests are on Fridays.');
    model.reply = 'Meet at the car park.\nSource: Fire safety';
    expect((await chat.ask(me(), { message: 'where do we meet when the fire alarm sounds' })).sources.map((s) => s.title)).toEqual(['Fire safety']);
    model.reply = 'Restart the till. (answered from vendor notes, no document used)';
    expect((await chat.ask(me(), { message: 'where do we meet when the fire alarm sounds' })).sources).toEqual([]);
  });
  it('cleans replies of links and stray tags, and recognises "could not answer"', () => {
    expect(cleanReply('See [the guide](https://x.co/g) or https://y.co now [ESCALATE]\n\n\n\nDone')).toBe('See the guide or now\n\nDone');
    expect(isUnanswered("I don't have that in your knowledge base yet.")).toBe(true);
    expect(isUnanswered('Breaks are twenty minutes.')).toBe(false);
  });
});

describe('chat API', () => {
  let app: FastifyInstance; let repo: FakeRepo; let kstore: FakeKnowledgeStore; let model: FakeModel; let convs: FakeConversations; let istore: FakeInsightsStore;
  let org: ReturnType<FakeRepo['addOrg']>; let n: ReturnType<FakeRepo['addSite']>; let s: ReturnType<FakeRepo['addSite']>;
  const U = { owner: randomUUID(), staffN: randomUUID(), staffS: randomUUID(), cook: randomUUID() };
  const tok = { o: 'to', n: 'tn', s: 'ts', c: 'tc', x: 'tx' };
  beforeEach(async () => {
    repo = new FakeRepo(); kstore = new FakeKnowledgeStore(); model = new FakeModel(); convs = new FakeConversations(); istore = new FakeInsightsStore();
    org = repo.addOrg('Acme'); n = repo.addSite(org, 'North'); s = repo.addSite(org, 'South');
    kstore.addOrg(org.id, 'acme', 'acme'); kstore.sites.push({ id: n.id, org_id: org.id }, { id: s.id, org_id: org.id });
    repo.addMember(org, 'owner@a.com', 'owner', null, U.owner); repo.addMember(org, 'amy@a.com', 'staff', n, U.staffN);
    repo.addMember(org, 'sam@a.com', 'staff', s, U.staffS); const cook = repo.addMember(org, 'cook@a.com', 'staff', n, U.cook);
    const kitchen = repo.addTeam(org, 'Kitchen', n); await repo.setMemberTeams(cook.id, [kitchen.id]);
    kstore.teamRows.push({ id: kitchen.id, org_id: org.id, name: 'Kitchen', site_id: n.id });
    const kb = createKnowledge({ store: kstore });
    await kb.createDocument(org.id, { title: 'Handbook', body: 'Breaks are twenty minutes per six hours worked.', site_id: null, status: 'published', by: 'o@a.com' });
    await kb.createDocument(org.id, { title: 'Kitchen opening', body: 'Kitchen opening: check the walk-in fridge temperature first.', team_id: kitchen.id, site_id: null, status: 'published', by: 'o@a.com' });
    await kb.createDocument(org.id, { title: 'South secrets', body: 'South only: the safe code is on the office wall.', site_id: s.id, status: 'published', by: 'o@a.com' });
    app = await buildApp(testConfig, { repo, knowledgeStore: kstore, conversationStore: convs, chatModel: model, insightsStore: istore,
      brandingStore: { list: async () => [{ id: n.id, name: 'North', bot_name: 'Nora', welcome_heading: 'Hi North', welcome_message: null, primary_color: '#112233', logo_url: null }], update: async () => { throw new Error('no'); } },
      verifyToken: fakeVerifier({ [tok.o]: { userId: U.owner, email: 'owner@a.com' }, [tok.n]: { userId: U.staffN, email: 'amy@a.com' }, [tok.s]: { userId: U.staffS, email: 'sam@a.com' }, [tok.c]: { userId: U.cook, email: 'cook@a.com' }, [tok.x]: { userId: randomUUID(), email: 'nobody@a.com' } }) });
  });
  const call = (method: 'GET' | 'POST', url: string, t: string, body?: object) => app.inject({ method, url, headers: { authorization: 'Bearer ' + t }, payload: body });

  it('lists the venues you can chat at, with branding and suggestions', async () => {
    const mine = (await call('GET', '/api/v1/chat/context', tok.n)).json();
    expect(mine.sites).toHaveLength(1);
    expect(mine.sites[0]).toMatchObject({ site_name: 'North', org_name: 'Acme', slug: expect.any(String), branding: { bot_name: 'Nora', primary_color: '#112233' } });
    expect(mine.sites[0].suggestions.length).toBeGreaterThan(0);
    expect((await call('GET', '/api/v1/chat/context', tok.o)).json().sites.map((x: any) => x.site_name).sort()).toEqual(['North', 'South']);
    expect((await call('GET', '/api/v1/chat/context', tok.x)).json().sites).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/chat/context' })).statusCode).toBe(401);
  });
  it('answers from what that person may see, by name and team', async () => {
    const r = await call('POST', '/api/v1/chat', tok.n, { site_id: n.id, message: 'How long are breaks, and the south safe code?' });
    expect(r.statusCode).toBe(200);
    const sys = model.calls[0]!.system;
    expect(sys).toContain('twenty minutes'); expect(sys).not.toContain('safe code'); expect(sys).not.toContain('walk-in fridge'); expect(sys).toContain('Nora'); expect(sys).toContain('Amy');
    await call('POST', '/api/v1/chat', tok.c, { site_id: n.id, message: 'What is the kitchen opening fridge check?' });
    expect(model.calls[1]!.system).toContain('walk-in fridge');
  });
  it('refuses a venue you do not belong to, and strangers', async () => {
    expect((await call('POST', '/api/v1/chat', tok.n, { site_id: s.id, message: 'hello there' })).statusCode).toBe(403);
    expect((await call('POST', '/api/v1/chat', tok.x, { site_id: n.id, message: 'hello there' })).statusCode).toBe(403);
    expect((await call('POST', '/api/v1/chat', tok.o, { site_id: s.id, message: 'hello there' })).statusCode).toBe(200); // company-wide people can chat at any venue
    expect(model.calls).toHaveLength(1);
  });
  it('keeps conversations private and venue-bound', async () => {
    const a = (await call('POST', '/api/v1/chat', tok.n, { site_id: n.id, message: 'How long are breaks?' })).json();
    expect((await call('GET', `/api/v1/chat/conversations?site_id=${n.id}`, tok.n)).json().data[0]).toMatchObject({ id: a.conversation_id, title: 'How long are breaks?' });
    expect((await call('GET', `/api/v1/chat/conversations/${a.conversation_id}?site_id=${n.id}`, tok.n)).json().messages).toHaveLength(2);
    expect((await call('GET', `/api/v1/chat/conversations/${a.conversation_id}?site_id=${n.id}`, tok.c)).statusCode).toBe(404);
    expect((await call('GET', `/api/v1/chat/conversations?site_id=${n.id}`, tok.c)).json().data).toEqual([]);
    expect((await call('GET', `/api/v1/chat/conversations?site_id=${s.id}`, tok.n)).statusCode).toBe(403);
    expect((await call('POST', '/api/v1/chat', tok.c, { site_id: n.id, message: 'hello there', conversation_id: a.conversation_id })).statusCode).toBe(404);
  });
  it('slows down a flood, and answers 503 when the assistant is off', async () => {
    const small = await buildApp(testConfig, { repo, knowledgeStore: kstore, conversationStore: convs, chatModel: model, verifyToken: fakeVerifier({ t: { userId: U.staffN, email: 'amy@a.com' } }) });
    let last = 0; for (let i = 0; i < 25; i++) last = (await small.inject({ method: 'POST', url: '/api/v1/chat', headers: { authorization: 'Bearer t' }, payload: { site_id: n.id, message: 'How long are breaks?' } })).statusCode;
    expect(last).toBe(429);
    const off = await buildApp(testConfig, { repo, knowledgeStore: kstore, conversationStore: convs, chatModel: null, verifyToken: fakeVerifier({ t: { userId: U.staffN, email: 'amy@a.com' } }) });
    expect((await off.inject({ method: 'POST', url: '/api/v1/chat', headers: { authorization: 'Bearer t' }, payload: { site_id: n.id, message: 'How long are breaks?' } })).statusCode).toBe(503);
  });
  it('validates the request and is in the OpenAPI document', async () => {
    expect((await call('POST', '/api/v1/chat', tok.n, { site_id: n.id, message: '' })).statusCode).toBe(400);
    expect((await call('POST', '/api/v1/chat', tok.n, { site_id: 'nope', message: 'hello' })).statusCode).toBe(400);
    const spec = (await call('GET', '/api/v1/openapi.json', tok.n)).json() as { paths: Record<string, unknown> };
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/api/v1/chat', '/api/v1/chat/context', '/api/v1/chat/conversations']));
  });
  it('venue links open the app, and missing files are real 404s', async () => {
    const venue = await app.inject({ method: 'GET', url: '/chat/north-abc1' });
    expect(venue.statusCode).toBe(200); expect(venue.headers['content-type']).toContain('text/html'); expect(venue.body).toContain('chat.js');
    expect(venue.headers['content-security-policy']).toContain("script-src 'self'");
    expect((await app.inject({ method: 'GET', url: '/chat/' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/chat/missing.js' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/chat/anything' })).statusCode).toBe(404);
    const bare = await app.inject({ method: 'GET', url: '/chat' });
    expect(bare.statusCode).toBe(301); expect(bare.headers.location).toBe('/chat/');
  });
  it('serves the chat page safely', async () => {
    const res = await app.inject({ method: 'GET', url: '/chat/config.json' });
    expect(res.statusCode).toBe(200); expect(Object.keys(res.json()).sort()).toEqual(['anonKey', 'dev', 'phone', 'supabaseUrl']);
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
  });
});
