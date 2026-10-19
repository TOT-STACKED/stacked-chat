import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createChat, type Who } from '../src/modules/chat/service.js';
import { checkNps, createPortalMirror, safeText, type NpsRow, type NpsStore } from '../src/modules/chat/nps.js';
import { buildSystemPrompt } from '../src/modules/chat/prompt.js';
import { mentions, pickProfiles, supportLink, takeNpsTag, vendorAnswerToRatingQuestion, vendorFromPerson } from '../src/modules/vendors/detect.js';
import { PROFILES, SUPPORT_URLS, TECH_CATEGORIES, VENDOR_NAMES } from '../src/modules/vendors/index.js';
import type { TechStackStore } from '../src/modules/vendors/store.js';
import { FakeConversationStore } from '../src/testing/chat-fakes.js';
import { FakeKnowledgeStore } from '../src/testing/knowledge-fakes.js';
import { FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { testConfig } from './helpers.js';

describe('the vendor playbook data', () => {
  it('came across whole: detailed profiles, support links and vendor names', () => {
    expect(Object.keys(PROFILES).length).toBeGreaterThanOrEqual(25);
    expect(PROFILES['lightspeed']).toContain('LIGHTSPEED RESTAURANT');
    expect(Object.keys(SUPPORT_URLS).length).toBeGreaterThan(100);
    expect(VENDOR_NAMES).toEqual(expect.arrayContaining(['Lightspeed', 'Dojo', 'Deputy']));
  });
  it('every support link is a plain https address', () => {
    for (const [k, u] of Object.entries(SUPPORT_URLS)) expect(u, k).toMatch(/^https:\/\/[^\s"'<>]+$/);
  });
  it('profiles are non-empty text and keyed in lower case', () => {
    for (const [k, v] of Object.entries(PROFILES)) { expect(k, k).toBe(k.toLowerCase()); expect(v.length, k).toBeGreaterThan(200); }
  });
});

describe('spotting vendors', () => {
  it('matches whole words only, and our own name "Tech on Toast" is not the Toast till', () => {
    expect(mentions('my toast till is down', 'toast')).toBe(true);
    expect(mentions('the toaster broke', 'toast')).toBe(false);
    expect(pickProfiles('join tech on toast tonight', [], null)).not.toContain('toast');
  });
  it('prefers the current message, then recent person messages, then the venue tech stack; never more than two', () => {
    expect(pickProfiles('my lightspeed till is offline', [], { epos: 'Square' })).toEqual(['lightspeed']);
    const hist = [{ role: 'user' as const, content: 'our square reader will not connect' }, { role: 'assistant' as const, content: 'Try restarting it.' }];
    expect(pickProfiles('it still does not work', hist, null)).toEqual(['square']);
    expect(pickProfiles('the till is frozen', [], { epos: 'Lightspeed Restaurant' })).toEqual(['lightspeed']);
    expect(pickProfiles('lightspeed square dojo worldpay', [], null).length).toBeLessThanOrEqual(2);
    expect(pickProfiles('what time do we open', [], null)).toEqual([]);
  });
  it('a vendor for ratings comes from the PERSON, never from what the assistant mentioned', () => {
    const hist = [{ role: 'assistant' as const, content: 'Have you tried Stampede for guest wifi?' }];
    expect(vendorFromPerson('tell me about sky wifi', hist)).toBeNull();
    expect(vendorFromPerson('I use Deputy for rotas', hist)).toBe('deputy');
  });
  it('after the assistant asks "which vendor?", a short answer is the vendor, but only a safe one', () => {
    const asked = [{ role: 'assistant' as const, content: 'Sure! Which vendor would you like to rate?' }];
    expect(vendorAnswerToRatingQuestion('Sky', asked)).toBe('sky');
    expect(vendorAnswerToRatingQuestion('the Tenzo.', asked)).toBe('tenzo');
    expect(vendorAnswerToRatingQuestion('<script>alert(1)</script>', asked)).toBeNull();
    expect(vendorAnswerToRatingQuestion('one two three four five six seven', asked)).toBeNull();
    expect(vendorAnswerToRatingQuestion('Sky', [{ role: 'assistant' as const, content: 'Breaks are 20 minutes.' }])).toBeNull();
  });
  it('shows a support link only for genuine tech help', () => {
    expect(supportLink('my lightspeed till keeps freezing', null)).toEqual({ vendor: 'lightspeed', url: SUPPORT_URLS['lightspeed'] });
    expect(supportLink('who uses lightspeed here', null)).toBeNull(); // a mention is not a request for help
    expect(supportLink('card machine is not working', { payments: 'Dojo' })?.vendor).toBe('dojo'); // venue stack tells us which
    expect(supportLink('tech on toast event is not working for me', null)).toBeNull();
  });
  it('reads and removes an [NPS:vendor] tag', () => {
    expect(takeNpsTag('Great, rating Sky now.\n[NPS:Sky]')).toEqual({ reply: 'Great, rating Sky now.', vendor: 'sky' });
    expect(takeNpsTag('No tag here')).toEqual({ reply: 'No tag here', vendor: null });
    expect(takeNpsTag('x [NPS:<b>bad</b>]').vendor).toBeNull();
  });
});

describe('the prompt', () => {
  const base = { botName: 'Nora', orgName: 'Acme', siteName: 'North', personName: 'Amy', passages: [], hasVideo: false, hasImage: false };
  it('carries vendor notes and the venue tech stack only when there are some', () => {
    const none = buildSystemPrompt(base);
    expect(none).not.toContain('STACKED VENDOR SUPPORT NOTES (maintained'); expect(none).not.toContain("THIS VENUE'S TECH STACK");
    const withIt = buildSystemPrompt({ ...base, vendorNotes: ['LIGHTSPEED RESTAURANT notes'], techStack: { epos: 'Lightspeed' }, techCategories: TECH_CATEGORIES });
    expect(withIt).toContain('LIGHTSPEED RESTAURANT notes'); expect(withIt).toContain('- EPOS / till: Lightspeed'); expect(withIt).toContain('do NOT ask which system');
  });
  it('keeps the rules that matter: no web addresses, ratings only when asked, allergens strict', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('do not write any web address'); expect(p).toContain('[NPS:vendorname]'); expect(p).toContain('ALLERGENS ARE SAFETY-CRITICAL'); expect(p).toContain('never because a vendor was merely mentioned');
  });
});

describe('ratings', () => {
  it('checks and cleans a rating', () => {
    expect(checkNps({ vendor: ' Sky ', score: 9, comment: ' great ' })).toEqual({ vendor: 'Sky', score: 9, comment: 'great' });
    expect(checkNps({ vendor: 'Sky', score: 9, comment: '' }).comment).toBeNull();
    for (const score of [-1, 11, 4.5, NaN]) expect(() => checkNps({ vendor: 'Sky', score })).toThrow();
    expect(() => checkNps({ vendor: '  ', score: 5 })).toThrow();
    expect(safeText('<img src=x onerror=alert(1)>', 100)).not.toMatch(/[<>]/);
    expect(safeText('a\u0000b', 10)).toBe('ab');
  });
  it('copies to the partner portal in its own format, and never throws', async () => {
    let sent: { url: string; body: any; headers: Record<string, string> } | null = null;
    const m = createPortalMirror({ url: 'https://portal.example/', key: 'k', fetchImpl: (async (u: string, i: RequestInit) => { sent = { url: u, body: JSON.parse(String(i.body)), headers: i.headers as Record<string, string> }; return { ok: true } as Response; }) as unknown as typeof fetch });
    await m({ vendor: 'sky', score: 8, comment: null, venue_id: 'v1', venue: 'North', respondent: 'Amy' });
    expect(sent!.url).toBe('https://portal.example/rest/v1/nps_scores');
    expect(sent!.body).toMatchObject({ source: 'stacked-chat', touchpoint: 'vendor-chat', vendor: 'sky', score: 8, company: 'North', respondent_name: 'Amy', venue_id: 'v1' });
    await expect(createPortalMirror({ url: 'https://x', key: 'k', fetchImpl: (async () => { throw new Error('down'); }) as unknown as typeof fetch })({ vendor: 'a', score: 1, comment: null, venue_id: 'v', venue: 'V', respondent: null })).resolves.toBeUndefined();
  });
});

describe('the chat uses the playbook', () => {
  let convs: FakeConversationStore; let systems: string[]; let reply: string; let saved: NpsRow[]; let mirrored: NpsRow[];
  const who = (o: Partial<Who> = {}): Who => ({ email: 'amy@a.com', name: 'Amy', orgId: 'o', orgName: 'Acme', siteId: 's1', siteName: 'North', teamIds: [], botName: null, techStack: null, ...o });
  const chat = () => createChat({
    items: async () => [], conversations: convs, model: { complete: async (i) => { systems.push(i.system); return reply; } },
    nps: { save: async (r) => { saved.push(r); } } as NpsStore, mirrorNps: async (r) => { mirrored.push(r); },
  });
  beforeEach(() => { convs = new FakeConversationStore(); systems = []; reply = '**Restart the app.**\n1. Close it\n2. Reopen it'; saved = []; mirrored = []; });

  it('gives the model the right vendor notes and returns the vendor support link', async () => {
    const r = await chat().ask(who(), { message: 'my lightspeed till is offline' });
    expect(systems[0]).toContain('LIGHTSPEED RESTAURANT');
    expect(r.support).toEqual({ vendor: 'lightspeed', url: SUPPORT_URLS['lightspeed'] });
    expect(r.unanswered).toBe(false);
  });
  it("uses the venue's recorded tech stack so it never has to ask", async () => {
    const r = await chat().ask(who({ techStack: { epos: 'Square' } }), { message: 'the till is frozen' });
    expect(systems[0]).toContain('- EPOS / till: Square'); expect(systems[0]).toContain('SQUARE FOR RESTAURANTS'); expect(r.support?.vendor).toBe('square');
  });
  it('no vendor, no vendor notes, no support link, no rating prompt', async () => {
    const r = await chat().ask(who(), { message: 'what time do we open?' });
    expect(systems[0]).not.toContain('STACKED VENDOR SUPPORT NOTES (maintained'); expect(r.support).toBeNull(); expect(r.nps).toBeNull();
  });
  it('a rating request: the tag is removed from the reply and the card is forced', async () => {
    reply = 'Great, rating Sky now.\n[NPS:sky]';
    const r = await chat().ask(who(), { message: 'can I rate sky?' });
    expect(r.reply).toBe('Great, rating Sky now.'); expect(r.nps).toEqual({ vendor: 'sky', forced: true });
  });
  it('a vendor the person talks about is offered a rating (not forced); one the assistant only mentioned is not', async () => {
    expect((await chat().ask(who(), { message: 'how do I fix the dojo terminal' })).nps).toEqual({ vendor: 'dojo', forced: false });
    reply = 'You could try Stampede for guest wifi.';
    expect((await chat().ask(who(), { message: 'guest wifi keeps dropping at the bar' })).nps).toBeNull();
  });
  it('a stray rating tag on an unrelated question is ignored, and a product named earlier does not trigger a card later', async () => {
    reply = 'Here are the steps.\n[NPS:lightspeed]';
    expect((await chat().ask(who(), { message: 'how do I make a margarita?' })).nps).toBeNull();
    reply = 'Here are the steps.';
    const c = chat();
    await c.ask(who(), { message: 'how do I fix the dojo terminal' });
    const later = await c.ask(who(), { message: 'have you got a picture of the margarita serve', conversation_id: undefined });
    expect(later.nps).toBeNull();
  });
  it('saves a rating with the venue and person, copies it to the portal, and refuses when switched off', async () => {
    await chat().rate(who(), { vendor: 'Sky', score: 8, comment: 'solid' });
    await new Promise((r) => setTimeout(r, 5));
    expect(saved[0]).toEqual({ vendor: 'Sky', score: 8, comment: 'solid', venue_id: 's1', venue: 'North', respondent: 'Amy' });
    expect(mirrored).toHaveLength(1);
    await expect(createChat({ items: async () => [], conversations: convs, model: null }).rate(who(), { vendor: 'x', score: 5 })).rejects.toMatchObject({ statusCode: 503 });
    await expect(chat().rate(who(), { vendor: 'Sky', score: 99 })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('tech stack and ratings API', () => {
  let app: FastifyInstance; let repo: FakeRepo; let stacks: Map<string, Record<string, string>>; let saved: NpsRow[];
  const U = { owner: randomUUID(), mgr: randomUUID(), staff: randomUUID(), other: randomUUID() };
  let org: ReturnType<FakeRepo['addOrg']>; let n: ReturnType<FakeRepo['addSite']>; let s: ReturnType<FakeRepo['addSite']>;
  beforeEach(async () => {
    repo = new FakeRepo(); stacks = new Map(); saved = [];
    org = repo.addOrg('Acme'); n = repo.addSite(org, 'North'); s = repo.addSite(org, 'South');
    repo.addMember(org, 'owner@a.com', 'owner', null, U.owner); repo.addMember(org, 'mgr@a.com', 'site_manager', n, U.mgr); repo.addMember(org, 'amy@a.com', 'staff', n, U.staff);
    const kstore = new FakeKnowledgeStore(); kstore.addOrg(org.id, 'acme', 'acme');
    const techStackStore: TechStackStore = {
      get: async (id) => stacks.get(id) ?? {}, list: async () => repo.sites.map((x) => ({ id: x.id, name: x.name, stack: stacks.get(x.id) ?? {} })),
      set: async (id, st) => { stacks.set(id, st); return st; },
    };
    app = await buildApp(testConfig, { repo, knowledgeStore: kstore, techStackStore, conversationStore: new FakeConversationStore(), npsStore: { save: async (r) => { saved.push(r); } }, mirrorNps: null,
      chatModel: { complete: async () => 'ok' },
      verifyToken: fakeVerifier({ o: { userId: U.owner, email: 'owner@a.com' }, m: { userId: U.mgr, email: 'mgr@a.com' }, s: { userId: U.staff, email: 'amy@a.com' }, x: { userId: U.other, email: 'x@a.com' } }) });
  });
  const call = (method: 'GET' | 'PATCH' | 'POST', url: string, t: string, body?: object) => app.inject({ method, url, headers: { authorization: 'Bearer ' + t }, payload: body });
  const T = () => `/api/v1/orgs/${org.id}/tech-stack`;

  it('admins record each venue\'s systems from a fixed set of categories', async () => {
    const r = await call('PATCH', `/api/v1/orgs/${org.id}/sites/${n.id}/tech-stack`, 'o', { stack: { epos: 'Lightspeed', payments: 'Dojo', wifi: '' } });
    expect(r.json().stack).toEqual({ epos: 'Lightspeed', payments: 'Dojo' }); // an empty value clears it
    const list = (await call('GET', T(), 'o')).json();
    expect(list.categories.map((c: any) => c.key)).toContain('epos'); expect(list.sites.find((x: any) => x.id === n.id).stack.epos).toBe('Lightspeed');
  });
  it('refuses non-admins, unknown categories, markup, and other companies\' venues', async () => {
    expect((await call('GET', T(), 'm')).statusCode).toBe(403);
    expect((await call('PATCH', `/api/v1/orgs/${org.id}/sites/${n.id}/tech-stack`, 'm', { stack: { epos: 'x' } })).statusCode).toBe(403);
    for (const stack of [{ nonsense: 'x' }, { epos: '<script>alert(1)</script>' }, { epos: 'x'.repeat(61) }]) expect((await call('PATCH', `/api/v1/orgs/${org.id}/sites/${n.id}/tech-stack`, 'o', { stack })).statusCode, JSON.stringify(stack)).toBe(400);
    const foreign = repo.addSite(repo.addOrg('Other'), 'Theirs');
    expect((await call('PATCH', `/api/v1/orgs/${org.id}/sites/${foreign.id}/tech-stack`, 'o', { stack: { epos: 'x' } })).statusCode).toBeGreaterThanOrEqual(400);
    expect(stacks.size).toBe(0);
  });
  it('staff rate a vendor at their own venue only; scores are 0 to 10', async () => {
    expect((await call('POST', '/api/v1/chat/nps', 's', { site_id: n.id, vendor: 'Sky', score: 9, comment: 'good' })).statusCode).toBe(200);
    expect(saved[0]).toMatchObject({ vendor: 'Sky', score: 9, venue: 'North', respondent: 'Amy' });
    expect((await call('POST', '/api/v1/chat/nps', 's', { site_id: s.id, vendor: 'Sky', score: 9 })).statusCode).toBe(403);
    expect((await call('POST', '/api/v1/chat/nps', 'x', { site_id: n.id, vendor: 'Sky', score: 9 })).statusCode).toBe(403);
    for (const score of [11, -1, 3.5]) expect((await call('POST', '/api/v1/chat/nps', 's', { site_id: n.id, vendor: 'Sky', score })).statusCode, String(score)).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/chat/nps', payload: { site_id: n.id, vendor: 'Sky', score: 5 } })).statusCode).toBe(401);
  });
  it('the chat reads the venue tech stack when answering', async () => {
    const seen: string[] = [];
    const k2 = new FakeKnowledgeStore(); k2.addOrg(org.id, 'acme', 'acme');
    const a2 = await buildApp(testConfig, { repo, knowledgeStore: k2, techStackStore: { get: async () => ({ epos: 'Tevalis' }), list: async () => [], set: async (_i, st) => st }, conversationStore: new FakeConversationStore(),
      chatModel: { complete: async (i) => { seen.push(i.system); return 'ok'; } }, verifyToken: fakeVerifier({ s: { userId: U.staff, email: 'amy@a.com' } }) });
    const r = await a2.inject({ method: 'POST', url: '/api/v1/chat', headers: { authorization: 'Bearer s' }, payload: { site_id: n.id, message: 'the till is frozen' } });
    expect(r.statusCode).toBe(200); expect(seen[0]).toContain('- EPOS / till: Tevalis'); expect(r.json().support?.vendor).toBe('tevalis');
  });
});
