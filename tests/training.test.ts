import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { cleanLessons, cleanQuiz, statusOf } from '../src/modules/training/service.js';
import { FakeTrainingStore } from '../src/testing/training-fakes.js';
import { FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { testConfig } from './helpers.js';

describe('course content', () => {
  it('cleans lessons and keeps the id of a lesson that stays', () => {
    const a = cleanLessons([{ title: '  Hands ', body: ' Wash for 20 seconds.\n\n\n\nThen dry. ' }, { title: 'Fridges', body: 'Keep below 5C.', url: 'https://youtu.be/abc' }]);
    expect(a[0]).toMatchObject({ title: 'Hands', body: 'Wash for 20 seconds.\n\nThen dry.', url: null }); expect(a[1]!.url).toBe('https://youtu.be/abc');
    expect(cleanLessons([{ id: a[1]!.id, title: 'Fridges', body: 'x' }], a)[0]!.id).toBe(a[1]!.id);
  });
  it('refuses empty courses, empty lessons and video links that are not https', () => {
    expect(() => cleanLessons([])).toThrow(/at least one lesson/);
    expect(() => cleanLessons([{ title: '', body: 'x' }])).toThrow(/cannot be empty/);
    expect(() => cleanLessons([{ title: 'a', body: 'x', url: 'http://x.co' }])).toThrow(/https/);
  });
  it('checks quiz questions: 2 to 4 answers, a correct one that exists, even after blank answers are dropped', () => {
    const q = cleanQuiz([{ q: 'Fridge temp?', options: ['2C', '', '5C', '9C'], answer: 2 }]);
    expect(q[0]).toMatchObject({ options: ['2C', '5C', '9C'], answer: 1 });
    expect(() => cleanQuiz([{ q: 'x', options: ['only'], answer: 0 }])).toThrow(/between 2 and 4/);
    expect(() => cleanQuiz([{ q: 'x', options: ['a', 'b'], answer: 5 }])).toThrow(/correct/);
    expect(() => cleanQuiz([{ q: 'x', options: ['a', '', 'c'], answer: 1 }])).toThrow(/correct/); // the blank one
  });
  it('works out done, due a refresher or to do', () => {
    const c = { renew_months: 12 }; const row = { id: '1', course_id: 'c', org_id: 'o', email: 'a@b.co', score: 90, completed_at: '2026-01-15T10:00:00.000Z' };
    expect(statusOf(c, [], new Date('2026-06-01'))).toMatchObject({ status: 'todo' });
    expect(statusOf(c, [row], new Date('2026-06-01'))).toMatchObject({ status: 'done', expires_at: '2027-01-15T10:00:00.000Z' });
    expect(statusOf(c, [row], new Date('2027-01-16'))).toMatchObject({ status: 'renew' });
    expect(statusOf({ renew_months: null }, [row], new Date('2040-01-01'))).toMatchObject({ status: 'done', expires_at: null });
  });
});

describe('training', () => {
  let repo: FakeRepo; let app: FastifyInstance; let store: FakeTrainingStore; let clock: Date;
  const U = { owner: randomUUID(), mgr: randomUUID(), s1: randomUUID(), s2: randomUUID(), s3: randomUUID() };
  let org: ReturnType<FakeRepo['addOrg']>; let n: ReturnType<FakeRepo['addSite']>; let s: ReturnType<FakeRepo['addSite']>; let kitchen: ReturnType<FakeRepo['addTeam']>;
  beforeEach(async () => {
    repo = new FakeRepo(); store = new FakeTrainingStore(); clock = new Date('2026-03-10T10:00:00Z');
    org = repo.addOrg('Acme'); n = repo.addSite(org, 'North'); s = repo.addSite(org, 'South'); kitchen = repo.addTeam(org, 'Kitchen', n);
    repo.addMember(org, 'owner@a.com', 'owner', null, U.owner); repo.addMember(org, 'mgr@a.com', 'site_manager', n, U.mgr);
    const one = repo.addMember(org, 'one@a.com', 'staff', n, U.s1); repo.addMember(org, 'two@a.com', 'staff', n, U.s2); repo.addMember(org, 'three@a.com', 'staff', s, U.s3);
    await repo.setMemberTeams(one.id, [kitchen.id]);
    app = await buildApp(testConfig, { repo, trainingStore: store, now: () => clock, verifyToken: fakeVerifier({
      o: { userId: U.owner, email: 'owner@a.com' }, m: { userId: U.mgr, email: 'mgr@a.com' }, a: { userId: U.s1, email: 'one@a.com' }, b: { userId: U.s2, email: 'two@a.com' }, c: { userId: U.s3, email: 'three@a.com' } }) });
  });
  const call = (tok: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { authorization: 'Bearer ' + tok }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const base = () => `/api/v1/orgs/${org.id}/training`;
  const course = (extra: Record<string, unknown> = {}) => ({ title: 'Fire safety', description: 'What to do if the alarm sounds.', lessons: [{ title: 'The alarm', body: 'Stop service and lead guests out.' }, { title: 'Assembly', body: 'Meet at the car park.' }],
    quiz: [{ q: 'Where do we meet?', options: ['The bar', 'The car park', 'Inside'], answer: 1 }, { q: 'First step?', options: ['Finish the order', 'Stop service'], answer: 1 }], ...extra });
  const make = async (tok = 'o', extra: Record<string, unknown> = {}) => (await call(tok, 'POST', base(), course(extra))).json();
  const list = async (tok: string, site = n.id) => (await call(tok, 'GET', `/api/v1/chat/training?site_id=${site}`)).json();

  it('lets an owner write for everyone and a site manager for their own venue or its teams only', async () => {
    expect((await call('o', 'POST', base(), course())).statusCode).toBe(201);
    expect((await call('m', 'POST', base(), course())).statusCode).toBe(403);
    expect((await call('m', 'POST', base(), course({ site_id: n.id }))).statusCode).toBe(201);
    expect((await call('m', 'POST', base(), course({ site_id: s.id }))).statusCode).toBe(403);
    expect((await call('m', 'POST', base(), course({ team_id: kitchen.id }))).statusCode).toBe(201);
    expect((await call('a', 'POST', base(), course({ site_id: n.id }))).statusCode).toBe(403);
  });
  it('shows staff the courses for their venue and teams, and never the quiz answers', async () => {
    await make('o', { title: 'Everyone' }); await make('o', { title: 'South only', site_id: s.id }); await make('o', { title: 'Kitchen only', team_id: kitchen.id });
    expect((await list('a')).data.map((c: { title: string }) => c.title).sort()).toEqual(['Everyone', 'Kitchen only']);
    expect((await list('b')).data.map((c: { title: string }) => c.title)).toEqual(['Everyone']);
    expect((await list('c', s.id)).data.map((c: { title: string }) => c.title).sort()).toEqual(['Everyone', 'South only']);
    const c = (await list('a')).data[0];
    const detail = await call('a', 'GET', `/api/v1/chat/training/${c.id}?site_id=${n.id}`);
    expect(detail.statusCode).toBe(200); expect(detail.json().lessons).toHaveLength(2);
    expect(JSON.stringify(detail.json())).not.toContain('"answer"');
    expect((await call('b', 'GET', `/api/v1/chat/training/${(await list('a')).data.find((x: { title: string }) => x.title === 'Kitchen only').id}?site_id=${n.id}`)).statusCode).toBe(404);
  });
  it('records a sign-off only when the quiz is passed, and says which questions were missed without giving the answer', async () => {
    const c = await make('o', { pass_percent: 100 });
    const fail = await call('a', 'POST', `/api/v1/chat/training/${c.id}/complete`, { site_id: n.id, answers: [0, 1] });
    expect(fail.json()).toMatchObject({ passed: false, score: 50, correct: 1, total: 2, completed_at: null }); expect(fail.json().wrong).toEqual([c.quiz[0].id]);
    expect((await list('a')).data[0].status).toBe('todo');
    expect((await call('a', 'POST', `/api/v1/chat/training/${c.id}/complete`, { site_id: n.id, answers: [1] })).statusCode).toBe(400);
    const pass = await call('a', 'POST', `/api/v1/chat/training/${c.id}/complete`, { site_id: n.id, answers: [1, 1] });
    expect(pass.json()).toMatchObject({ passed: true, score: 100, completed_at: clock.toISOString() });
    expect((await list('a')).data[0]).toMatchObject({ status: 'done', score: 100 }); expect((await list('a')).todo).toBe(0);
  });
  it('lets a course with no quiz be signed off only when the person confirms', async () => {
    const c = await make('o', { quiz: [] });
    expect((await call('a', 'POST', `/api/v1/chat/training/${c.id}/complete`, { site_id: n.id })).statusCode).toBe(400);
    const r = await call('a', 'POST', `/api/v1/chat/training/${c.id}/complete`, { site_id: n.id, confirm: true });
    expect(r.json()).toMatchObject({ passed: true, score: null });
  });
  it('shows managers who has done it, who is due a refresher and who has not started', async () => {
    const c = await make('o', { site_id: n.id, renew_months: 12, pass_percent: 50 });
    await call('a', 'POST', `/api/v1/chat/training/${c.id}/complete`, { site_id: n.id, answers: [1, 1] });
    clock = new Date('2027-04-01T10:00:00Z');
    await call('b', 'POST', `/api/v1/chat/training/${c.id}/complete`, { site_id: n.id, answers: [1, 1] });
    const mgr = (await call('m', 'GET', base())).json().data[0];
    expect(mgr.stats).toEqual({ recipients: 3, done: 1, renew: 1, todo: 1 }); // mgr (todo), one (renew), two (done)
    const p = (await call('o', 'GET', `${base()}/${c.id}/progress`)).json();
    expect(p.people.map((x: { email: string; status: string }) => [x.email, x.status])).toEqual([['mgr@a.com', 'todo'], ['one@a.com', 'renew'], ['two@a.com', 'done']]);
    expect((await list('a')).data[0].status).toBe('renew'); expect((await list('a')).todo).toBe(1);
  });
  it('hides switched-off courses from staff, keeps sign-offs when edited, and removes everything on delete', async () => {
    const c = await make('o', { site_id: n.id });
    await call('a', 'POST', `/api/v1/chat/training/${c.id}/complete`, { site_id: n.id, answers: [1, 1] });
    const edit = await call('o', 'PATCH', `${base()}/${c.id}`, { title: 'Fire safety 2026', lessons: [{ id: c.lessons[0].id, title: 'The alarm', body: 'Updated.' }] });
    expect(edit.json()).toMatchObject({ title: 'Fire safety 2026' }); expect(edit.json().lessons[0].id).toBe(c.lessons[0].id);
    expect((await list('a')).data[0].status).toBe('done');
    await call('o', 'PATCH', `${base()}/${c.id}`, { active: false });
    expect((await list('a')).data).toEqual([]);
    expect((await call('a', 'GET', `/api/v1/chat/training/${c.id}?site_id=${n.id}`)).statusCode).toBe(404);
    expect((await call('m', 'DELETE', `${base()}/${c.id}`)).statusCode).toBe(200);
    expect(store.done).toHaveLength(0);
  });
  it('keeps managers to their own courses and staff out of the manager list', async () => {
    const wide = await make('o'); const mine = await make('m', { site_id: n.id });
    expect((await call('m', 'PATCH', `${base()}/${wide.id}`, { title: 'hijack' })).statusCode).toBe(403);
    expect((await call('m', 'DELETE', `${base()}/${wide.id}`)).statusCode).toBe(403);
    expect((await call('m', 'PATCH', `${base()}/${mine.id}`, { title: 'Mine' })).statusCode).toBe(200);
    expect((await call('a', 'GET', base())).json().data).toEqual([]);
    expect((await call('c', 'GET', `/api/v1/chat/training?site_id=${n.id}`)).statusCode).toBe(403);
  });
  it('refuses a bad course', async () => {
    expect((await call('o', 'POST', base(), course({ lessons: [] }))).statusCode).toBe(400);
    expect((await call('o', 'POST', base(), course({ quiz: [{ q: 'x', options: ['a'], answer: 0 }] }))).statusCode).toBe(400);
    expect((await call('o', 'POST', base(), course({ site_id: randomUUID() }))).statusCode).toBe(400);
    expect((await call('o', 'POST', base(), course({ pass_percent: 20 }))).statusCode).toBe(400);
  });
});

import { parseDraft, type CourseDrafter, type DraftedCourse } from '../src/modules/training/drafter.js';
import { FakeKnowledgeStore } from '../src/testing/knowledge-fakes.js';

describe('draft a course from a document', () => {
  const good = { title: 'Allergens', description: 'The 14 allergens and what to do.', lessons: [{ title: 'The 14', body: 'Know the 14 allergens.' }, { title: 'Ask first', body: 'Always ask guests.' }], quiz: [{ q: 'How many allergens?', options: ['10', '14', '20'], answer: 1 }] };
  it('reads the model\'s JSON even when it is wrapped in a code fence, and drops anything malformed', () => {
    const d = parseDraft('Here you go:\n```json\n' + JSON.stringify(good) + '\n```');
    expect(d).toMatchObject({ title: 'Allergens', lessons: [{ title: 'The 14' }, { title: 'Ask first' }], quiz: [{ q: 'How many allergens?', answer: 1 }] });
    const messy = parseDraft(JSON.stringify({ ...good, lessons: [...good.lessons, { title: '', body: 'no title' }], quiz: [...good.quiz, { q: 'bad', options: ['one'], answer: 0 }, { q: 'bad2', options: ['a', 'b'], answer: 7 }] }));
    expect(messy!.lessons).toHaveLength(2); expect(messy!.quiz).toHaveLength(1);
    expect(parseDraft('not json at all')).toBeNull(); expect(parseDraft('{"lessons": []}')).toBeNull(); expect(parseDraft('{"lessons": "x"}')).toBeNull();
  });

  let repo: FakeRepo; let app: FastifyInstance; let kstore: FakeKnowledgeStore; let asked: Array<{ title: string; text: string }>; let result: DraftedCourse | null;
  const U = { owner: randomUUID(), mgr: randomUUID(), staff: randomUUID() };
  let org: ReturnType<FakeRepo['addOrg']>; let n: ReturnType<FakeRepo['addSite']>; let s: ReturnType<FakeRepo['addSite']>;
  const long = 'Always check the allergen matrix before service. '.repeat(10);
  beforeEach(async () => {
    repo = new FakeRepo(); kstore = new FakeKnowledgeStore(); asked = []; result = { title: 'Allergens', description: 'About allergens.', lessons: [{ title: 'One', body: 'Body.' }], quiz: [{ q: 'Q?', options: ['a', 'b'], answer: 0 }] };
    org = repo.addOrg('Acme'); n = repo.addSite(org, 'North'); s = repo.addSite(org, 'South');
    kstore.addOrg(org.id, 'acme', 'acme'); kstore.sites.push({ id: n.id, org_id: org.id }, { id: s.id, org_id: org.id });
    repo.addMember(org, 'owner@a.com', 'owner', null, U.owner); repo.addMember(org, 'mgr@a.com', 'site_manager', n, U.mgr); repo.addMember(org, 'staff@a.com', 'staff', n, U.staff);
    const drafter: CourseDrafter = { async draft(i) { asked.push(i); return result; } };
    app = await buildApp(testConfig, { repo, knowledgeStore: kstore, trainingStore: new FakeTrainingStore(), courseDrafter: drafter, verifyToken: fakeVerifier({
      o: { userId: U.owner, email: 'owner@a.com' }, m: { userId: U.mgr, email: 'mgr@a.com' }, s: { userId: U.staff, email: 'staff@a.com' } }) });
  });
  let docN = 0;
  const doc = (body = long, site: string | null = null) => app.knowledge!.createDocument(org.id, { title: docN++ ? `Allergen policy ${docN}` : 'Allergen policy', body, site_id: site, status: 'published', by: 'owner@a.com' });
  const draft = (tok: string, id: string) => app.inject({ method: 'POST', url: `/api/v1/orgs/${org.id}/training/draft`, headers: { authorization: 'Bearer ' + tok }, payload: { knowledge_id: id } });

  it('drafts from a document a manager can see, sends the AI the document\'s own text, and saves nothing', async () => {
    const d = await doc(); const r = await draft('o', d.id);
    expect(r.statusCode).toBe(200); expect(r.json()).toMatchObject({ title: 'Allergens', lessons: [{ title: 'One' }], quiz: [{ answer: 0 }], source: { title: 'Allergen policy', truncated: false } });
    expect(asked[0]).toMatchObject({ title: 'Allergen policy' }); expect(asked[0]!.text).toContain('allergen matrix');
    expect((await app.inject({ method: 'GET', url: `/api/v1/orgs/${org.id}/training`, headers: { authorization: 'Bearer o' } })).json().data).toEqual([]);
  });
  it('keeps managers to documents for their own venue, and staff out', async () => {
    const mine = await doc(long, n.id); const theirs = await doc(long, s.id);
    expect((await draft('m', mine.id)).statusCode).toBe(200);
    expect((await draft('m', theirs.id)).statusCode).toBe(404);
    expect((await draft('s', mine.id)).statusCode).toBe(404);
  });
  it('says so when the document is too short, is not a document, or the AI cannot draft', async () => {
    expect((await draft('o', (await doc('Too short.')).id)).statusCode).toBe(400);
    expect((await draft('o', randomUUID())).statusCode).toBe(404);
    result = null; expect((await draft('o', (await doc()).id)).statusCode).toBe(502);
  });
  it('is off without a drafter', async () => {
    const bare = await buildApp(testConfig, { repo, knowledgeStore: kstore, trainingStore: new FakeTrainingStore(), courseDrafter: null, verifyToken: fakeVerifier({ o: { userId: U.owner, email: 'owner@a.com' } }) });
    const d = await bare.knowledge!.createDocument(org.id, { title: 'P', body: long, site_id: null, status: 'published', by: 'owner@a.com' });
    expect((await bare.inject({ method: 'POST', url: `/api/v1/orgs/${org.id}/training/draft`, headers: { authorization: 'Bearer o' }, payload: { knowledge_id: d.id } })).statusCode).toBe(503);
  });
});
