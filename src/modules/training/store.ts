import type { Db } from '../../lib/supabase.js';

export interface Lesson { id: string; title: string; body: string; url: string | null }
export interface Question { id: string; q: string; options: string[]; answer: number }
export interface CourseRow {
  id: string; org_id: string; site_id: string | null; team_id: string | null; title: string; description: string | null;
  lessons: Lesson[]; quiz: Question[]; pass_percent: number; renew_months: number | null; active: boolean;
  created_by: string | null; created_at: string; updated_at: string;
}
export interface CompletionRow { id: string; course_id: string; org_id: string; email: string; score: number | null; completed_at: string }
export type NewCourse = Omit<CourseRow, 'id' | 'created_at' | 'updated_at'>;
export type CoursePatch = Partial<Pick<CourseRow, 'title' | 'description' | 'lessons' | 'quiz' | 'pass_percent' | 'renew_months' | 'active'>>;

export interface TrainingStore {
  listCourses(orgId: string): Promise<CourseRow[]>;
  getCourse(orgId: string, id: string): Promise<CourseRow | null>;
  insertCourse(row: NewCourse): Promise<CourseRow>;
  updateCourse(id: string, patch: CoursePatch): Promise<CourseRow>;
  deleteCourse(id: string): Promise<void>;
  completions(courseIds: string[]): Promise<CompletionRow[]>;
  addCompletion(row: { course_id: string; org_id: string; email: string; score: number | null; completed_at: string }): Promise<CompletionRow>;
}

const enc = encodeURIComponent;
const CS = 'id,org_id,site_id,team_id,title,description,lessons,quiz,pass_percent,renew_months,active,created_by,created_at,updated_at';
const CP = 'id,course_id,org_id,email,score,completed_at';

export function createSupabaseTrainingStore(db: Db): TrainingStore {
  const ok = <T>(r: { status: number; data: T }, what: string): T => { if (r.status >= 300) throw new Error(`training store: ${what} failed (${r.status})`); return r.data; };
  const rep = { Prefer: 'return=representation' };
  const first = <T>(rows: T[] | null) => (rows && rows[0]) ?? null;
  return {
    async listCourses(orgId) { return ok(await db.rest<CourseRow[]>(`/training_courses?org_id=eq.${enc(orgId)}&select=${CS}&order=created_at.asc&limit=500`), 'list') ?? []; },
    async getCourse(orgId, id) { return first(ok(await db.rest<CourseRow[]>(`/training_courses?id=eq.${enc(id)}&org_id=eq.${enc(orgId)}&select=${CS}&limit=1`), 'get')); },
    async insertCourse(row) { return first(ok(await db.rest<CourseRow[]>(`/training_courses?select=${CS}`, { method: 'POST', headers: rep, body: row }), 'insert'))!; },
    async updateCourse(id, patch) { return first(ok(await db.rest<CourseRow[]>(`/training_courses?id=eq.${enc(id)}&select=${CS}`, { method: 'PATCH', headers: rep, body: { ...patch, updated_at: new Date().toISOString() } }), 'update'))!; },
    async deleteCourse(id) { ok(await db.rest(`/training_courses?id=eq.${enc(id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }), 'delete'); },
    async completions(ids) {
      if (!ids.length) return [];
      return ok(await db.rest<CompletionRow[]>(`/training_completions?course_id=in.(${ids.map(enc).join(',')})&select=${CP}&order=completed_at.desc&limit=50000`), 'completions') ?? [];
    },
    async addCompletion(row) { return first(ok(await db.rest<CompletionRow[]>(`/training_completions?select=${CP}`, { method: 'POST', headers: rep, body: row }), 'add completion'))!; },
  };
}
