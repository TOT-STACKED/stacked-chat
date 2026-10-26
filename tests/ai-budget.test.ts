import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createAiBudget, UNITS } from '../src/lib/ai-budget.js';
import type { ChatModel, ChatTurn } from '../src/modules/chat/model.js';
import { FakeConversationStore } from '../src/testing/chat-fakes.js';
import { FakeKnowledgeStore } from '../src/testing/knowledge-fakes.js';
import { FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { testConfig } from './helpers.js';

describe('the daily AI allowance', () => {
  const make = (over: Partial<Parameters<typeof createAiBudget>[0]> = {}) => {
    let t = new Date('2026-03-10T10:00:00Z'); const told: string[] = [];
    const b = createAiBudget({ perOrg: 5, perTrial: 2, all: 8, notify: async (m) => { told.push(m); return true; }, orgName: async (id) => `Co ${id}`, now: () => t, ...over });
    return { b, told, set: (d: string) => { t = new Date(d); } };
  };
  it('lets a company use its allowance and then refuses, with a message people can read', async () => {
    const { b } = make();
    for (let i = 0; i < 5; i++) await b.spend('a');
    await expect(b.spend('a')).rejects.toMatchObject({ statusCode: 429, code: 'ai_limit', message: expect.stringContaining('midnight') });
  });
  it('gives a free trial a smaller allowance than a paying company', async () => {
    const { b } = make({ isTrial: async (id) => id === 'trial' });
    await b.spend('trial'); await b.spend('trial');
    await expect(b.spend('trial')).rejects.toMatchObject({ statusCode: 429 });
    for (let i = 0; i < 5; i++) await b.spend('paid');
  });
  it('counts bigger jobs for more, so drafting a course cannot be spammed', async () => {
    const { b } = make({ perOrg: 20, all: 100 });
    await b.spend('a', UNITS.draft); await b.spend('a', UNITS.draft);
    await expect(b.spend('a', UNITS.draft)).rejects.toMatchObject({ statusCode: 429 });
  });
  it('has a ceiling for everyone together, so many trials cannot add up to a big bill', async () => {
    const { b } = make({ perOrg: 100 });
    for (let i = 0; i < 8; i++) await b.spend(`co${i}`);
    await expect(b.spend('another')).rejects.toMatchObject({ statusCode: 429, code: 'ai_busy' });
  });
  it('starts afresh at midnight UK time', async () => {
    const { b, set } = make({ perOrg: 1 });
    set('2026-07-10T22:30:00Z'); await b.spend('a'); await expect(b.spend('a')).rejects.toBeTruthy(); // 23:30 in the UK in summer
    set('2026-07-10T23:30:00Z'); await b.spend('a'); // 00:30 the next UK day
  });
  it('tells Stacked once a day when a company or everyone hits the limit, and a failing alert never blocks', async () => {
    const { b, told } = make({ perOrg: 1 });
    await b.spend('a'); for (let i = 0; i < 3; i++) await expect(b.spend('a')).rejects.toBeTruthy();
    expect(told).toHaveLength(1); expect(told[0]).toContain('Co a'); expect(told[0]).toContain('AI_DAILY_CAP');
    const broken = make({ perOrg: 1, notify: async () => { throw new Error('slack down'); } });
    await broken.b.spend('a'); await expect(broken.b.spend('a')).rejects.toMatchObject({ statusCode: 429 });
  });
  it('shows today\'s totals without any content', async () => {
    const { b } = make(); await b.spend('a'); await b.spend('b'); await b.spend('b');
    expect(b.snapshot()).toMatchObject({ total: 3, all: 8, companies: 2, busiest: [{ org_id: 'b', used: 2 }, { org_id: 'a', used: 1 }] });
  });
});

describe('the allowance in the app', () => {
  class Model implements ChatModel { calls = 0; async complete(_i: { system: string; messages: ChatTurn[] }) { this.calls++; return 'ok'; } }
  it('stops answering chat questions once the company is over, without calling the model', async () => {
    const repo = new FakeRepo(); const model = new Model(); const kstore = new FakeKnowledgeStore();
    const org = repo.addOrg('Acme'); const n = repo.addSite(org, 'North'); const U = randomUUID();
    kstore.addOrg(org.id, 'acme', 'acme'); kstore.sites.push({ id: n.id, org_id: org.id }); repo.addMember(org, 'amy@a.com', 'staff', n, U);
    const app = await buildApp(testConfig, { repo, knowledgeStore: kstore, conversationStore: new FakeConversationStore(), chatModel: model, aiBudget: createAiBudget({ perOrg: 2, perTrial: 2, all: 100 }), verifyToken: fakeVerifier({ a: { userId: U, email: 'amy@a.com' } }) });
    const ask = () => app.inject({ method: 'POST', url: '/api/v1/chat', headers: { authorization: 'Bearer a' }, payload: { site_id: n.id, message: 'how do i open up the bar?' } });
    expect((await ask()).statusCode).toBe(200); expect((await ask()).statusCode).toBe(200);
    const blocked = await ask();
    expect(blocked.statusCode).toBe(429); expect(blocked.json().error.message).toContain('allowance'); expect(model.calls).toBe(2);
  });
});
