import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { extractAsks, groupAsks, questionKey, unansweredGroups } from '../src/modules/insights/analyze.js';
import { blankDraft, createAnthropicDrafter, type AnswerDrafter } from '../src/modules/insights/drafter.js';
import { createInsights, findContext } from '../src/modules/insights/service.js';
import { createKnowledge } from '../src/modules/knowledge/service.js';
import { FakeInsightsStore } from '../src/testing/insights-fakes.js';
import { FakeKnowledgeStore } from '../src/testing/knowledge-fakes.js';
import { FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { testConfig } from './helpers.js';

const IDK = "I don't have that in my knowledge base yet.";
const OK = 'Sure, here is how it works.';

describe('question grouping', () => {
  it('gives the same key to the same question worded differently', () => {
    expect(questionKey('Can I swap a shift?')).toBe(questionKey('can i swap shifts'));
    expect(questionKey('Where is the fire assembly point?')).toBe(questionKey('where is the fire assembly point'));
    expect(questionKey('Do we get paid for training days?')).not.toBe(questionKey('Is there a staff meal policy?'));
  });
  it('ignores chit-chat and very short messages', () => {
    for (const q of ['hi', 'thanks!', 'ok', 'Hello there', 'the', '?']) expect(questionKey(q), q).toBe('');
  });
  it('pairs each question with the AI answer that followed it, and spots "could not answer"', () => {
    const asks = extractAsks([{ id: 1, venue_id: 's1', email: 'A@x.com', created_at: '2026-10-01T10:00:00Z', messages: [
      { role: 'user', content: 'Where do I log a broken fridge?' }, { role: 'assistant', content: IDK },
      { role: 'user', content: 'Can I swap a shift?' }, { role: 'assistant', content: OK },
      { role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'What is the staff meal policy?' },
    ] }]);
    expect(asks.map((a) => [a.text, a.unanswered])).toEqual([['Where do I log a broken fridge?', true], ['Can I swap a shift?', false], ['What is the staff meal policy?', false]]);
    expect(asks[0]!.email).toBe('a@x.com');
  });
  it('tolerates odd data (no messages, non-text content, missing roles)', () => {
    expect(extractAsks([{ id: 1, venue_id: null, email: null, created_at: 'x', messages: null }, { id: 2, venue_id: 's', email: null, created_at: 'x', messages: [{ role: 'user', content: { weird: true } }, {}] }])).toEqual([]);
  });
  it('groups repeats, shows the most common wording, counts sites, orders by count', () => {
    const mk = (text: string, site: string, at: string, unanswered = false) => ({ key: questionKey(text), text, site_id: site, email: null, at, unanswered });
    const g = groupAsks([mk('Can I swap a shift?', 's1', '2026-10-01'), mk('can i swap shifts', 's2', '2026-10-03'), mk('Can I swap a shift?', 's1', '2026-10-02'), mk('Where is the fire assembly point?', 's1', '2026-10-05')]);
    expect(g[0]).toMatchObject({ question: 'Can I swap a shift?', count: 3, sites: 2, last_asked: '2026-10-03' });
    expect(g[1]).toMatchObject({ count: 1 });
  });
  it('lists as unanswered only questions that went unanswered', () => {
    const mk = (text: string, unanswered: boolean) => ({ key: questionKey(text), text, site_id: 's', email: null, at: '2026-10-01', unanswered });
    expect(unansweredGroups([mk('Do we get paid for training?', true), mk('Do we get paid for training?', true), mk('Where is the bar?', false)]).map((g) => [g.question, g.count])).toEqual([['Do we get paid for training?', 2]]);
  });
});

describe('the drafter', () => {
  it('sends the question and the company documents, and never leaks the key into the prompt', async () => {
    let sent: { headers: Record<string, string>; body: any } | null = null;
    const d = createAnthropicDrafter({ apiKey: 'sk-ant-secret', model: 'm', fetchImpl: (async (_u: string, init: RequestInit) => { sent = { headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) }; return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'Draft [CONFIRM: rate]' }] }) } as Response; }) as unknown as typeof fetch });
    expect(await d.draft('Do we get paid for training?', ['[Handbook]\nTraining is on the rota.'])).toBe('Draft [CONFIRM: rate]');
    expect(sent!.headers['x-api-key']).toBe('sk-ant-secret');
    expect(JSON.stringify(sent!.body)).not.toContain('sk-ant-secret');
    expect(sent!.body.messages[0].content).toContain('Training is on the rota.');
    expect(sent!.body.system).toContain('Never invent');
  });
  it('returns null (so a blank template is used) on any failure', async () => {
    const bad = createAnthropicDrafter({ apiKey: 'k', model: 'm', fetchImpl: (async () => ({ ok: false }) as Response) as unknown as typeof fetch });
    expect(await bad.draft('q', [])).toBeNull();
    const boom = createAnthropicDrafter({ apiKey: 'k', model: 'm', fetchImpl: (async () => { throw new Error('net'); }) as unknown as typeof fetch });
    expect(await boom.draft('q', [])).toBeNull();
  });
});

describe('insights service', () => {
  const ORG = 'org-1';
  let istore: FakeInsightsStore; let kstore: FakeKnowledgeStore; let svc: ReturnType<typeof createInsights>; let calls: Array<[string, string[]]>;
  let north: string; let south: string; let drafter: AnswerDrafter | null;
  const make = () => createInsights({ store: istore, knowledge: createKnowledge({ store: kstore }), drafter });
  beforeEach(() => {
    istore = new FakeInsightsStore(); kstore = new FakeKnowledgeStore(); calls = []; drafter = null;
    north = kstore.addSite(ORG).id; south = kstore.addSite(ORG).id; kstore.addOrg(ORG, 'acme', 'acme');
    istore.siteList.push({ id: north, org_id: ORG, name: 'North' }, { id: south, org_id: ORG, name: 'South' });
    istore.members.push({ org_id: ORG, email: 'amy@a.com', teams: ['Kitchen'] }, { org_id: ORG, email: 'bo@a.com', teams: ['Bar', 'Front of house'] });
    svc = make();
  });
  const allSites = () => [north, south];

  it('summarises questions, answer rate, people, top questions, teams and sites', async () => {
    istore.addConversation(north, 'amy@a.com', [['Can I swap a shift?', OK], ['Where do I log a broken fridge?', IDK]]);
    istore.addConversation(south, 'bo@a.com', [['can i swap shifts', OK]]);
    istore.addConversation(south, 'stranger@a.com', [['Can I swap a shift?', OK]]);
    const r = await svc.compute(ORG, { days: 30, siteIds: allSites() });
    expect(r.totals).toEqual({ questions: 4, conversations: 3, people: 3, unanswered: 1, answer_rate: 0.75 });
    expect(r.most_asked[0]).toMatchObject({ question: 'Can I swap a shift?', count: 3, sites: 2 });
    expect(r.unanswered).toHaveLength(1);
    expect(r.unanswered[0]).toMatchObject({ question: 'Where do I log a broken fridge?', count: 1, site_names: ['North'], draft_item_id: null });
    expect(r.by_team).toEqual(expect.arrayContaining([{ name: 'Kitchen', count: 2 }, { name: 'Bar', count: 1 }, { name: 'Front of house', count: 1 }, { name: 'No team', count: 1 }]));
    expect(r.by_site).toEqual(expect.arrayContaining([{ site_id: south, name: 'South', count: 2 }, { site_id: north, name: 'North', count: 2 }]));
  });
  it('only looks at the chosen time window and the venues you may see', async () => {
    istore.addConversation(north, null, [['Old question about holidays?', IDK]], new Date(Date.now() - 40 * 86_400_000));
    istore.addConversation(south, null, [['South only question about tips?', IDK]]);
    expect((await svc.compute(ORG, { days: 30, siteIds: allSites() })).unanswered.map((u) => u.question)).toEqual(['South only question about tips?']);
    expect((await svc.compute(ORG, { days: 90, siteIds: allSites() })).unanswered).toHaveLength(2);
    expect((await svc.compute(ORG, { days: 90, siteIds: [north] })).unanswered.map((u) => u.question)).toEqual(['Old question about holidays?']);
    await expect(svc.compute(ORG, { days: 12, siteIds: allSites() })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('an empty period is fine', async () => {
    expect((await svc.compute(ORG, { days: 7, siteIds: allSites() })).totals).toMatchObject({ questions: 0, answer_rate: null });
  });

  const ask = (q: string, site = north, n = 1) => { for (let i = 0; i < n; i++) istore.addConversation(site, null, [[q, IDK]]); return questionKey(q); };
  const draft = (keys: string[], over: Partial<Parameters<typeof svc.draftAnswers>[1]> = {}) => svc.draftAnswers(ORG, { keys, days: 30, siteIds: allSites(), by: 'amy@a.com', canWriteTo: () => true, ...over });

  it('writes DRAFT answers into Knowledge, aimed at the site that asked, never published', async () => {
    const key = ask('Do we get paid for training days?', north, 3);
    const r = await draft([key]);
    expect(r.created).toHaveLength(1);
    expect(r.created[0]).toMatchObject({ title: 'Do we get paid for training days?', site_id: north });
    const [item] = kstore.items;
    expect(item).toMatchObject({ status: 'draft', source: 'ai_draft', source_question: key, site_id: north, kind: 'document' });
    expect(item!.body).toBe(blankDraft('Do we get paid for training days?'));
    expect(kstore.docs).toHaveLength(0); // the chat cannot see it
  });
  it('a question asked at several sites is aimed at the whole company', async () => {
    const key = ask('Is there a staff meal policy?', north); ask('Is there a staff meal policy?', south);
    expect((await draft([key])).created[0]!.site_id).toBeNull();
  });
  it('uses the AI drafter with excerpts from published documents when there is one', async () => {
    drafter = { draft: async (q, ctx) => { calls.push([q, ctx]); return 'Training days are paid at [CONFIRM: rate].'; } };
    svc = make();
    const k = createKnowledge({ store: kstore });
    await k.createDocument(ORG, { title: 'Pay handbook', body: 'Paid training days are listed on your contract. Overtime is 1.5x.', site_id: null, status: 'published', by: 'a@b.co' });
    await k.createDocument(ORG, { title: 'Unpublished secrets', body: 'Training days confidential draft text', site_id: null, status: 'draft', by: 'a@b.co' });
    const key = ask('Do we get paid for training days?');
    const r = await draft([key]);
    expect(r.ai).toBe(true);
    expect(kstore.items.find((i) => i.source_question === key)!.body).toBe('Training days are paid at [CONFIRM: rate].');
    expect(calls[0]![1].join(' ')).toContain('Pay handbook');
    expect(calls[0]![1].join(' ')).not.toContain('confidential');
  });
  it('falls back to a blank template when the drafter fails', async () => {
    drafter = { draft: async () => null }; svc = make();
    const key = ask('Where do I report an allergen incident?');
    const r = await draft([key]);
    expect(r.ai).toBe(false);
    expect(kstore.items[0]!.body).toContain('[CONFIRM');
  });
  it('never drafts the same question twice, and reports unknown or forbidden ones', async () => {
    const key = ask('Can staff bring a guest to the staff party?');
    await draft([key]);
    expect((await draft([key])).skipped).toEqual([{ key, reason: 'already_drafted' }]);
    expect((await draft(['made up key'])).skipped).toEqual([{ key: 'made up key', reason: 'not_found' }]);
    const k2 = ask('How do I request holiday for next summer?');
    expect((await draft([k2], { canWriteTo: () => false })).skipped).toEqual([{ key: k2, reason: 'not_allowed' }]);
    expect(kstore.items).toHaveLength(1);
  });
  it('shows "draft ready" on the question afterwards, and survives a clashing title', async () => {
    const key = ask('Do we get paid for training days?');
    await createKnowledge({ store: kstore }).createDocument(ORG, { title: 'Do we get paid for training days?', body: 'x', site_id: null, status: 'draft', by: 'a@b.co' });
    const r = await draft([key]);
    expect(r.created[0]!.title).toBe('Do we get paid for training days? (2)');
    const u = (await svc.compute(ORG, { days: 30, siteIds: allSites() })).unanswered[0]!;
    expect(u.draft_item_id).toBe(r.created[0]!.item_id); expect(u.draft_status).toBe('draft');
  });
  it('finds only relevant excerpts for the AI', () => {
    const items = [{ kind: 'document', status: 'published', title: 'A', body: 'Paid training days are on the rota.' }, { kind: 'document', status: 'published', title: 'B', body: 'Fire exits are at the back.' }, { kind: 'document', status: 'draft', title: 'C', body: 'training days draft' }] as any;
    expect(findContext(items, 'Do we get paid for training days?')).toHaveLength(1);
    expect(findContext(items, 'hi')).toEqual([]);
  });
});

describe('HTTP: who sees what', () => {
  let app: FastifyInstance; let repo: FakeRepo; let istore: FakeInsightsStore; let kstore: FakeKnowledgeStore;
  const U = { owner: randomUUID(), mgrN: randomUUID(), staff: randomUUID() };
  let org: ReturnType<FakeRepo['addOrg']>; let n: ReturnType<FakeRepo['addSite']>; let s: ReturnType<FakeRepo['addSite']>;
  beforeEach(async () => {
    repo = new FakeRepo(); istore = new FakeInsightsStore(); kstore = new FakeKnowledgeStore();
    org = repo.addOrg('Acme'); n = repo.addSite(org, 'North'); s = repo.addSite(org, 'South');
    istore.siteList.push({ id: n.id, org_id: org.id, name: 'North' }, { id: s.id, org_id: org.id, name: 'South' });
    kstore.addOrg(org.id, 'acme', 'acme'); kstore.sites.push({ id: n.id, org_id: org.id }, { id: s.id, org_id: org.id });
    repo.addMember(org, 'owner@a.com', 'owner', null, U.owner); repo.addMember(org, 'mgr@a.com', 'site_manager', n, U.mgrN); repo.addMember(org, 'staff@a.com', 'staff', n, U.staff);
    istore.addConversation(n.id, null, [['North question about tips?', IDK]]); istore.addConversation(s.id, null, [['South question about parking?', IDK]]);
    app = await buildApp(testConfig, { repo, knowledgeStore: kstore, insightsStore: istore, drafter: null,
      verifyToken: fakeVerifier({ o: { userId: U.owner, email: 'owner@a.com' }, m: { userId: U.mgrN, email: 'mgr@a.com' }, s: { userId: U.staff, email: 'staff@a.com' } }) });
  });
  const get = (tok: string, q = '') => app.inject({ method: 'GET', url: `/api/v1/orgs/${org.id}/insights${q}`, headers: { authorization: 'Bearer ' + tok } });
  const post = (tok: string, body: object) => app.inject({ method: 'POST', url: `/api/v1/orgs/${org.id}/insights/drafts`, headers: { authorization: 'Bearer ' + tok }, payload: body });

  it('an owner sees every venue; a site manager only their own; staff nothing', async () => {
    expect((await get('o')).json().unanswered.map((u: any) => u.question).sort()).toEqual(['North question about tips?', 'South question about parking?']);
    expect((await get('m')).json().unanswered.map((u: any) => u.question)).toEqual(['North question about tips?']);
    expect((await get('s')).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/v1/orgs/${org.id}/insights` })).statusCode).toBe(401);
  });
  it('can narrow to one site, but not to a site you cannot see', async () => {
    expect((await get('o', `?site_id=${s.id}`)).json().unanswered).toHaveLength(1);
    expect((await get('m', `?site_id=${s.id}`)).statusCode).toBe(403);
    expect((await get('o', '?days=12')).statusCode).toBe(400);
    expect((await get('o', '?days=7')).statusCode).toBe(200);
  });
  it('a site manager drafts for their site; a draft for another site cannot be requested', async () => {
    const key = (await get('m')).json().unanswered[0].key as string;
    const r = await post('m', { keys: [key] });
    expect(r.statusCode).toBe(200);
    expect(r.json().created[0]).toMatchObject({ site_id: n.id });
    const southKey = (await get('o')).json().unanswered.find((u: any) => u.question.startsWith('South')).key as string;
    expect((await post('m', { keys: [southKey] })).json().skipped).toEqual([{ key: southKey, reason: 'not_found' }]);
    expect((await post('s', { keys: [key] })).statusCode).toBe(403);
    expect((await post('o', { keys: [] })).statusCode).toBe(400);
    expect((await post('o', { keys: Array.from({ length: 11 }, (_, i) => `k${i}`) })).statusCode).toBe(400);
  });
  it('is in the OpenAPI document', async () => {
    const spec = (await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })).json() as { paths: Record<string, unknown> };
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/api/v1/orgs/{orgId}/insights', '/api/v1/orgs/{orgId}/insights/drafts']));
  });
});
