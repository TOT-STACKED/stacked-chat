import type { Db } from '../../lib/supabase.js';

export interface StoredMessage { role: 'user' | 'assistant'; content: string }
export interface ConversationRow { id: number; email: string | null; venue_id: string | null; messages: StoredMessage[] | null; created_at: string; updated_at: string | null }

/** The chat's conversations (the same table Insights reads). */
export interface ConversationStore {
  create(c: { email: string; name: string | null; venue: string; venue_id: string; messages: StoredMessage[] }): Promise<number>;
  save(id: number, messages: StoredMessage[]): Promise<void>;
  get(id: number): Promise<ConversationRow | null>;
  listMine(email: string, siteId: string, limit: number): Promise<ConversationRow[]>;
}

const enc = encodeURIComponent;
export function createSupabaseConversationStore(db: Db): ConversationStore {
  const ok = <T>(r: { status: number; data: T }, what: string): T => { if (r.status >= 300) throw new Error(`conversation store: ${what} failed (${r.status})`); return r.data; };
  return {
    async create(c) {
      const rows = ok(await db.rest<Array<{ id: number }>>('/conversations?select=id', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { ...c, email: c.email.toLowerCase() } }), 'create');
      return rows[0]!.id;
    },
    async save(id, messages) {
      ok(await db.rest(`/conversations?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { messages, updated_at: new Date().toISOString() } }), 'save');
    },
    async get(id) {
      return ok(await db.rest<ConversationRow[]>(`/conversations?id=eq.${id}&select=id,email,venue_id,messages,created_at,updated_at&limit=1`), 'get')[0] ?? null;
    },
    async listMine(email, siteId, limit) {
      return ok(await db.rest<ConversationRow[]>(`/conversations?email=eq.${enc(email.toLowerCase())}&venue_id=eq.${enc(siteId)}&select=id,email,venue_id,messages,created_at,updated_at&order=updated_at.desc.nullslast,created_at.desc&limit=${limit}`), 'list') ?? [];
    },
  };
}
