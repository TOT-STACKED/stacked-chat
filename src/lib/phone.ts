import { createHash } from 'node:crypto';

/**
 * Staff sign in with a mobile number. Everywhere else in the app a person is identified by a string that looks like an email
 * (training sign-offs, ticks, read receipts). For someone who has no email, that string is made from their number, on a
 * domain that cannot receive mail (".invalid" is reserved for exactly this), so nothing can ever be sent to it by mistake.
 */
const DOMAIN = 'phone.invalid';

/** "07700 900123", "+44 7700 900123", "0044 7700 900123" → "+447700900123". Any other country needs its "+" code. Null if it is not a number. */
export function normalizePhone(input: string): string | null {
  let s = String(input ?? '').trim().replace(/[\s().-]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('0') && !s.startsWith('00')) s = '+44' + s.slice(1);
  else if (/^44\d{10}$/.test(s)) s = '+' + s;
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null;
  if (s.startsWith('+44') && !/^\+44[1-9]\d{9}$/.test(s)) return null; // UK numbers are 10 digits after 44
  return s;
}

/** The identifier used in place of an email: "+447700900123" → "447700900123@phone.invalid". */
export const phoneKey = (e164: string) => `${e164.replace(/\D/g, '')}@${DOMAIN}`;
export const isPhoneKey = (email: string | null | undefined) => !!email && email.toLowerCase().endsWith('@' + DOMAIN);
export const phoneOfKey = (email: string) => '+' + email.split('@')[0]!;

/** A stable id for the person who owns a number (the same number is always the same person, whichever venue they are added at). */
export function userIdForPhone(e164: string): string {
  const h = createHash('sha256').update('stacked-chat-phone:' + e164).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16]!, 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** For people to read: UK numbers as "07700 900123", anything else as written with its country code. */
export function formatPhone(e164: string): string {
  const m = /^\+44(\d{4})(\d{6})$/.exec(e164);
  return m ? `0${m[1]} ${m[2]}` : e164;
}
