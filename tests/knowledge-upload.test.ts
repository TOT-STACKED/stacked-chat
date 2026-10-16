import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { extractText, normaliseText, sniff, titleFromFilename } from '../src/modules/knowledge/extract.js';
import { FakeKnowledgeStore } from '../src/testing/knowledge-fakes.js';
import { FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { makeDocx, makePdf } from './fixtures.js';
import { testConfig } from './helpers.js';

describe('text extraction', () => {
  it('reads a PDF, page by page, keeping line breaks', async () => {
    const r = await extractText(makePdf([['Allergen policy', 'Always check the matrix.'], ['Page two starts here.']]), 'policy.pdf');
    expect(r).toMatchObject({ kind: 'pdf', pages: 2 });
    expect(r.text).toContain('Allergen policy');
    expect(r.text).toContain('Always check the matrix.');
    expect(r.text.indexOf('matrix')).toBeLessThan(r.text.indexOf('Page two'));
  });
  it('reads a Word document, one paragraph per line', async () => {
    const r = await extractText(await makeDocx(['Fire safety', 'Meet at the car park & stay calm.']), 'Fire safety.docx');
    expect(r.kind).toBe('docx');
    expect(r.text).toBe('Fire safety\n\nMeet at the car park & stay calm.');
  });
  it('reads plain text and markdown as UTF-8', async () => {
    expect((await extractText(Buffer.from('# Rules\nNo nuts £5\r\n\r\n\r\n\r\nEnd'), 'rules.md')).text).toBe('# Rules\nNo nuts £5\n\nEnd');
  });
  it('goes by the real bytes, not the file name: a PDF called .docx is still a PDF', async () => {
    expect(sniff(makePdf([['x']]), 'whatever.docx')).toBe('pdf');
  });
  it('gives a friendly refusal for scans, old .doc files, wrong types, empty and oversized files', async () => {
    await expect(extractText(makePdf([[]]), 'scan.pdf')).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('scan') });
    await expect(extractText(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), 'old.doc')).rejects.toMatchObject({ message: expect.stringContaining('.docx') });
    await expect(extractText(Buffer.from('MZ\x90\x00binary'), 'tool.exe')).rejects.toMatchObject({ message: expect.stringContaining('not supported') });
    await expect(extractText(Buffer.alloc(0), 'a.pdf')).rejects.toMatchObject({ message: expect.stringContaining('empty') });
    await expect(extractText(Buffer.alloc(10 * 1024 * 1024 + 1, 0x25), 'big.pdf')).rejects.toMatchObject({ message: expect.stringContaining('too big') });
    await expect(extractText(Buffer.from('%PDF-1.4\nnot really a pdf'), 'broken.pdf')).rejects.toMatchObject({ statusCode: 400 });
  });
  it('refuses a zip that is not a .docx, and binary files named .txt', async () => {
    await expect(extractText(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]), 'archive.zip')).rejects.toMatchObject({ statusCode: 400 });
    await expect(extractText(Buffer.from([0x68, 0x69, 0x00, 0x01]), 'sneaky.txt')).rejects.toMatchObject({ statusCode: 400 });
  });
  it('tidies whitespace and builds a title from the file name', () => {
    expect(normaliseText('a  b  c\n\n\n\nd \n')).toBe('a b c\n\nd');
    expect(titleFromFilename('Allergen_policy  v2.PDF')).toBe('Allergen policy v2');
    expect(titleFromFilename('.pdf')).toBe('Untitled document');
  });
});

describe('POST /knowledge/upload', () => {
  let repo: FakeRepo; let app: FastifyInstance; let store: FakeKnowledgeStore;
  const U = { owner: randomUUID(), mgr: randomUUID(), staff: randomUUID() };
  let org: ReturnType<FakeRepo['addOrg']>; let n: ReturnType<FakeRepo['addSite']>; let s: ReturnType<FakeRepo['addSite']>;
  beforeEach(async () => {
    repo = new FakeRepo(); store = new FakeKnowledgeStore();
    org = repo.addOrg('Acme'); n = repo.addSite(org, 'North'); s = repo.addSite(org, 'South');
    store.addOrg(org.id, 'acme', 'acme'); store.sites.push({ id: n.id, org_id: org.id }, { id: s.id, org_id: org.id });
    repo.addMember(org, 'owner@a.com', 'owner', null, U.owner); repo.addMember(org, 'mgr@a.com', 'site_manager', n, U.mgr); repo.addMember(org, 'staff@a.com', 'staff', n, U.staff);
    app = await buildApp(testConfig, { repo, knowledgeStore: store, verifyToken: fakeVerifier({
      o: { userId: U.owner, email: 'owner@a.com' }, m: { userId: U.mgr, email: 'mgr@a.com' }, s: { userId: U.staff, email: 'staff@a.com' } }) });
  });
  const up = (tok: string, name: string, body: Buffer, type = 'application/octet-stream', site?: string) =>
    app.inject({ method: 'POST', url: `/api/v1/orgs/${org.id}/knowledge/upload?filename=${encodeURIComponent(name)}${site ? `&site_id=${site}` : ''}`,
      headers: { authorization: 'Bearer ' + tok, 'content-type': type }, payload: body });

  it('turns a PDF into a DRAFT document the chat cannot see yet', async () => {
    const r = await up('o', 'Allergen policy.pdf', makePdf([['Check the matrix.']]), 'application/pdf');
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ kind: 'document', title: 'Allergen policy', status: 'draft', site_id: null });
    expect(r.json().body).toContain('Check the matrix.');
    expect(store.docs).toHaveLength(0);
  });
  it('takes a Word file, and a text file, with whatever content type the browser sent', async () => {
    const d = await up('o', 'Fire safety.docx', await makeDocx(['Evacuate calmly.']), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(d.statusCode).toBe(201); expect(d.json().body).toBe('Evacuate calmly.');
    const t = await up('o', 'notes.txt', Buffer.from('hello'), 'text/plain'); expect(t.statusCode).toBe(201);
    const m = await up('o', 'readme.md', Buffer.from('# hi'), 'text/markdown'); expect(m.statusCode).toBe(201);
  });
  it('never clashes with an existing title', async () => {
    const pdf = makePdf([['x y z']]);
    expect((await up('o', 'Handbook.pdf', pdf)).json().title).toBe('Handbook');
    expect((await up('o', 'Handbook.pdf', pdf)).json().title).toBe('Handbook (2)');
    expect((await up('o', 'Handbook.pdf', pdf)).json().title).toBe('Handbook (3)');
  });
  it('follows the knowledge permission rules', async () => {
    const pdf = makePdf([['hello there']]);
    expect((await up('m', 'a.pdf', pdf)).statusCode).toBe(403); // company-wide is for admins
    expect((await up('m', 'a.pdf', pdf, 'application/octet-stream', n.id)).statusCode).toBe(201);
    expect((await up('m', 'b.pdf', pdf, 'application/octet-stream', s.id)).statusCode).toBe(403);
    expect((await up('s', 'c.pdf', pdf, 'application/octet-stream', n.id)).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/orgs/${org.id}/knowledge/upload?filename=a.pdf`, headers: { 'content-type': 'application/pdf' }, payload: pdf })).statusCode).toBe(401);
  });
  it('rejects bad files with a clear message, and files over 10 MB', async () => {
    const bad = await up('o', 'photo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]));
    expect(bad.statusCode).toBe(400); expect(bad.json().error.message).toContain('not supported');
    const big = await up('o', 'big.pdf', Buffer.alloc(11 * 1024 * 1024, 0x25));
    expect(big.statusCode).toBe(413);
    expect((await app.inject({ method: 'POST', url: `/api/v1/orgs/${org.id}/knowledge/upload`, headers: { authorization: 'Bearer o', 'content-type': 'application/pdf' }, payload: makePdf([['x']]) })).statusCode).toBe(400); // filename is required
  });
  it('ordinary JSON requests still work on the same routes', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/v1/orgs/${org.id}/knowledge`, headers: { authorization: 'Bearer o' }, payload: { kind: 'document', title: 'Typed', body: 'text' } });
    expect(r.statusCode).toBe(201);
  });
});
