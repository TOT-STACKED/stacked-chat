import type { Db } from '../../lib/supabase.js';

export interface CodeRow { id: string; phone: string; code_hash: string; attempts: number; expires_at: string; created_at: string }

export interface PhoneCodeStore {
  insert(row: { phone: string; code_hash: string; expires_at: string }): Promise<void>;
  /** the newest code sent to this number */
  latest(phone: string): Promise<CodeRow | null>;
  /** note one more wrong guess */
  bump(id: string): Promise<void>;
  /** forget every code for this number (after a good sign-in) */
  clear(phone: string): Promise<void>;
  /** how many codes were sent to this number since then */
  countSince(phone: string, iso: string): Promise<number>;
}

const enc = encodeURIComponent;
export function createSupabasePhoneCodeStore(db: Db): PhoneCodeStore {
  const ok = <T>(r: { status: number; data: T }, what: string): T => { if (r.status >= 300) throw new Error(`phone codes: ${what} failed (${r.status})`); return r.data; };
  return {
    async insert(row) { ok(await db.rest('/phone_codes', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: row }), 'insert'); },
    async latest(phone) { return (ok(await db.rest<CodeRow[]>(`/phone_codes?phone=eq.${enc(phone)}&select=id,phone,code_hash,attempts,expires_at,created_at&order=created_at.desc&limit=1`), 'latest') ?? [])[0] ?? null; },
    async bump(id) {
      const cur = (ok(await db.rest<CodeRow[]>(`/phone_codes?id=eq.${enc(id)}&select=attempts&limit=1`), 'read') ?? [])[0];
      ok(await db.rest(`/phone_codes?id=eq.${enc(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { attempts: (cur?.attempts ?? 0) + 1 } }), 'bump');
    },
    async clear(phone) { ok(await db.rest(`/phone_codes?phone=eq.${enc(phone)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }), 'clear'); },
    async countSince(phone, iso) { return (ok(await db.rest<Array<{ id: string }>>(`/phone_codes?phone=eq.${enc(phone)}&created_at=gte.${enc(iso)}&select=id&limit=50`), 'count') ?? []).length; },
  };
}
