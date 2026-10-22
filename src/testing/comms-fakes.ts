import { randomUUID } from 'node:crypto';
import type { AnnouncementRow, CommsStore, NewAnnouncement, ReadRow } from '../modules/communicate/store.js';

/** In-memory updates and read receipts for tests and the local preview. */
export class FakeCommsStore implements CommsStore {
  rows: AnnouncementRow[] = []; readRows: ReadRow[] = [];
  async list(orgId: string, limit: number) { return this.rows.filter((r) => r.org_id === orgId).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limit); }
  async get(orgId: string, id: string) { return this.rows.find((r) => r.id === id && r.org_id === orgId) ?? null; }
  async insert(row: NewAnnouncement) { const r: AnnouncementRow = { ...row, id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; this.rows.push(r); return r; }
  async update(id: string, patch: Partial<AnnouncementRow>) { const r = this.rows.find((x) => x.id === id)!; Object.assign(r, patch, { updated_at: new Date().toISOString() }); return r; }
  async remove(id: string) { this.rows = this.rows.filter((r) => r.id !== id); this.readRows = this.readRows.filter((r) => r.announcement_id !== id); }
  async reads(ids: string[]) { return this.readRows.filter((r) => ids.includes(r.announcement_id)); }
  async markRead(id: string, email: string, ack: boolean, at: string) {
    let r = this.readRows.find((x) => x.announcement_id === id && x.email === email);
    if (!r) { r = { announcement_id: id, email, read_at: at, acked_at: null }; this.readRows.push(r); }
    if (ack) r.acked_at = at;
  }
}
