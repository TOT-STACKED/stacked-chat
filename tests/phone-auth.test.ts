import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createTwilioSender } from '../src/lib/sms.js';
import { createSupabaseTokenVerifier } from '../src/lib/auth.js';
import { formatPhone, isPhoneKey, normalizePhone, phoneKey, phoneOfKey, userIdForPhone } from '../src/lib/phone.js';
import { createPhoneAuth } from '../src/modules/phone-auth/service.js';
import { FakeMailer, FakeRepo, fakeVerifier } from '../src/testing/fakes.js';
import { FakeCommsStore } from '../src/testing/comms-fakes.js';
import { FakePhoneCodeStore, FakeSms } from '../src/testing/phone-fakes.js';
import { testConfig } from './helpers.js';

const SECRET = 'x'.repeat(40);

describe('mobile numbers', () => {
  it('reads UK numbers however they are typed, and refuses things that are not numbers', () => {
    for (const t of ['07700 900123', '07700900123', '+44 7700 900123', '0044 7700 900123', '(07700) 900-123', '447700900123']) expect(normalizePhone(t), t).toBe('+447700900123');
    expect(normalizePhone('+353 87 123 4567')).toBe('+353871234567');
    for (const t of ['', 'hello', '12345', '0770090012', '07700 90012345', '+44 12']) expect(normalizePhone(t), t).toBeNull();
  });
  it('makes a placeholder address that can never receive mail, and turns it back into the number', () => {
    expect(phoneKey('+447700900123')).toBe('447700900123@phone.invalid');
    expect(isPhoneKey('447700900123@phone.invalid')).toBe(true); expect(isPhoneKey('amy@acme.com')).toBe(false); expect(isPhoneKey(null)).toBe(false);
    expect(phoneOfKey('447700900123@phone.invalid')).toBe('+447700900123');
    expect(formatPhone('+447700900123')).toBe('07700 900123');
  });
  it('gives the same number the same person id every time, and different numbers different ones', () => {
    expect(userIdForPhone('+447700900123')).toBe(userIdForPhone('+447700900123'));
    expect(userIdForPhone('+447700900123')).not.toBe(userIdForPhone('+447700900124'));
    expect(userIdForPhone('+447700900123')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('sends through Twilio with the right form, and reports a failure instead of throwing', async () => {
    let seen: { url: string; body: string; auth: string } | null = null;
    const ok = createTwilioSender({ accountSid: 'AC1', authToken: 'tok', from: 'StackedChat', fetchImpl: (async (url: string, init: { body: URLSearchParams; headers: Record<string, string> }) => { seen = { url, body: init.body.toString(), auth: init.headers.Authorization! }; return new Response('{}', { status: 201 }); }) as unknown as typeof fetch });
    expect(await ok.send('+447700900123', 'Hi')).toBe('sent');
    expect(seen!.url).toContain('/Accounts/AC1/Messages.json'); expect(seen!.body).toContain('From=StackedChat'); expect(seen!.body).toContain('To=%2B447700900123'); expect(seen!.auth).toMatch(/^Basic /);
    const svc = createTwilioSender({ accountSid: 'AC1', authToken: 'tok', from: 'MG' + 'a'.repeat(32), fetchImpl: (async (_u: string, init: { body: URLSearchParams }) => { seen = { url: '', body: init.body.toString(), auth: '' }; return new Response('{}', { status: 201 }); }) as unknown as typeof fetch });
    await svc.send('+447700900123', 'Hi'); expect(seen!.body).toContain('MessagingServiceSid=MG');
    expect(await createTwilioSender({ accountSid: 'a', authToken: 'b', from: 'c', fetchImpl: (async () => new Response('no', { status: 400 })) as unknown as typeof fetch }).send('+447700900123', 'x')).toBe('failed');
    expect(await createTwilioSender({ accountSid: 'a', authToken: 'b', from: 'c', fetchImpl: (async () => { throw new Error('down'); }) as unknown as typeof fetch }).send('+447700900123', 'x')).toBe('failed');
  });
  it('remembers why Twilio refused a text, without ever keeping the keys, and clears it after a good one', async () => {
    let ok = false; const logged: unknown[] = [];
    const tw = createTwilioSender({ accountSid: 'AC1', authToken: 'secret-token', from: 'StackedChat', log: (_m, i) => logged.push(i),
      fetchImpl: (async () => (ok ? new Response('{}', { status: 201 }) : new Response(JSON.stringify({ code: 21408, message: "Permission to send an SMS has not been enabled for the region indicated by the 'To' number" }), { status: 400 }))) as unknown as typeof fetch });
    expect(tw.lastError!()).toBeNull();
    expect(await tw.send('+447700900123', 'x')).toBe('failed');
    expect(tw.lastError!()).toMatchObject({ status: 400, code: 21408, message: expect.stringContaining('region') });
    expect(JSON.stringify([tw.lastError!(), logged])).not.toContain('secret-token');
    ok = true; expect(await tw.send('+447700900123', 'x')).toBe('sent'); expect(tw.lastError!()).toBeNull();
  });
  it('can ask Twilio whether the keys work without sending a text', async () => {
    const good = createTwilioSender({ accountSid: 'AC1', authToken: 't', from: 'x', fetchImpl: (async (u: string) => { expect(u).toMatch(/Accounts\/AC1\.json$/); return new Response(JSON.stringify({ status: 'active', type: 'Full' }), { status: 200 }); }) as unknown as typeof fetch });
    expect(await good.check!()).toMatchObject({ ok: true, detail: expect.stringContaining('active') });
    const bad = createTwilioSender({ accountSid: 'AC1', authToken: 'wrong', from: 'x', fetchImpl: (async () => new Response(JSON.stringify({ code: 20003, message: 'Authenticate' }), { status: 401 })) as unknown as typeof fetch });
    expect(await bad.check!()).toMatchObject({ ok: false, detail: expect.stringContaining('20003') });
  });
});

describe('signing in with a mobile number', () => {
  let repo: FakeRepo; let sms: FakeSms; let store: FakePhoneCodeStore; let t: Date; let pa: ReturnType<typeof createPhoneAuth>;
  const PHONE = '+447700900123';
  beforeEach(() => {
    repo = new FakeRepo(); sms = new FakeSms(); t = new Date('2026-03-10T10:00:00Z'); store = new FakePhoneCodeStore(() => t);
    const org = repo.addOrg('Acme'); const site = repo.addSite(org, 'North');
    void repo.createMember({ org_id: org.id, site_id: site.id, email: phoneKey(PHONE), display_name: 'Amy Smith', phone: PHONE, role: 'staff', status: 'invited' });
    pa = createPhoneAuth({ store, repo, sms, secret: SECRET, now: () => t });
  });
  const advance = (ms: number) => { t = new Date(t.getTime() + ms); };

  it('texts a code only to a number a manager has added, and says nothing different for anyone else', async () => {
    expect(await pa.start('07700 900123')).toEqual({ sent: true });
    expect(sms.sent).toHaveLength(1); expect(sms.sent[0]!.to).toBe(PHONE); expect(sms.lastCode(PHONE)).toMatch(/^\d{6}$/);
    expect(await pa.start('07700 900999')).toEqual({ sent: false }); // not on the system: no text, same answer
    expect(sms.sent).toHaveLength(1);
    await expect(pa.start('nonsense')).rejects.toMatchObject({ statusCode: 400 });
  });
  it('signs in with the right code, once, and the session names the person', async () => {
    await pa.start(PHONE); const code = sms.lastCode(PHONE)!;
    const s = await pa.verify(PHONE, code);
    expect(s.phone).toBe(PHONE); expect(s.expires_at).toBeGreaterThan(t.getTime() + 59 * 86_400_000);
    expect(pa.asVerifiedUser(s.access_token)).toEqual({ userId: userIdForPhone(PHONE), email: phoneKey(PHONE) });
    await expect(pa.verify(PHONE, code)).rejects.toMatchObject({ statusCode: 401 }); // a code works once
  });
  it('never stores the code itself', async () => {
    await pa.start(PHONE); const code = sms.lastCode(PHONE)!;
    expect(JSON.stringify(store.rows)).not.toContain(code);
  });
  it('rejects a wrong code, and locks the code after five wrong guesses even if the next one is right', async () => {
    await pa.start(PHONE); const code = sms.lastCode(PHONE)!; const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await expect(pa.verify(PHONE, wrong)).rejects.toMatchObject({ statusCode: 401 });
    await expect(pa.verify(PHONE, code)).rejects.toMatchObject({ statusCode: 401 });
  });
  it('lets a code expire after ten minutes', async () => {
    await pa.start(PHONE); const code = sms.lastCode(PHONE)!;
    advance(10 * 60_000 + 1000);
    await expect(pa.verify(PHONE, code)).rejects.toMatchObject({ statusCode: 401 });
  });
  it('only ever gives five guesses, even when thousands of requests arrive at the same instant', async () => {
    await pa.start(PHONE); const code = sms.lastCode(PHONE)!;
    const wrongs = Array.from({ length: 300 }, (_, i) => String(100000 + i)).filter((c) => c !== code);
    const attempts = [...wrongs.slice(0, 150), code, ...wrongs.slice(150)]; // the right code is buried in the flood
    const results = await Promise.allSettled(attempts.map((c) => pa.verify(PHONE, c)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(code === attempts[0] || attempts.indexOf(code) < 5 ? 1 : 0);
    expect(store.rows.find((r) => r.phone === PHONE)!.attempts).toBeLessThanOrEqual(5);
    await expect(pa.verify(PHONE, code)).rejects.toMatchObject({ statusCode: expect.any(Number) }); // and the real code no longer works either
  });
  it('refuses to text numbers outside the UK and Ireland, and numbers that cost the sender extra', async () => {
    const abroad = '+14155550100'; await repo.createMember({ org_id: [...repo.orgs][0]!.id, site_id: null, email: phoneKey(abroad), display_name: 'X', phone: abroad, role: 'staff', status: 'invited' }).catch(() => null);
    expect(await pa.start(abroad)).toEqual({ sent: false });
    for (const n of ['+447012345678', '+447612345678', '+448001234567', '+449012345678']) expect(await pa.start(n)).toEqual({ sent: false });
    expect(sms.sent).toHaveLength(0);
  });
  it('limits how many texts one number can be sent: one a minute, five an hour', async () => {
    await pa.start(PHONE);
    await expect(pa.start(PHONE)).rejects.toMatchObject({ statusCode: 429 });
    for (let i = 0; i < 4; i++) { advance(61_000); await pa.start(PHONE); }
    advance(61_000);
    await expect(pa.start(PHONE)).rejects.toMatchObject({ statusCode: 429 });
    expect(sms.sent).toHaveLength(5);
  });
  it('answers "too many" the same way for a number that is not on the system, so slowing down reveals nothing', async () => {
    const stranger = '07700 900999';
    expect(await pa.start(stranger)).toEqual({ sent: false });
    await expect(pa.start(stranger)).rejects.toMatchObject({ statusCode: 429 }); // same as a real number asked twice in a minute
    for (let i = 0; i < 4; i++) { advance(61_000); expect(await pa.start(stranger)).toEqual({ sent: false }); }
    advance(61_000);
    await expect(pa.start(stranger)).rejects.toMatchObject({ statusCode: 429 }); // and the same hourly wall
    expect(sms.sent).toHaveLength(0);
  });
  it('ends a session at a hard limit however often it is renewed', async () => {
    await pa.start(PHONE); let s = await pa.verify(PHONE, sms.lastCode(PHONE)!);
    for (let i = 0; i < 3; i++) { advance(50 * 86_400_000); const next = await pa.refresh(s.access_token); expect(next, `renewal ${i + 1}`).not.toBeNull(); s = next as typeof s; }
    advance(40 * 86_400_000); // 190 days after the first sign-in, past the 180-day cap
    expect(await pa.refresh(s.access_token)).toBeNull(); expect(pa.verifyToken(s.access_token)).toBeNull();
  });
  it('says so when the text could not be sent, and does not pretend it was', async () => {
    sms.fail = true; await expect(pa.start(PHONE)).rejects.toMatchObject({ statusCode: 502 });
  });
  it('refuses a token that was altered, signed with another secret, or has expired', async () => {
    await pa.start(PHONE); const s = await pa.verify(PHONE, sms.lastCode(PHONE)!);
    const [a, body, sig] = s.access_token.split('.');
    const forged = Buffer.from(JSON.stringify({ p: '+447700900999', exp: t.getTime() + 1e9 })).toString('base64url');
    expect(pa.verifyToken(`${a}.${forged}.${sig}`)).toBeNull();
    expect(createPhoneAuth({ store, repo, sms, secret: 'y'.repeat(40), now: () => t }).verifyToken(s.access_token)).toBeNull();
    expect(pa.verifyToken(`${a}.${body}.${sig}x`)).toBeNull(); expect(pa.verifyToken('garbage')).toBeNull();
    advance(61 * 86_400_000); expect(pa.verifyToken(s.access_token)).toBeNull();
  });
  it('refreshes a good session, but not for someone who has been switched off', async () => {
    await pa.start(PHONE); const s = await pa.verify(PHONE, sms.lastCode(PHONE)!);
    advance(40 * 86_400_000);
    const next = await pa.refresh(s.access_token); expect(next!.expires_at).toBeGreaterThan(s.expires_at);
    repo.members.forEach((m) => { m.status = 'disabled'; });
    expect(await pa.refresh(next!.access_token)).toBeNull();
  });
});

describe('phone sign-in and adding staff by number, through the app', () => {
  let app: FastifyInstance; let repo: FakeRepo; let sms: FakeSms; let mailer: FakeMailer; let org: ReturnType<FakeRepo['addOrg']>; let north: ReturnType<FakeRepo['addSite']>;
  const U = { owner: randomUUID(), mgr: randomUUID() };
  beforeEach(async () => {
    repo = new FakeRepo(); sms = new FakeSms(); mailer = new FakeMailer();
    org = repo.addOrg('Acme'); north = repo.addSite(org, 'North');
    repo.addMember(org, 'owner@acme.com', 'owner', null, U.owner); repo.addMember(org, 'mgr@acme.com', 'site_manager', north, U.mgr);
    app = await buildApp({ ...testConfig, AUTH_SECRET: SECRET }, { repo, sms, mailer, phoneCodeStore: new FakePhoneCodeStore(), commsStore: new FakeCommsStore(),
      verifyToken: fakeVerifier({ o: { userId: U.owner, email: 'owner@acme.com' }, m: { userId: U.mgr, email: 'mgr@acme.com' } }) });
  });
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, body?: object, tok?: string) => app.inject({ method, url, headers: tok ? { authorization: 'Bearer ' + tok } : {}, payload: body });
  const add = (tok: string, body: object) => call('POST', `/api/v1/orgs/${org.id}/members`, { role: 'staff', site_id: north.id, ...body }, tok);

  it('adds a person by mobile number, texts them, and shows their number', async () => {
    const r = await add('m', { phone: '07700 900123', display_name: 'Amy Smith' });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ phone: '+447700900123', display_name: 'Amy Smith', status: 'invited', invite: 'sent' });
    expect(sms.sent[0]!.to).toBe('+447700900123'); expect(sms.sent[0]!.text).toContain('Amy'); expect(sms.sent[0]!.text).toContain('/chat/');
    expect(mailer.sent).toHaveLength(0); // no email goes anywhere for a person with no email
    expect((await call('GET', `/api/v1/orgs/${org.id}/members`, undefined, 'o')).json().data.some((m: { phone: string | null }) => m.phone === '+447700900123')).toBe(true);
  });
  it('needs a name with a number, either an email or a number but not both, and a real number', async () => {
    expect((await add('m', { phone: '07700 900123' })).statusCode).toBe(400);
    expect((await add('m', { phone: '07700 900123', email: 'a@b.com', display_name: 'A' })).statusCode).toBe(400);
    expect((await add('m', { display_name: 'A' })).statusCode).toBe(400);
    expect((await add('m', { phone: '12345', display_name: 'A' })).statusCode).toBe(400);
    expect((await add('m', { email: 'a@acme.com' })).statusCode).toBe(201); // email still works for managers
  });
  it('will not add the same number twice at a venue', async () => {
    await add('m', { phone: '07700 900123', display_name: 'Amy' });
    expect((await add('m', { phone: '+44 7700 900123', display_name: 'Amy again' })).statusCode).toBe(409);
  });
  it('signs a new person in end to end: text a code, enter it, then act as that person', async () => {
    await add('m', { phone: '07700 900123', display_name: 'Amy Smith' }); sms.sent.length = 0;
    expect((await call('POST', '/api/v1/auth/phone/start', { phone: '07700 900123' })).statusCode).toBe(200);
    const code = sms.lastCode('+447700900123')!;
    expect((await call('POST', '/api/v1/auth/phone/verify', { phone: '07700 900123', code: code === '123456' ? '654321' : '123456' })).statusCode).toBe(401);
    const v = await call('POST', '/api/v1/auth/phone/verify', { phone: '07700 900123', code });
    expect(v.statusCode).toBe(200);
    const token = v.json().access_token as string;
    const ctx = await call('GET', '/api/v1/chat/context', undefined, token);
    expect(ctx.statusCode).toBe(200); expect(ctx.json().sites.map((s: { site_name: string }) => s.site_name)).toEqual(['North']);
    expect(repo.members.find((m) => m.phone === '+447700900123')!.status).toBe('active'); // the first sign-in activates the invitation
    expect((await call('POST', '/api/v1/auth/phone/refresh', undefined, token)).json().phone).toBe('+447700900123');
  });
  it('cuts a person off the moment a manager disables them, even with a valid session', async () => {
    await add('m', { phone: '07700 900123', display_name: 'Amy' }); sms.sent.length = 0;
    await call('POST', '/api/v1/auth/phone/start', { phone: '07700 900123' });
    const token = (await call('POST', '/api/v1/auth/phone/verify', { phone: '07700 900123', code: sms.lastCode('+447700900123')! })).json().access_token as string;
    const m = repo.members.find((x) => x.phone === '+447700900123')!;
    expect((await call('PATCH', `/api/v1/orgs/${org.id}/members/${m.id}`, { status: 'disabled' }, 'o')).statusCode).toBe(200);
    expect((await call('GET', '/api/v1/chat/context', undefined, token)).json().sites ?? []).toEqual([]);
    expect((await call('POST', '/api/v1/auth/phone/refresh', undefined, token)).statusCode).toBe(401);
    sms.sent.length = 0; await call('POST', '/api/v1/auth/phone/start', { phone: '07700 900123' }); // and no more codes
    expect(sms.sent).toHaveLength(0);
  });
  it('sends no text to a number nobody added, and reveals nothing about who is on the system', async () => {
    const r = await call('POST', '/api/v1/auth/phone/start', { phone: '07700 900555' });
    expect(r.statusCode).toBe(200); expect(r.json()).toEqual({ ok: true }); expect(sms.sent).toHaveLength(0);
  });
  it('tells the sign-in pages whether mobile sign-in is on, so they only offer it when it works', async () => {
    for (const url of ['/chat/config.json', '/manage/config.json']) expect((await call('GET', url)).json().phone).toBe(true);
    const off = await buildApp(testConfig, { repo, sms: null, verifyToken: fakeVerifier({}) });
    for (const url of ['/chat/config.json', '/manage/config.json']) expect((await off.inject({ method: 'GET', url })).json().phone).toBe(false);
  });
  it('caps invitation texts per person so a free trial cannot be used to spam numbers on our bill', async () => {
    let last = 0;
    for (let i = 0; i < 32; i++) { const r = await add('o', { phone: `07700 9${String(10000 + i).padStart(5, '0')}`, display_name: `P${i}` }); last = r.statusCode; if (r.statusCode === 429) break; expect(r.statusCode).toBe(201); }
    expect(last).toBe(429); expect(sms.sent.length).toBe(30);
  });
  it('will not add a number that cannot be texted, or one abroad', async () => {
    for (const phone of ['+1 415 555 0100', '0901 234 5678', '07012 345678']) expect((await add('m', { phone, display_name: 'A' })).statusCode, phone).toBe(400);
    expect((await add('m', { phone: '087 123 4567', display_name: 'Irish' })).statusCode).toBe(400); // Irish numbers need their +353 code
    expect((await add('m', { phone: '+353 87 123 4567', display_name: 'Irish' })).statusCode).toBe(201);
  });
  it('never makes someone active by hand: restoring a person who has not signed in puts them back to invited', async () => {
    const created = (await add('m', { phone: '07700 900123', display_name: 'Amy' })).json();
    await call('PATCH', `/api/v1/orgs/${org.id}/members/${created.id}`, { status: 'disabled' }, 'o');
    const back = await call('PATCH', `/api/v1/orgs/${org.id}/members/${created.id}`, { status: 'active' }, 'o');
    expect(back.statusCode).toBe(200); expect(back.json().status).toBe('invited');
    const e = (await add('m', { email: 'ben@acme.com', display_name: 'Ben' })).json();
    expect((await call('PATCH', `/api/v1/orgs/${org.id}/members/${e.id}`, { status: 'active' }, 'o')).json().status).toBe('invited'); // an unverified address cannot be marked active
  });
  it('keeps web addresses out of company, venue and team names, which appear in messages sent from our address', async () => {
    for (const name of ['Claim your refund at evil.example.com', 'Visit www.evil.co', 'http://x.y/z']) {
      expect((await call('PATCH', `/api/v1/orgs/${org.id}`, { name }, 'o')).statusCode, name).toBe(400);
    }
    expect((await call('PATCH', `/api/v1/orgs/${org.id}`, { name: 'Acme Pubs Ltd' }, 'o')).statusCode).toBe(200);
  });
  it('is off, saying so, when texts or the secret are not set up', async () => {
    const off = await buildApp(testConfig, { repo, sms: null, verifyToken: fakeVerifier({}) });
    expect((await off.inject({ method: 'POST', url: '/api/v1/auth/phone/start', payload: { phone: '07700 900123' } })).statusCode).toBe(503);
  });
  it('quietly skips email to anyone who signs in by number, and still emails everyone else', async () => {
    await add('m', { phone: '07700 900123', display_name: 'Amy' }); await add('m', { email: 'ben@acme.com', display_name: 'Ben' });
    repo.members.filter((m) => m.org_id === org.id && m.status === 'invited').forEach((m) => { m.status = 'active'; }); mailer.sent.length = 0;
    const r = await call('POST', `/api/v1/orgs/${org.id}/announcements`, { title: 'Menu', body: 'New menu from Monday.', site_id: north.id, email: true }, 'o');
    expect(r.statusCode).toBe(201);
    const to = mailer.sent.map((m) => m.to);
    expect(to).toContain('ben@acme.com'); expect(to.some((a) => a.endsWith('@phone.invalid'))).toBe(false);
  });
});

describe('sign-in through the email path', () => {
  it('never accepts the placeholder address that stands for a phone number', async () => {
    const mk = (email: string) => createSupabaseTokenVerifier({ url: 'https://x.supabase.co', anonKey: 'k', fetchImpl: (async () => new Response(JSON.stringify({ id: randomUUID(), email, email_confirmed_at: '2026-01-01T00:00:00Z' }), { status: 200 })) as unknown as typeof fetch });
    expect(await mk('447700900123@phone.invalid')('tok1')).toBeNull();
    expect(await mk('amy@acme.com')('tok2')).toMatchObject({ email: 'amy@acme.com' });
  });
});
