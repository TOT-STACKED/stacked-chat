import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { questionFromTitle, startersFor, STARTER_POOL } from '../src/modules/chat/starters.js';
import type { ItemRow } from '../src/modules/knowledge/store.js';
import { FakeConversationStore } from '../src/testing/chat-fakes.js';
import { FakeKnowledgeStore } from '../src/testing/knowledge-fakes.js';
import { FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { testConfig } from './helpers.js';

describe('prompts made from a title', () => {
  it('turns how-to titles and instructions into "How do I…?"', () => {
    expect(questionFromTitle('How to change the printer roll')).toBe('How do I change the printer roll?');
    expect(questionFromTitle('Close down the coffee machine')).toBe('How do I close down the coffee machine?');
    expect(questionFromTitle('Clean the Lightspeed till screen.pdf')).toBe('How do I clean the Lightspeed till screen?');
    expect(questionFromTitle('Descale the machine (draft)')).toBe('How do I descale the machine?');
  });
  it('asks where to find lists and what policies say, and otherwise says "tell me about"', () => {
    expect(questionFromTitle('Opening checklist')).toBe('Where do I find the opening checklist?');
    expect(questionFromTitle('Allergen matrix')).toBe('Where do I find the allergen matrix?');
    expect(questionFromTitle('Holiday request process')).toBe('What does the holiday request process say?');
    expect(questionFromTitle('Staff meals')).toBe('Tell me about the staff meals');
  });
  it('gives nothing for empty or silly titles', () => { expect(questionFromTitle('')).toBeNull(); expect(questionFromTitle('ab')).toBeNull(); expect(questionFromTitle('x'.repeat(90))).toBeNull(); });
});

const item = (over: Partial<ItemRow>): ItemRow => ({ id: randomUUID(), org_id: 'o', kind: 'document', title: 'T', status: 'published', site_id: null, team_id: null, body: 'b', url: null, description: null, doc_filename: null, video_id: null, image_id: null,
  source: 'manager', source_question: null, created_by: null, created_at: '2026-01-01', updated_at: '2026-01-01', published_at: null, ...over });

describe('the welcome prompts for a venue', () => {
  it('uses the venue\'s own published knowledge first, newest first, never drafts or another venue\'s', () => {
    const q = startersFor([
      item({ title: 'How to change the printer roll', updated_at: '2026-05-01' }), item({ title: 'Close down the coffee machine', updated_at: '2026-06-01' }),
      item({ title: 'Secret leadership plan', status: 'draft' }), item({ title: 'Clean the South bar fridge', site_id: 'south' }), item({ title: 'Clean the North bar fridge', site_id: 'north' }),
    ], { siteId: 'north' });
    expect(q.slice(0, 3)).toEqual(['How do I close down the coffee machine?', 'How do I change the printer roll?', 'How do I clean the North bar fridge?']);
    expect(q.join(' ')).not.toMatch(/Secret|South/);
  });
  it('fills with practical starter prompts when a venue has little content, without repeating', () => {
    const q = startersFor([item({ title: 'How to change the printer roll' })], { siteId: 'north' });
    expect(q.length).toBeGreaterThanOrEqual(6); expect(new Set(q.map((x) => x.toLowerCase())).size).toBe(q.length);
    expect(q).toContain('How do I close down the coffee machine?'); expect(startersFor([], { siteId: 'x' })).toEqual(STARTER_POOL.slice(0, 6));
  });
});

describe('the prompts in the app', () => {
  let app: FastifyInstance; let site: string;
  beforeEach(async () => {
    const repo = new FakeRepo(); const kstore = new FakeKnowledgeStore(); const U = randomUUID(); const org = repo.addOrg('Acme'); const n = repo.addSite(org, 'North'); site = n.id;
    kstore.addOrg(org.id, 'acme', 'acme'); kstore.sites.push({ id: n.id, org_id: org.id }); repo.addMember(org, 'amy@a.com', 'staff', n, U);
    await kstore.insertItem({ ...item({ title: 'How to change the printer roll' }), org_id: org.id } as never);
    app = await buildApp(testConfig, { repo, knowledgeStore: kstore, conversationStore: new FakeConversationStore(), verifyToken: fakeVerifier({ a: { userId: U, email: 'amy@a.com' } }) });
  });
  it('offers questions made from the venue\'s knowledge, plus a starter set, on the chat context', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/chat/context', headers: { authorization: 'Bearer a' } });
    const q = r.json().sites[0].suggestions as string[];
    expect(q).toContain('How do I change the printer roll?'); expect(q.length).toBeGreaterThanOrEqual(6); expect(q.length).toBeLessThanOrEqual(12);
  });
});
