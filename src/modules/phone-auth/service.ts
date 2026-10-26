import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { ApiHttpError } from '../../lib/errors.js';
import type { VerifiedUser } from '../../lib/auth.js';
import { normalizePhone, phoneKey, userIdForPhone } from '../../lib/phone.js';
import type { Repo } from '../../lib/repo.js';
import type { SmsSender } from '../../lib/sms.js';
import type { PhoneCodeStore } from './store.js';

export const CODE_MINUTES = 10;
export const MAX_ATTEMPTS = 5;
/** A signed-in phone stays signed in this long. Anyone who is switched off in Manage loses access at once, whatever this says. */
export const SESSION_DAYS = 60;
export const REFRESH_AFTER_DAYS = 30;
const PREFIX = 'st1';

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/**
 * Sign in with a mobile number: a 6-digit code by text, then a signed session token (no password, no email).
 *  - A text is only ever sent to a number a manager has added, so nobody can use this to text strangers or run up the bill.
 *  - Codes are kept only as keyed hashes, last 10 minutes and die after 5 wrong guesses.
 *  - The session token is signed with AUTH_SECRET. It names the person, not their permissions: those are looked up on every request.
 */
export function createPhoneAuth(deps: { store: PhoneCodeStore; repo: Repo; sms: SmsSender | null; secret: string; now?: () => Date; brand?: string }) {
  const now = deps.now ?? (() => new Date());
  const sign = (body: string) => createHmac('sha256', deps.secret).update(body).digest('base64url');
  const hashCode = (phone: string, code: string) => createHmac('sha256', deps.secret).update(`code:${phone}:${code}`).digest('hex');
  const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

  function issue(phone: string): { access_token: string; expires_at: number } {
    const exp = now().getTime() + SESSION_DAYS * 86_400_000;
    const body = b64(JSON.stringify({ p: phone, exp }));
    return { access_token: `${PREFIX}.${body}.${sign(body)}`, expires_at: exp };
  }

  /** Who a token belongs to, or null if it is not one of ours, has been altered, or has expired. */
  function verifyToken(token: string): { phone: string; expires_at: number } | null {
    const [pre, body, sig] = token.split('.');
    if (pre !== PREFIX || !body || !sig || !same(sig, sign(body))) return null;
    try {
      const j = JSON.parse(Buffer.from(body, 'base64url').toString()) as { p?: string; exp?: number };
      if (!j.p || !j.exp || j.exp <= now().getTime() || normalizePhone(j.p) !== j.p) return null;
      return { phone: j.p, expires_at: j.exp };
    } catch { return null; }
  }

  async function start(rawPhone: string): Promise<{ sent: boolean }> {
    if (!deps.sms) throw new ApiHttpError(503, 'phone_signin_unavailable', 'Signing in by mobile number is not switched on yet');
    const phone = normalizePhone(rawPhone);
    if (!phone) throw new ApiHttpError(400, 'bad_phone', 'Enter your mobile number, for example 07700 900123');
    // Only numbers a manager has added get a text. The answer is the same either way, so nobody can find out who is on the system.
    if (!(await deps.repo.memberLoginable(phoneKey(phone)))) return { sent: false };
    const t = now();
    if ((await deps.store.countSince(phone, new Date(t.getTime() - 60_000).toISOString())) >= 1) throw new ApiHttpError(429, 'rate_limited', 'A code was only just sent. Wait a minute, then ask for another.');
    if ((await deps.store.countSince(phone, new Date(t.getTime() - 3_600_000).toISOString())) >= 5) throw new ApiHttpError(429, 'rate_limited', 'Too many codes for this number. Try again in an hour.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await deps.store.insert({ phone, code_hash: hashCode(phone, code), expires_at: new Date(t.getTime() + CODE_MINUTES * 60_000).toISOString() });
    const res = await deps.sms.send(phone, `${code} is your ${deps.brand ?? 'Stacked Chat'} sign-in code. It expires in ${CODE_MINUTES} minutes. Never share it.`);
    if (res !== 'sent') throw new ApiHttpError(502, 'sms_failed', 'We could not send the text just now. Please try again.');
    return { sent: true };
  }

  async function verify(rawPhone: string, rawCode: string): Promise<{ access_token: string; expires_at: number; phone: string }> {
    const bad = () => new ApiHttpError(401, 'bad_code', "That code didn't work. Check it, or ask for a new one.");
    const phone = normalizePhone(rawPhone); const code = String(rawCode ?? '').replace(/\s+/g, '');
    if (!phone || !/^\d{6}$/.test(code)) throw bad();
    const row = await deps.store.latest(phone);
    if (!row || row.attempts >= MAX_ATTEMPTS || new Date(row.expires_at).getTime() <= now().getTime()) throw bad();
    if (!same(row.code_hash, hashCode(phone, code))) { await deps.store.bump(row.id); throw bad(); }
    await deps.store.clear(phone);
    return { ...issue(phone), phone };
  }

  /** A fresh token for a still-valid one, so a phone in regular use never has to sign in again. */
  async function refresh(token: string): Promise<{ access_token: string; expires_at: number; phone: string } | null> {
    const v = verifyToken(token); if (!v) return null;
    if (!(await deps.repo.memberLoginable(phoneKey(v.phone)))) return null;
    return { ...issue(v.phone), phone: v.phone };
  }

  /** For the app's token check: a token of ours becomes the person it names. */
  function asVerifiedUser(token: string): VerifiedUser | null {
    const v = verifyToken(token); return v ? { userId: userIdForPhone(v.phone), email: phoneKey(v.phone) } : null;
  }

  return { start, verify, refresh, verifyToken, asVerifiedUser, issue };
}
export type PhoneAuth = ReturnType<typeof createPhoneAuth>;
