import { randomUUID } from 'node:crypto';
import type { CompletionRow, CoursePatch, CourseRow, NewCourse, TrainingStore } from '../modules/training/store.js';

/** In-memory courses and sign-offs for tests and the local preview. */
export class FakeTrainingStore implements TrainingStore {
  courses: CourseRow[] = []; done: CompletionRow[] = [];
  async listCourses(orgId: string) { return this.courses.filter((c) => c.org_id === orgId); }
  async getCourse(orgId: string, id: string) { return this.courses.find((c) => c.id === id && c.org_id === orgId) ?? null; }
  async insertCourse(row: NewCourse) { const c: CourseRow = { ...row, id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; this.courses.push(c); return c; }
  async updateCourse(id: string, patch: CoursePatch) { const c = this.courses.find((x) => x.id === id)!; Object.assign(c, patch, { updated_at: new Date().toISOString() }); return c; }
  async deleteCourse(id: string) { this.courses = this.courses.filter((c) => c.id !== id); this.done = this.done.filter((d) => d.course_id !== id); }
  async completions(ids: string[]) { return this.done.filter((d) => ids.includes(d.course_id)).sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1)); }
  async addCompletion(row: { course_id: string; org_id: string; email: string; score: number | null; completed_at: string }) { const r: CompletionRow = { ...row, id: randomUUID() }; this.done.push(r); return r; }
}
