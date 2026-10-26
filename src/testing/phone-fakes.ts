import { randomUUID } from 'node:crypto';
import type { SmsSender } from '../lib/sms.js';
import type { CodeRow, PhoneCodeStore } from '../modules/phone-auth/store.js';

export class FakePhoneCodeStore implements PhoneCodeStore {
  rows: CodeRow[] = [];
  constructor(private readonly now: () => Date = () => new Date()) {}
  async insert(r: { phone: string; code_hash: string; expires_at: string }) { this.rows.push({ id: randomUUID(), attempts: 0, created_at: this.now().toISOString(), ...r }); }
  async latest(phone: string) { return [...this.rows].filter((r) => r.phone === phone).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null; }
  async claimAttempt(id: string, max: number) { const r = this.rows.find((x) => x.id === id); if (!r || r.attempts >= max) return false; r.attempts++; return true; }
  async clear(phone: string) { this.rows = this.rows.filter((r) => r.phone !== phone); }
  async countSince(phone: string, iso: string) { return this.rows.filter((r) => r.phone === phone && r.created_at >= iso).length; }
}

/** Records every text instead of sending it. `lastCode(phone)` reads the code out of the latest one. */
export class FakeSms implements SmsSender {
  sent: Array<{ to: string; text: string }> = []; fail = false;
  async send(to: string, text: string) { if (this.fail) return 'failed' as const; this.sent.push({ to, text }); return 'sent' as const; }
  lastCode(to: string) { return [...this.sent].reverse().find((m) => m.to === to)?.text.match(/\b(\d{6})\b/)?.[1] ?? null; }
}
