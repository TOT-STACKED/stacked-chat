import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { ChatModel, ChatTurn } from '../src/modules/chat/model.js';
import { FakeConversationStore } from '../src/testing/chat-fakes.js';
import { FakeCommsStore } from '../src/testing/comms-fakes.js';
import { FakeKnowledgeStore } from '../src/testing/knowledge-fakes.js';
import { FakeOpsStore } from '../src/testing/ops-fakes.js';
import { FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { FakeTrainingStore } from '../src/testing/training-fakes.js';
import { testConfig } from './helpers.js';

class FakeModel implements ChatModel {
  calls: Array<{ system: string; messages: ChatTurn[] }> = [];
  async complete(i: { system: string; messages: ChatTurn[] }) { this.calls.push(i); return 'Here is what is on today.'; }
}

describe('the chat knows what a person has to do today (wired through the app)', () => {
  it('lists their checklists, unread updates and training, and not other venues\' lists', async () => {
    const repo = new FakeRepo(); const model = new FakeModel(); const kstore = new FakeKnowledgeStore(); const ops = new FakeOpsStore();
    const org = repo.addOrg('Acme'); const north = repo.addSite(org, 'North'); const south = repo.addSite(org, 'South'); const uid = randomUUID(); const mid = randomUUID();
    kstore.addOrg(org.id, 'acme', 'acme'); kstore.sites.push({ id: north.id, org_id: org.id }, { id: south.id, org_id: org.id }); ops.addSite(org.id, north.id); ops.addSite(org.id, south.id);
    repo.addMember(org, 'amy@a.com', 'staff', north, uid); repo.addMember(org, 'boss@a.com', 'owner', null, mid);
    const app = await buildApp(testConfig, { repo, knowledgeStore: kstore, conversationStore: new FakeConversationStore(), chatModel: model, opsStore: ops, commsStore: new FakeCommsStore(), trainingStore: new FakeTrainingStore(),
      verifyToken: fakeVerifier({ a: { userId: uid, email: 'amy@a.com' }, o: { userId: mid, email: 'boss@a.com' } }) });
    const h = { authorization: 'Bearer o' };
    const post = (url: string, payload: object) => app.inject({ method: 'POST', url, headers: h, payload });
    await post(`/api/v1/orgs/${org.id}/checklists`, { title: 'Opening checklist', kind: 'opening', items: ['Unlock', 'Ovens on'], due_time: '09:00' });
    await post(`/api/v1/orgs/${org.id}/checklists`, { title: 'South only', kind: 'custom', site_id: south.id, items: ['Check the cellar'] });
    await post(`/api/v1/orgs/${org.id}/announcements`, { title: 'New menu', body: 'Starts Monday.' });
    await post(`/api/v1/orgs/${org.id}/training`, { title: 'Fire safety', lessons: [{ title: 'Exits', body: 'Know them.' }], quiz: [], pass_percent: 80 });
    const r = await app.inject({ method: 'POST', url: '/api/v1/chat', headers: { authorization: 'Bearer a' }, payload: { site_id: north.id, message: 'what do i need to do today?' } });
    expect(r.statusCode).toBe(200);
    const sys = model.calls.at(-1)!.system;
    expect(sys).toContain('Checklist "Opening checklist" (opening): not started, due by 09:00');
    expect(sys).toContain('Update "New menu": not read yet');
    expect(sys).toContain('Training "Fire safety": not done yet');
    expect(sys).not.toContain('South only');
  });
});
