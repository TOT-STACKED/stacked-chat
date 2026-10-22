import type { Db } from '../../lib/supabase.js';

export interface AnnouncementRow {
  id: string; org_id: string; site_id: string | null; team_id: string | null; title: string; body: string; requires_ack: boolean;
  created_by: string | null; created_at: string; updated_at: string;
}
export interface ReadRow { announcement_id: string; email: string; read_at: string; acked_at: string | null }
export type NewAnnouncement = Omit<AnnouncementRow, 'id' | 'created_at' | 'updated_at'>;

export interface CommsStore {
  list(orgId: string, limit: number): Promise<AnnouncementRow[]>;
  get(orgId: string, id: string): Promise<AnnouncementRow | null>;
  insert(row: NewAnnouncement): Promise<AnnouncementRow>;
  update(id: string, patch: Partial<Pick<AnnouncementRow, 'title' | 'body' | 'requires_ack'>>): Promise<AnnouncementRow>;
  remove(id: string): Promise<void>;
  reads(ids: string[]): Promise<ReadRow[]>;
  /** note that this person opened it (the first time only); `ack` also records that they confirmed it */
  markRead(id: string, email: string, ack: boolean, at: string): Promise<void>;
}

const enc = encodeURIComponent;
const COLS = 'id,org_id,site_id,team_id,title,body,requires_ack,created_by,created_at,updated_at';

export function createSupabaseCommsStore(db: Db): CommsStore {
  const ok = <T>(r: { status: number; data: T }, what: string): T => { if (r.status >= 300) throw new Error(`communicate store: ${what} failed (${r.status})`); return r.data; };
  const rep = { Prefer: 'return=representation' };
  const first = <T>(rows: T[] | null) => (rows && rows[0]) ?? null;
  return {
    async list(orgId, limit) { return ok(await db.rest<AnnouncementRow[]>(`/announcements?org_id=eq.${enc(orgId)}&select=${COLS}&order=created_at.desc&limit=${limit}`), 'list') ?? []; },
    async get(orgId, id) { return first(ok(await db.rest<AnnouncementRow[]>(`/announcements?id=eq.${enc(id)}&org_id=eq.${enc(orgId)}&select=${COLS}&limit=1`), 'get')); },
    async insert(row) { return first(ok(await db.rest<AnnouncementRow[]>(`/announcements?select=${COLS}`, { method: 'POST', headers: rep, body: row }), 'insert'))!; },
    async update(id, patch) { return first(ok(await db.rest<AnnouncementRow[]>(`/announcements?id=eq.${enc(id)}&select=${COLS}`, { method: 'PATCH', headers: rep, body: { ...patch, updated_at: new Date().toISOString() } }), 'update'))!; },
    async remove(id) { ok(await db.rest(`/announcements?id=eq.${enc(id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }), 'delete'); },
    async reads(ids) {
      if (!ids.length) return [];
      return ok(await db.rest<ReadRow[]>(`/announcement_reads?announcement_id=in.(${ids.map(enc).join(',')})&select=announcement_id,email,read_at,acked_at&limit=50000`), 'reads') ?? [];
    },
    async markRead(id, email, ack, at) {
      ok(await db.rest('/announcement_reads?on_conflict=announcement_id,email', { method: 'POST', headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' }, body: { announcement_id: id, email, read_at: at } }), 'mark read');
      if (ack) ok(await db.rest(`/announcement_reads?announcement_id=eq.${enc(id)}&email=eq.${enc(email)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { acked_at: at } }), 'acknowledge');
    },
  };
}
