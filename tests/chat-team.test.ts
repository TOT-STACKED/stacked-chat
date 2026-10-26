import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { ChatModel, ChatTurn } from '../src/modules/chat/model.js';
import { wantsTeam } from '../src/modules/chat/team.js';
import { FakeConversationStore } from '../src/testing/chat-fakes.js';
import { FakeCommsStore } from '../src/testing/comms-fakes.js';
import { FakeKnowledgeStore } from '../src/testing/knowledge-fakes.js';
import { FakeOpsStore } from '../src/testing/ops-fakes.js';
import { FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { FakeTrainingStore } from '../src/testing/training-fakes.js';
import { testConfig } from './helpers.js';

class FakeModel implements ChatModel {
  calls: Array<{ system: string; messages: ChatTurn[] }> = [];
  async complete(i: { system: string; messages: ChatTurn[] }) { this.calls.push(i); return 'ok'; }
}

describe('when a manager asks about their team', () => {
  it('only treats questions about people and training, updates or checklists that way', () => {
    for (const q of ["who hasn't done fire training?", 'who has not read the new menu update', 'how many people have finished food hygiene', 'has everyone ticked the opening checklist', 'is my team behind on allergen training'])
      expect(wantsTeam(q), q).toBe(true);
    for (const q of ['who do i call about a delivery problem', 'where is the fire assembly point', 'what do i need to do today', 'how do i restart the till'])
      expect(wantsTeam(q), q).toBe(false);
  });

  let app: FastifyInstance; let model: FakeModel; let org: ReturnType<FakeRepo['addOrg']>; let north: ReturnType<FakeRepo['addSite']>; let south: ReturnType<FakeRepo['addSite']>;
  const U = { owner: randomUUID(), nm: randomUUID(), amy: randomUUID(), ben: randomUUID(), cat: randomUUID() };
  beforeEach(async () => {
    const repo = new FakeRepo(); model = new FakeModel(); const kstore = new FakeKnowledgeStore(); const ops = new FakeOpsStore();
    org = repo.addOrg('Acme'); north = repo.addSite(org, 'North'); south = repo.addSite(org, 'South');
    kstore.addOrg(org.id, 'acme', 'acme'); kstore.sites.push({ id: north.id, org_id: org.id }, { id: south.id, org_id: org.id }); ops.addSite(org.id, north.id); ops.addSite(org.id, south.id);
    repo.addMember(org, 'boss@a.com', 'owner', null, U.owner); repo.addMember(org, 'nina@a.com', 'site_manager', north, U.nm);
    repo.addMember(org, 'amy@a.com', 'staff', north, U.amy); repo.addMember(org, 'ben@a.com', 'staff', north, U.ben); repo.addMember(org, 'cat@a.com', 'staff', south, U.cat);
    app = await buildApp(testConfig, { repo, knowledgeStore: kstore, conversationStore: new FakeConversationStore(), chatModel: model, opsStore: ops, commsStore: new FakeCommsStore(), trainingStore: new FakeTrainingStore(),
      verifyToken: fakeVerifier({ o: { userId: U.owner, email: 'boss@a.com' }, n: { userId: U.nm, email: 'nina@a.com' }, a: { userId: U.amy, email: 'amy@a.com' }, b: { userId: U.ben, email: 'ben@a.com' }, c: { userId: U.cat, email: 'cat@a.com' } }) });
    const post = (url: string, payload: object) => app.inject({ method: 'POST', url, headers: { authorization: 'Bearer o' }, payload });
    const course = (await post(`/api/v1/orgs/${org.id}/training`, { title: 'Fire safety', lessons: [{ title: 'Exits', body: 'Know them.' }], quiz: [], pass_percent: 80 })).json();
    await post(`/api/v1/orgs/${org.id}/announcements`, { title: 'New menu', body: 'Starts Monday.' });
    await post(`/api/v1/orgs/${org.id}/checklists`, { title: 'Opening checklist', kind: 'opening', items: ['Unlock', 'Ovens on'] });
    // Ben has taken the course and read nothing else; Amy has done nothing
    await app.inject({ method: 'POST', url: `/api/v1/chat/training/${course.id}/complete`, headers: { authorization: 'Bearer b' }, payload: { site_id: north.id, confirm: true } });
  });
  const ask = async (tok: string, siteId: string, message: string) => { await app.inject({ method: 'POST', url: '/api/v1/chat', headers: { authorization: 'Bearer ' + tok }, payload: { site_id: siteId, message } }); return model.calls.at(-1)!.system; };

  it('tells a site manager who at their own venue has not done a course, and nobody from another venue', async () => {
    const sys = await ask('n', north.id, "who hasn't done fire training?");
    expect(sys).toContain('Course "Fire safety": 1 of 3 done. Not done yet: amy, nina\n'); // the manager is a person at the venue too
    expect(sys).not.toContain('cat@'); expect(sys).not.toContain('(South)'); expect(sys).not.toContain('boss');
  });
  it('covers unread updates and today\'s checklists too', async () => {
    const sys = await ask('n', north.id, 'who has not read the new menu update, and has the opening checklist been done?');
    expect(sys).toContain('Update "New menu": 0 of 3 have read it. Not read: amy, ben, nina\n');
    expect(sys).toContain('Checklist "Opening checklist" today: not started');
  });
  it('shows a company admin every venue, with where each person works', async () => {
    const sys = await ask('o', north.id, "who hasn't done fire training?");
    expect(sys).toContain('1 of 4 done'); expect(sys).toContain('amy (North)'); expect(sys).toContain('cat (South)'); expect(sys).not.toContain('boss');
    expect(sys).toContain('Checklist "Opening checklist" at North today'); expect(sys).toContain('Checklist "Opening checklist" at South today');
  });
  it('gives staff nothing about anyone else, and a manager nothing for an ordinary question', async () => {
    expect(await ask('a', north.id, "who hasn't done fire training?")).not.toContain("HOW THIS MANAGER'S TEAM");
    expect(await ask('n', north.id, 'how do i restart the till')).not.toContain("HOW THIS MANAGER'S TEAM");
  });
});
