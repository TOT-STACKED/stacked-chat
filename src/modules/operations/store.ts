import type { Db } from '../../lib/supabase.js';

export type ChecklistKind = 'opening' | 'closing' | 'custom';
export interface ChecklistItem { id: string; text: string }
export interface ChecklistRow {
  id: string; org_id: string; site_id: string | null; title: string; kind: ChecklistKind; items: ChecklistItem[]; active: boolean;
  /** "HH:MM" UK time by which it should be done; null = no reminder */ due_time: string | null; /** 0 = Sunday ... 6 = Saturday */ remind_days: number[];
  created_by: string | null; created_at: string; updated_at: string;
}
export interface Tick { by: string; at: string }
export interface RunRow {
  id: string; checklist_id: string; org_id: string; site_id: string; run_date: string; ticks: Record<string, Tick>;
  completed_by: string | null; completed_at: string | null; note: string | null; created_at: string; updated_at: string;
}
export type NewChecklist = Omit<ChecklistRow, 'id' | 'created_at' | 'updated_at'>;
export type RunKey = { checklist_id: string; org_id: string; site_id: string; run_date: string };

export interface OpsStore {
  listChecklists(orgId: string): Promise<ChecklistRow[]>;
  getChecklist(orgId: string, id: string): Promise<ChecklistRow | null>;
  insertChecklist(row: NewChecklist): Promise<ChecklistRow>;
  updateChecklist(id: string, patch: Partial<Pick<ChecklistRow, 'title' | 'kind' | 'items' | 'active' | 'site_id' | 'due_time' | 'remind_days'>>): Promise<ChecklistRow>;
  deleteChecklist(id: string): Promise<void>;
  getRun(checklistId: string, siteId: string, date: string): Promise<RunRow | null>;
  /** create the run if it does not exist, or change the given fields */
  saveRun(key: RunKey, fields: Partial<Pick<RunRow, 'ticks' | 'completed_by' | 'completed_at' | 'note'>>): Promise<RunRow>;
  listRuns(orgId: string, fromDate: string, toDate: string): Promise<RunRow[]>;
  /** active checklists, in any company, that have a due time (what the reminder job looks at) */
  listDueChecklists(): Promise<ChecklistRow[]>;
  /** true if this call is the one that gets to send today's reminder for this checklist at this venue */
  claimReminder(checklistId: string, siteId: string, date: string): Promise<boolean>;
  /** the venues of an organisation (to check an audience) */
  siteIds(orgId: string): Promise<string[]>;
}

const enc = encodeURIComponent;
const CL = 'id,org_id,site_id,title,kind,items,active,due_time,remind_days,created_by,created_at,updated_at';
const RUN = 'id,checklist_id,org_id,site_id,run_date,ticks,completed_by,completed_at,note,created_at,updated_at';

export function createSupabaseOpsStore(db: Db): OpsStore {
  const ok = <T>(r: { status: number; data: T }, what: string): T => { if (r.status >= 300) throw new Error(`operations store: ${what} failed (${r.status})`); return r.data; };
  const rep = { Prefer: 'return=representation' };
  const first = <T>(rows: T[] | null) => (rows && rows[0]) ?? null;
  return {
    async listChecklists(orgId) { return ok(await db.rest<ChecklistRow[]>(`/checklists?org_id=eq.${enc(orgId)}&select=${CL}&order=created_at.asc&limit=1000`), 'list') ?? []; },
    async getChecklist(orgId, id) { return first(ok(await db.rest<ChecklistRow[]>(`/checklists?id=eq.${enc(id)}&org_id=eq.${enc(orgId)}&select=${CL}&limit=1`), 'get')); },
    async insertChecklist(row) { return first(ok(await db.rest<ChecklistRow[]>(`/checklists?select=${CL}`, { method: 'POST', headers: rep, body: row }), 'insert'))!; },
    async updateChecklist(id, patch) { return first(ok(await db.rest<ChecklistRow[]>(`/checklists?id=eq.${enc(id)}&select=${CL}`, { method: 'PATCH', headers: rep, body: { ...patch, updated_at: new Date().toISOString() } }), 'update'))!; },
    async deleteChecklist(id) { ok(await db.rest(`/checklists?id=eq.${enc(id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }), 'delete'); },
    async getRun(checklistId, siteId, date) {
      return first(ok(await db.rest<RunRow[]>(`/checklist_runs?checklist_id=eq.${enc(checklistId)}&site_id=eq.${enc(siteId)}&run_date=eq.${enc(date)}&select=${RUN}&limit=1`), 'get run'));
    },
    async saveRun(key, fields) {
      const body = { ...key, ...fields, updated_at: new Date().toISOString() };
      return first(ok(await db.rest<RunRow[]>(`/checklist_runs?on_conflict=checklist_id,site_id,run_date&select=${RUN}`, { method: 'POST', headers: { Prefer: 'return=representation,resolution=merge-duplicates' }, body }), 'save run'))!;
    },
    async listRuns(orgId, from, to) {
      return ok(await db.rest<RunRow[]>(`/checklist_runs?org_id=eq.${enc(orgId)}&run_date=gte.${enc(from)}&run_date=lte.${enc(to)}&select=${RUN}&order=run_date.desc&limit=5000`), 'list runs') ?? [];
    },
    async listDueChecklists() { return ok(await db.rest<ChecklistRow[]>(`/checklists?active=eq.true&due_time=not.is.null&select=${CL}&limit=5000`), 'list due') ?? []; },
    async claimReminder(checklistId, siteId, date) {
      const r = await db.rest<Array<{ checklist_id: string }>>('/checklist_reminders?on_conflict=checklist_id,site_id,run_date&select=checklist_id', { method: 'POST', headers: { Prefer: 'return=representation,resolution=ignore-duplicates' }, body: { checklist_id: checklistId, site_id: siteId, run_date: date } });
      if (r.status >= 300) throw new Error(`operations store: claim reminder failed (${r.status})`);
      return (r.data ?? []).length > 0; // ignored duplicates return no row: someone already sent it
    },
    async siteIds(orgId) { return (ok(await db.rest<Array<{ id: string }>>(`/venues?org_id=eq.${enc(orgId)}&select=id&limit=1000`), 'sites') ?? []).map((s) => s.id); },
  };
}
