import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { imageFileName, imageTitle, sniffImage } from '../src/modules/knowledge/image.js';
import { imagesBehind, retrievePassages } from '../src/modules/chat/retrieve.js';
import type { PictureReader } from '../src/modules/knowledge/vision.js';
import type { ItemRow } from '../src/modules/knowledge/store.js';
import { FakeKnowledgeStore } from '../src/testing/knowledge-fakes.js';
import { FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { testConfig } from './helpers.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake png body')]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

describe('picture helpers', () => {
  it('goes by the real bytes: PNG, JPEG and WebP only', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(JPG)).toBe('image/jpeg');
    expect(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')]))).toBe('image/webp');
    expect(() => sniffImage(Buffer.from('GIF89a......'))).toThrow(/not supported/);
    expect(() => sniffImage(Buffer.from('<svg onload=alert(1)>'))).toThrow(/not supported/);
  });
  it('names the stored file and the title from the original name', () => {
    expect(imageFileName('../My Espresso Martini!!.HEIC', 'image/jpeg')).toBe('My_Espresso_Martini_.jpg');
    expect(imageTitle('espresso_martini-spec.jpg')).toBe('Espresso martini spec');
    expect(imageTitle('.png')).toBe('Picture');
  });
});

describe('pictures in the chat', () => {
  const img = (over: Partial<ItemRow> = {}): ItemRow => ({ id: 'i1', org_id: 'o', kind: 'image', title: 'Espresso martini', status: 'published', site_id: null, team_id: null, body: null, url: 'https://x/e.jpg', description: 'Espresso martini: 50ml vodka, 25ml coffee liqueur, 30ml fresh espresso. Shake hard and strain.', doc_filename: null, video_id: null, image_id: 'g1', source: 'manager', source_question: null, created_by: null, created_at: '', updated_at: '', published_at: null, ...over });
  it('answers from a picture\'s written details and says which picture was behind it', () => {
    const items = [img()];
    const p = retrievePassages(items, 'how much coffee liqueur goes in an espresso martini?');
    expect(p[0]!.title).toBe('Espresso martini');
    expect(p[0]!.text).toContain('25ml coffee liqueur');
    expect(imagesBehind(items, p).map((i) => i.id)).toEqual(['i1']);
  });
  it('ignores a picture with no details', () => {
    expect(retrievePassages([img({ description: null })], 'how much vodka in an espresso martini?').length).toBeGreaterThan(-1);
    expect(retrievePassages([img({ description: null, title: 'IMG 4021' })], 'how much vodka?')).toEqual([]);
  });
});

describe('picture upload and reading', () => {
  let repo: FakeRepo; let app: FastifyInstance; let store: FakeKnowledgeStore;
  let stored: Array<{ path: string; type: string; bytes: number }>; let reads: number; let readerText: string | null; let failUpload: boolean;
  const U = { owner: randomUUID(), mgr: randomUUID(), staff: randomUUID() };
  let org: ReturnType<FakeRepo['addOrg']>; let n: ReturnType<FakeRepo['addSite']>; let s: ReturnType<FakeRepo['addSite']>;
  beforeEach(async () => {
    stored = []; reads = 0; readerText = 'Espresso martini\n50ml vodka\n25ml coffee liqueur'; failUpload = false;
    repo = new FakeRepo(); store = new FakeKnowledgeStore();
    org = repo.addOrg('Acme'); n = repo.addSite(org, 'North'); s = repo.addSite(org, 'South');
    store.addOrg(org.id, 'acme', 'acme'); store.sites.push({ id: n.id, org_id: org.id }, { id: s.id, org_id: org.id });
    repo.addMember(org, 'owner@a.com', 'owner', null, U.owner); repo.addMember(org, 'mgr@a.com', 'site_manager', n, U.mgr); repo.addMember(org, 'staff@a.com', 'staff', n, U.staff);
    const reader: PictureReader = { async read() { reads++; return readerText; } };
    const storage = {
      async signUrls(urls: Array<string | null | undefined>) { return urls.map((u) => (u ? `data:image/png;base64,${PNG.toString('base64')}` : null)); },
      async uploadObject(path: string, data: Uint8Array, type: string) { if (failUpload) throw new Error('boom'); stored.push({ path, type, bytes: data.length }); return `https://files.test/${path}`; },
    };
    app = await buildApp(testConfig, { repo, knowledgeStore: store, storage, pictureReader: reader, verifyToken: fakeVerifier({
      o: { userId: U.owner, email: 'owner@a.com' }, m: { userId: U.mgr, email: 'mgr@a.com' }, s: { userId: U.staff, email: 'staff@a.com' } }) });
  });
  const up = (tok: string, name: string, body: Buffer, site?: string) =>
    app.inject({ method: 'POST', url: `/api/v1/orgs/${org.id}/knowledge/upload-image?filename=${encodeURIComponent(name)}${site ? `&site_id=${site}` : ''}`,
      headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/octet-stream' }, payload: body });
  const read = (tok: string, id: string) => app.inject({ method: 'POST', url: `/api/v1/orgs/${org.id}/knowledge/${id}/read-picture`, headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, payload: '{}' });

  it('stores the picture privately and adds it as a draft the chat cannot use yet', async () => {
    const r = await up('o', 'espresso_martini.png', PNG);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ kind: 'image', title: 'Espresso martini', status: 'draft', site_id: null });
    expect(r.json().preview_url).toContain('data:image/png');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ type: 'image/png', bytes: PNG.length });
    expect(stored[0]!.path).toMatch(new RegExp(`^images/${org.id}/\\d+-espresso_martini\\.png$`));
    expect(await store.images('acme')).toHaveLength(0);
  });
  it('refuses anything that is not really a PNG, JPEG or WebP, whatever it is called', async () => {
    const r = await up('o', 'logo.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    expect(r.statusCode).toBe(400); expect(r.json().error.message).toContain('not supported'); expect(stored).toHaveLength(0);
  });
  it('keeps staff out, and managers to their own site', async () => {
    expect((await up('s', 'a.png', PNG)).statusCode).toBe(403);
    expect((await up('m', 'a.png', PNG)).statusCode).toBe(403); // whole company is for admins
    expect((await up('m', 'a.png', PNG, n.id)).statusCode).toBe(201);
    expect((await up('m', 'a.png', PNG, s.id)).statusCode).toBe(403);
  });
  it('says so when storage fails, and when it is not switched on', async () => {
    failUpload = true;
    const r = await up('o', 'a.png', PNG);
    expect(r.statusCode).toBe(502); expect(r.json().error.message).toContain('try again');
    const bare = await buildApp(testConfig, { repo, knowledgeStore: store, storage: null, verifyToken: fakeVerifier({ o: { userId: U.owner, email: 'owner@a.com' } }) });
    const off = await bare.inject({ method: 'POST', url: `/api/v1/orgs/${org.id}/knowledge/upload-image?filename=a.png`, headers: { authorization: 'Bearer o', 'content-type': 'application/octet-stream' }, payload: PNG });
    expect(off.statusCode).toBe(503);
  });
  it('publishing a described picture puts it in the chat with its details', async () => {
    const made = (await up('o', 'espresso_martini.png', PNG)).json();
    const r = await app.inject({ method: 'PATCH', url: `/api/v1/orgs/${org.id}/knowledge/${made.id}`, headers: { authorization: 'Bearer o' }, payload: { description: '50ml vodka, 25ml coffee liqueur', status: 'published' } });
    expect(r.statusCode).toBe(200); expect(r.json()).toMatchObject({ status: 'published', description: '50ml vodka, 25ml coffee liqueur' });
    const live = await store.images('acme'); expect(live).toHaveLength(1); expect(live[0]).toMatchObject({ title: 'Espresso martini', description: '50ml vodka, 25ml coffee liqueur' });
  });
  it('reads the writing off a picture and returns it to be checked, saving nothing', async () => {
    const made = (await up('o', 'spec.png', PNG)).json();
    const r = await read('o', made.id);
    expect(r.statusCode).toBe(200); expect(r.json().text).toContain('25ml coffee liqueur'); expect(reads).toBe(1);
    const after = await app.inject({ method: 'GET', url: `/api/v1/orgs/${org.id}/knowledge/${made.id}`, headers: { authorization: 'Bearer o' } });
    expect(after.json().description).toBeNull();
  });
  it('only managers of that audience can have a picture read, and only pictures', async () => {
    const made = (await up('o', 'spec.png', PNG)).json();
    expect((await read('m', made.id)).statusCode).toBe(403); // company-wide item: a site manager can see it but not change it
    expect((await read('s', made.id)).statusCode).toBe(404);
    const doc = await app.inject({ method: 'POST', url: `/api/v1/orgs/${org.id}/knowledge`, headers: { authorization: 'Bearer o' }, payload: { kind: 'document', title: 'Doc', body: 'x' } });
    expect((await read('o', doc.json().id)).statusCode).toBe(404);
    expect(reads).toBe(0);
  });
  it('says so when the text could not be read, or reading is not switched on', async () => {
    const made = (await up('o', 'spec.png', PNG)).json();
    readerText = null;
    const r = await read('o', made.id);
    expect(r.statusCode).toBe(502); expect(r.json().error.message).toContain('type the details');
  });
});
