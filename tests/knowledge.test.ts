import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createKnowledge, type Knowledge } from '../src/modules/knowledge/service.js';
import { describeVideoUrl, isHttpUrl } from '../src/modules/knowledge/video.js';
import { chunkText } from '../src/modules/knowledge/chunk.js';
import { FakeKnowledgeStore } from '../src/testing/knowledge-fakes.js';
import { FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { testConfig } from './helpers.js';

const ORG = 'org-1'; const WS = 'acme';
let store: FakeKnowledgeStore; let kb: Knowledge; let north: { id: string }; let south: { id: string };
beforeEach(() => {
  store = new FakeKnowledgeStore(); store.addOrg(ORG, 'acme', WS); north = store.addSite(ORG); south = store.addSite(ORG);
  kb = createKnowledge({ store });
});
const chatText = async (name: string) => (await store.docText(WS, name)).text;
const doc = (over: Partial<Parameters<Knowledge['createDocument']>[1]> = {}) =>
  kb.createDocument(ORG, { title: 'Allergen policy', body: 'Always check the allergen matrix.', site_id: null, status: 'draft', by: 'amy@acme.com', ...over });

describe('helpers', () => {
  it('chunks like the legacy uploader, and joining gives the text back', () => {
    const t = 'x'.repeat(2500); const c = chunkText(t);
    expect(c.map((x) => x.length)).toEqual([1200, 1200, 100]);
    expect(c.join('')).toBe(t);
    expect(chunkText('')).toEqual([]);
  });
  it('recognises YouTube, Vimeo and plain files; accepts only web links', () => {
    expect(describeVideoUrl('https://youtu.be/dQw4w9WgXcQ')).toMatchObject({ type: 'youtube', yt_id: 'dQw4w9WgXcQ' });
    expect(describeVideoUrl('https://vimeo.com/12345').type).toBe('vimeo');
    expect(describeVideoUrl('https://cdn.example.com/clip.mp4').type).toBe('mp4');
    expect(isHttpUrl('https://x.co/a')).toBe(true);
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'not a url']) expect(isHttpUrl(bad), bad).toBe(false);
  });
});

describe('adopting what the old admin drawer already stored', () => {
  it('lists existing documents, videos and images as published company-wide items, once', async () => {
    store.addLegacyDoc(WS, 'Handbook.pdf', 'a'.repeat(1500)); store.addLegacyVideo(WS, 'https://youtu.be/dQw4w9WgXcQ', 'Fire drill'); store.addLegacyImage(WS, 'https://x/i.png', 'Burger');
    const first = await kb.list(ORG);
    expect(first.map((i) => [i.kind, i.title, i.status, i.site_id, i.source]).sort()).toEqual([
      ['document', 'Handbook.pdf', 'published', null, 'imported'], ['image', 'Burger', 'published', null, 'imported'], ['video', 'Fire drill', 'published', null, 'imported'],
    ]);
    expect(first.find((i) => i.kind === 'document')?.body).toBe('a'.repeat(1500)); // chunks joined back into the text
    expect(await kb.list(ORG)).toHaveLength(3); // not adopted twice
    expect(store.docs.filter((d) => d.filename === 'Handbook.pdf')).toHaveLength(2); // the chat's copy is untouched
  });
  it("ignores other organisations' content and Stacked's shared library", async () => {
    store.addLegacyDoc('someone-else', 'Theirs', 'x'); store.addLegacyVideo('stacked', 'https://youtu.be/dQw4w9WgXcQ', 'Shared');
    expect(await kb.list(ORG)).toHaveLength(0);
  });
  it('drops an entry when its content was removed through the old drawer', async () => {
    store.addLegacyDoc(WS, 'Old.pdf', 'text'); await kb.list(ORG);
    await store.deleteDoc(WS, 'Old.pdf');
    expect(await kb.list(ORG)).toHaveLength(0);
  });
  it('never removes drafts just because they are not in the chat tables', async () => {
    await doc(); await store.docNames(WS);
    expect(await kb.list(ORG)).toHaveLength(1);
  });
  it('an organisation with no content workspace yet simply lists nothing', async () => {
    store.addOrg('org-2', 'fresh', null);
    expect(await kb.list('org-2')).toEqual([]);
  });
});

describe('drafts, publishing and the chat', () => {
  it('a draft document is kept in the catalogue only; the chat cannot see it', async () => {
    const d = await doc();
    expect(d.status).toBe('draft'); expect(d.body).toContain('allergen matrix');
    expect(store.docs).toHaveLength(0);
  });
  it('publishing copies it into what the chat reads (chunked); unpublishing takes it out and keeps the text', async () => {
    const long = 'Rule. '.repeat(500);
    const d = await doc({ body: long });
    const pub = await kb.update(ORG, d.id, { status: 'published' });
    expect(pub).toMatchObject({ status: 'published', doc_filename: 'Allergen policy' });
    expect(pub.published_at).not.toBeNull();
    expect(await chatText('Allergen policy')).toBe(long);
    expect(store.docs.filter((x) => x.filename === 'Allergen policy').length).toBeGreaterThan(1);
    const back = await kb.update(ORG, d.id, { status: 'draft' });
    expect(back).toMatchObject({ status: 'draft', doc_filename: null, published_at: null });
    expect(store.docs).toHaveLength(0);
    expect(back.body).toBe(long);
    await kb.update(ORG, d.id, { status: 'published' }); // and back again
    expect(await chatText('Allergen policy')).toBe(long);
  });
  it('creating straight to published goes live immediately', async () => {
    await doc({ status: 'published' });
    expect(await chatText('Allergen policy')).toContain('allergen matrix');
  });
  it('editing a published document replaces the chat copy, and a retitle leaves nothing behind under the old name', async () => {
    const d = await doc({ status: 'published' });
    await kb.update(ORG, d.id, { body: 'New rule.' });
    expect(await chatText('Allergen policy')).toBe('New rule.');
    const renamed = await kb.update(ORG, d.id, { title: 'Allergens' });
    expect(renamed.doc_filename).toBe('Allergens');
    expect(store.docs.map((x) => x.filename)).toEqual(['Allergens']);
    expect(await chatText('Allergens')).toBe('New rule.');
  });
  it('editing a draft does not publish it', async () => {
    const d = await doc();
    await kb.update(ORG, d.id, { body: 'Changed' });
    expect(store.docs).toHaveLength(0);
  });
  it('two documents cannot share a title', async () => {
    await doc(); await expect(doc()).rejects.toMatchObject({ statusCode: 409 });
    const other = await doc({ title: 'Other' });
    await expect(kb.update(ORG, other.id, { title: 'allergen POLICY' })).rejects.toMatchObject({ statusCode: 409 });
  });
  it('publishing for an organisation with no workspace gives it one, so its chat can find the content', async () => {
    store.addOrg('org-2', 'fresh', null); const s = store.addSite('org-2');
    const d = await kb.createDocument('org-2', { title: 'Hello', body: 'Hi', site_id: s.id, status: 'published', by: 'a@b.co' });
    expect(d.status).toBe('published');
    expect(store.orgs.get('org-2')!.workspace_id).toBe('fresh');
    expect(store.docs[0]).toMatchObject({ workspace_id: 'fresh', filename: 'Hello' });
  });
  it('deleting a published item removes it from the chat; deleting a draft leaves the chat alone', async () => {
    const live = await doc({ status: 'published' }); const draft = await doc({ title: 'Draft one' });
    await kb.remove(ORG, draft.id); expect(store.docs.length).toBeGreaterThan(0);
    await kb.remove(ORG, live.id); expect(store.docs).toHaveLength(0);
    expect(await kb.list(ORG)).toHaveLength(0);
  });
  it('refuses oversized text and unknown sites', async () => {
    await expect(doc({ body: 'x'.repeat(600_001) })).rejects.toMatchObject({ statusCode: 400 });
    await expect(doc({ site_id: randomUUID() })).rejects.toMatchObject({ statusCode: 400 });
    expect(store.items).toHaveLength(0);
  });
});

describe('videos', () => {
  it('only a published video exists in the chat, with the right type and thumbnail', async () => {
    const v = await kb.createVideo(ORG, { title: 'Fire drill', url: 'https://youtu.be/dQw4w9WgXcQ', site_id: null, status: 'draft', by: 'a@b.co' });
    expect(store.vids).toHaveLength(0);
    const pub = await kb.update(ORG, v.id, { status: 'published' });
    expect(pub.video_id).not.toBeNull();
    expect(store.vids[0]).toMatchObject({ url: 'https://youtu.be/dQw4w9WgXcQ', tenant: WS });
    await kb.update(ORG, v.id, { status: 'draft' });
    expect(store.vids).toHaveLength(0);
  });
  it('rejects links that are not web links', async () => {
    await expect(kb.createVideo(ORG, { title: 'x', url: 'javascript:alert(1)', site_id: null, status: 'draft', by: 'a@b.co' })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('an image can be unpublished and republished', async () => {
    store.addLegacyImage(WS, 'https://x/i.png', 'Burger');
    const [img] = await kb.list(ORG);
    await kb.update(ORG, img!.id, { status: 'draft' }); expect(store.imgs).toHaveLength(0);
    const again = await kb.update(ORG, img!.id, { status: 'published' }); expect(store.imgs).toHaveLength(1); expect(again.image_id).toBe(store.imgs[0]!.id);
  });
});

describe('site targeting, as the chat will see it', () => {
  it('hides a published item from every other site, never from its own, never when company-wide', async () => {
    await doc({ title: 'North only', site_id: north.id, status: 'published' });
    await doc({ title: 'Everyone', site_id: null, status: 'published' });
    await doc({ title: 'Draft for south', site_id: south.id, status: 'draft' });
    expect((await kb.excludedFor(south.id)).docs).toEqual(['North only']);
    expect((await kb.excludedFor(north.id)).docs).toEqual([]);
  });
  it('covers videos and images too', async () => {
    const v = await kb.createVideo(ORG, { title: 'N', url: 'https://youtu.be/dQw4w9WgXcQ', site_id: north.id, status: 'published', by: 'a@b.co' });
    const x = await kb.excludedFor(south.id);
    expect(x.videos).toEqual([v.video_id]);
  });
  it('a venue we do not know excludes nothing (the chat must not break)', async () => {
    expect(await kb.excludedFor(randomUUID())).toEqual({ docs: [], videos: [], images: [] });
  });
});

describe('HTTP: who may do what', () => {
  let repo: FakeRepo; let app: FastifyInstance; let store2: FakeKnowledgeStore;
  const U = { owner: randomUUID(), hq: randomUUID(), mgrN: randomUUID(), staff: randomUUID() };
  const tok = { owner: 't-owner', hq: 't-hq', mgrN: 't-mgrN', staff: 't-staff' } as const;
  let org: ReturnType<FakeRepo['addOrg']>; let n: ReturnType<FakeRepo['addSite']>; let s: ReturnType<FakeRepo['addSite']>;
  beforeEach(async () => {
    repo = new FakeRepo(); store2 = new FakeKnowledgeStore();
    org = repo.addOrg('Acme'); n = repo.addSite(org, 'North'); s = repo.addSite(org, 'South');
    store2.addOrg(org.id, 'acme', 'acme'); store2.sites.push({ id: n.id, org_id: org.id }, { id: s.id, org_id: org.id });
    repo.addMember(org, 'owner@a.com', 'owner', null, U.owner); repo.addMember(org, 'hq@a.com', 'hq_admin', null, U.hq);
    repo.addMember(org, 'mgr@a.com', 'site_manager', n, U.mgrN); repo.addMember(org, 'staff@a.com', 'staff', n, U.staff);
    app = await buildApp(testConfig, { repo, knowledgeStore: store2, verifyToken: fakeVerifier({
      [tok.owner]: { userId: U.owner, email: 'owner@a.com' }, [tok.hq]: { userId: U.hq, email: 'hq@a.com' },
      [tok.mgrN]: { userId: U.mgrN, email: 'mgr@a.com' }, [tok.staff]: { userId: U.staff, email: 'staff@a.com' } }) });
  });
  const K = () => `/api/v1/orgs/${org.id}/knowledge`;
  async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, who: keyof typeof tok, body?: unknown) {
    const res = await app.inject({ method, url, headers: { authorization: 'Bearer ' + tok[who] }, payload: body as object | undefined });
    return { status: res.statusCode, body: res.json() as any };
  }
  const post = (who: keyof typeof tok, b: object) => call('POST', K(), who, { kind: 'document', title: 'T' + Math.random(), body: 'text', ...b });

  it('company admins add company-wide knowledge; site managers only for their own site', async () => {
    expect((await post('owner', {})).status).toBe(201);
    expect((await post('hq', { site_id: s.id })).status).toBe(201);
    expect((await post('mgrN', { site_id: n.id })).status).toBe(201);
    expect((await post('mgrN', {})).status).toBe(403);
    expect((await post('mgrN', { site_id: s.id })).status).toBe(403);
    expect((await post('staff', { site_id: n.id })).status).toBe(403);
  });
  it('drafts are the default and are not live', async () => {
    const r = await post('owner', {});
    expect(r.body.status).toBe('draft');
    expect(store2.docs).toHaveLength(0);
    const live = await post('owner', { status: 'published' });
    expect(live.body.status).toBe('published'); expect(store2.docs.length).toBeGreaterThan(0);
  });
  it('a site manager sees company-wide items and their own site, not other sites; staff see nothing', async () => {
    await post('owner', { title: 'Company', site_id: null }); await post('owner', { title: 'North', site_id: n.id }); await post('owner', { title: 'South', site_id: s.id });
    const titles = (who: keyof typeof tok) => call('GET', K(), who).then((r) => r.body.data.map((i: any) => i.title).sort());
    expect(await titles('owner')).toEqual(['Company', 'North', 'South']);
    expect(await titles('mgrN')).toEqual(['Company', 'North']);
    expect(await titles('staff')).toEqual([]);
  });
  it('opening, editing and deleting follow the same rules', async () => {
    const co = (await post('owner', { title: 'Company' })).body; const so = (await post('owner', { title: 'South', site_id: s.id })).body; const no = (await post('owner', { title: 'North', site_id: n.id })).body;
    expect((await call('GET', `${K()}/${no.id}`, 'mgrN')).body.body).toBe('text');
    expect((await call('GET', `${K()}/${so.id}`, 'mgrN')).status).toBe(404); // other site: not even visible
    expect((await call('PATCH', `${K()}/${co.id}`, 'mgrN', { title: 'Hacked' })).status).toBe(403); // visible, but company-wide is for admins
    expect((await call('PATCH', `${K()}/${no.id}`, 'mgrN', { title: 'Renamed', status: 'published' })).body).toMatchObject({ title: 'Renamed', status: 'published' });
    expect((await call('PATCH', `${K()}/${no.id}`, 'mgrN', { site_id: null })).status).toBe(403); // cannot widen to the whole company
    expect((await call('PATCH', `${K()}/${no.id}`, 'mgrN', { site_id: s.id })).status).toBe(403); // or move it to a site they do not run
    expect((await call('DELETE', `${K()}/${co.id}`, 'mgrN')).status).toBe(403);
    expect((await call('DELETE', `${K()}/${no.id}`, 'mgrN')).body).toEqual({ deleted: true });
    expect(store2.docs).toHaveLength(0);
  });
  it('validates input (empty title, bad video link, nothing to change)', async () => {
    expect((await post('owner', { title: '   ' })).status).toBe(400);
    expect((await call('POST', K(), 'owner', { kind: 'video', title: 'v', url: 'javascript:alert(1)' })).status).toBe(400);
    const d = (await post('owner', {})).body;
    expect((await call('PATCH', `${K()}/${d.id}`, 'owner', {})).status).toBe(400);
  });
  it("a different organisation's id is a 404, not a leak", async () => {
    const other = repo.addOrg('Other');
    const r = await app.inject({ method: 'GET', url: `/api/v1/orgs/${other.id}/knowledge`, headers: { authorization: 'Bearer ' + tok.owner } });
    expect(r.statusCode).toBe(404);
  });
  it('an API key with kb:read sees published items only, and cannot write', async () => {
    await post('owner', { title: 'Live', status: 'published' }); await post('owner', { title: 'Hidden draft' });
    const key = (await call('POST', `/api/v1/orgs/${org.id}/api-keys`, 'owner', { name: 'hub', scopes: ['kb:read'] })).body.key as string;
    const list = await app.inject({ method: 'GET', url: K(), headers: { 'x-api-key': key } });
    expect(list.json().data.map((i: any) => i.title)).toEqual(['Live']);
    const write = await app.inject({ method: 'POST', url: K(), headers: { 'x-api-key': key }, payload: { kind: 'document', title: 'x', body: 'y' } });
    expect(write.statusCode).toBe(403);
    const noScope = (await call('POST', `/api/v1/orgs/${org.id}/api-keys`, 'owner', { name: 'chatonly', scopes: ['chat'] })).body.key as string;
    expect((await app.inject({ method: 'GET', url: K(), headers: { 'x-api-key': noScope } })).statusCode).toBe(403);
  });
  it('is in the OpenAPI document', async () => {
    const spec = (await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })).json() as { paths: Record<string, unknown> };
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/api/v1/orgs/{orgId}/knowledge', '/api/v1/orgs/{orgId}/knowledge/{id}']));
  });
});
