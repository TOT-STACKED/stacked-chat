import { randomUUID } from 'node:crypto';
import type { ChecklistRow, NewChecklist, OpsStore, RunKey, RunRow } from '../modules/operations/store.js';

/** In-memory checklists and runs for tests and the local preview. */
export class FakeOpsStore implements OpsStore {
  lists: ChecklistRow[] = []; runs: RunRow[] = []; sites = new Map<string, string[]>();
  addSite(orgId: string, id: string) { this.sites.set(orgId, [...(this.sites.get(orgId) ?? []), id]); }
  async listChecklists(orgId: string) { return this.lists.filter((l) => l.org_id === orgId); }
  async getChecklist(orgId: string, id: string) { return this.lists.find((l) => l.id === id && l.org_id === orgId) ?? null; }
  async insertChecklist(row: NewChecklist) { const r: ChecklistRow = { ...row, id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; this.lists.push(r); return r; }
  async updateChecklist(id: string, patch: Partial<ChecklistRow>) { const r = this.lists.find((l) => l.id === id)!; Object.assign(r, patch, { updated_at: new Date().toISOString() }); return r; }
  async deleteChecklist(id: string) { this.lists = this.lists.filter((l) => l.id !== id); this.runs = this.runs.filter((r) => r.checklist_id !== id); }
  async getRun(checklistId: string, siteId: string, date: string) { return this.runs.find((r) => r.checklist_id === checklistId && r.site_id === siteId && r.run_date === date) ?? null; }
  async saveRun(key: RunKey, fields: Partial<RunRow>) {
    let r = await this.getRun(key.checklist_id, key.site_id, key.run_date);
    if (!r) { r = { ...key, id: randomUUID(), ticks: {}, completed_by: null, completed_at: null, note: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; this.runs.push(r); }
    Object.assign(r, fields, { updated_at: new Date().toISOString() }); return r;
  }
  async listRuns(orgId: string, from: string, to: string) { return this.runs.filter((r) => r.org_id === orgId && r.run_date >= from && r.run_date <= to); }
  claimed = new Set<string>();
  async listDueChecklists() { return this.lists.filter((l) => l.active && l.due_time); }
  async claimReminder(checklistId: string, siteId: string, date: string) { const k = `${checklistId}|${siteId}|${date}`; if (this.claimed.has(k)) return false; this.claimed.add(k); return true; }
  async siteIds(orgId: string) { return this.sites.get(orgId) ?? []; }
}
