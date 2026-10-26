import { randomUUID } from 'node:crypto';
import { badRequest, notFound } from '../../lib/errors.js';
import type { Repo } from '../../lib/repo.js';
import { recipientsOf, visibleTo } from '../communicate/service.js';
import type { CompletionRow, CourseRow, Lesson, Question, TrainingStore } from './store.js';

export const MAX_LESSONS = 30;
export const MAX_QUESTIONS = 30;
const shortId = () => randomUUID().slice(0, 8);
const text = (s: unknown, max: number, what: string, required = true): string => {
  const t = String(s ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (required && !t) throw badRequest(`${what} cannot be empty`);
  if (t.length > max) throw badRequest(`${what} can be up to ${max.toLocaleString('en-GB')} characters`);
  return t;
};
const oneLine = (s: unknown, max: number, what: string) => text(String(s ?? '').replace(/\s+/g, ' '), max, what);

export function cleanLessons(input: Array<{ id?: string; title: string; body: string; url?: string | null }>, existing: Lesson[] = []): Lesson[] {
  if (!input.length) throw badRequest('Add at least one lesson');
  if (input.length > MAX_LESSONS) throw badRequest(`A course can have up to ${MAX_LESSONS} lessons`);
  const have = new Set(existing.map((l) => l.id));
  return input.map((l, i) => {
    const url = l.url ? String(l.url).trim() : '';
    if (url && !/^https:\/\/\S+$/i.test(url)) throw badRequest(`Lesson ${i + 1}: the video link must start with https://`);
    return { id: l.id && have.has(l.id) ? l.id : shortId(), title: oneLine(l.title, 120, `Lesson ${i + 1} title`), body: text(l.body, 5000, `Lesson ${i + 1} text`), url: url ? url.slice(0, 500) : null };
  });
}
export function cleanQuiz(input: Array<{ id?: string; q: string; options: string[]; answer: number }>, existing: Question[] = []): Question[] {
  if (input.length > MAX_QUESTIONS) throw badRequest(`A quiz can have up to ${MAX_QUESTIONS} questions`);
  const have = new Set(existing.map((q) => q.id));
  return input.map((q, i) => {
    const options = (q.options ?? []).map((o) => String(o ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (options.length < 2 || options.length > 4) throw badRequest(`Question ${i + 1} needs between 2 and 4 answers`);
    if (options.some((o) => o.length > 150)) throw badRequest(`Question ${i + 1}: each answer can be up to 150 characters`);
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= (q.options ?? []).length || !String(q.options[q.answer] ?? '').trim()) throw badRequest(`Question ${i + 1}: choose which answer is correct`);
    // the correct answer's position after blank answers have been dropped
    const answer = (q.options ?? []).slice(0, q.answer).filter((o) => String(o ?? '').trim()).length;
    return { id: q.id && have.has(q.id) ? q.id : shortId(), q: oneLine(q.q, 300, `Question ${i + 1}`), options, answer };
  });
}

export type Status = 'todo' | 'done' | 'renew';
const addMonths = (iso: string, n: number) => { const d = new Date(iso); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString(); };
export function statusOf(c: Pick<CourseRow, 'renew_months'>, mine: CompletionRow[], now: Date): { status: Status; completed_at: string | null; expires_at: string | null; score: number | null } {
  const last = [...mine].sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1))[0];
  if (!last) return { status: 'todo', completed_at: null, expires_at: null, score: null };
  const expires = c.renew_months ? addMonths(last.completed_at, c.renew_months) : null;
  return { status: expires && now.toISOString() >= expires ? 'renew' : 'done', completed_at: last.completed_at, expires_at: expires, score: last.score };
}

export interface Stats { recipients: number; done: number; renew: number; todo: number }
export interface Person { email: string; name: string; status: Status; completed_at: string | null; expires_at: string | null; score: number | null }
export interface Who { orgId: string; siteId: string; email: string; teamIds: string[] }
export interface Listed { id: string; title: string; description: string | null; lessons: number; questions: number; pass_percent: number; renew_months: number | null; status: Status; completed_at: string | null; expires_at: string | null; score: number | null }

export function createTraining(deps: { store: TrainingStore; repo: Repo; now?: () => Date }) {
  const { store, repo } = deps; const now = () => (deps.now ? deps.now() : new Date());
  const nameOf = (m: { email: string; display_name: string | null }) => m.display_name?.trim() || (m.email.split('@')[0] ?? m.email);

  async function audienceFor(orgId: string, a: { site_id?: string | null; team_id?: string | null }) {
    if (a.team_id) { const t = await repo.getTeam(orgId, a.team_id); if (!t) throw badRequest('That team is not part of this company'); return { site_id: t.site_id, team_id: t.id }; }
    if (a.site_id) { if (!(await repo.listSites(orgId)).some((s) => s.id === a.site_id)) throw badRequest('That venue is not part of this company'); return { site_id: a.site_id, team_id: null }; }
    return { site_id: null, team_id: null };
  }
  const renew = (v: unknown): number | null => { if (v === null || v === undefined) return null; if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 60) throw badRequest('Renewal must be between 1 and 60 months'); return v as number; };
  const pass = (v: unknown): number => { if (v === undefined) return 80; if (!Number.isInteger(v) || (v as number) < 50 || (v as number) > 100) throw badRequest('The pass mark must be between 50 and 100'); return v as number; };

  async function create(orgId: string, o: { title: string; description?: string | null; site_id?: string | null; team_id?: string | null; lessons: Parameters<typeof cleanLessons>[0]; quiz?: Parameters<typeof cleanQuiz>[0]; pass_percent?: number; renew_months?: number | null; by: string }): Promise<CourseRow> {
    const aud = await audienceFor(orgId, o);
    return store.insertCourse({ org_id: orgId, ...aud, title: oneLine(o.title, 120, 'The title'), description: o.description ? text(o.description, 500, 'The description', false) || null : null,
      lessons: cleanLessons(o.lessons), quiz: cleanQuiz(o.quiz ?? []), pass_percent: pass(o.pass_percent), renew_months: renew(o.renew_months), active: true, created_by: o.by });
  }
  async function update(orgId: string, id: string, p: { title?: string; description?: string | null; lessons?: Parameters<typeof cleanLessons>[0]; quiz?: Parameters<typeof cleanQuiz>[0]; pass_percent?: number; renew_months?: number | null; active?: boolean }): Promise<CourseRow> {
    const cur = await store.getCourse(orgId, id); if (!cur) throw notFound('Course not found');
    return store.updateCourse(id, {
      ...(p.title !== undefined ? { title: oneLine(p.title, 120, 'The title') } : {}),
      ...(p.description !== undefined ? { description: p.description ? text(p.description, 500, 'The description', false) || null : null } : {}),
      ...(p.lessons !== undefined ? { lessons: cleanLessons(p.lessons, cur.lessons) } : {}), ...(p.quiz !== undefined ? { quiz: cleanQuiz(p.quiz, cur.quiz) } : {}),
      ...(p.pass_percent !== undefined ? { pass_percent: pass(p.pass_percent) } : {}), ...(p.renew_months !== undefined ? { renew_months: renew(p.renew_months) } : {}),
      ...(p.active !== undefined ? { active: p.active } : {}),
    });
  }
  async function remove(orgId: string, id: string) { if (!(await store.getCourse(orgId, id))) throw notFound('Course not found'); await store.deleteCourse(id); }

  async function people(c: CourseRow, members: Awaited<ReturnType<Repo['listMembers']>>, links: Array<{ member_id: string; team_id: string }>, done: CompletionRow[]): Promise<Person[]> {
    return recipientsOf(c, members, links).map((m) => ({ email: m.email, name: nameOf(m), ...pick(statusOf(c, done.filter((d) => d.course_id === c.id && d.email.toLowerCase() === m.email.toLowerCase()), now())) }));
  }
  const pick = (s: ReturnType<typeof statusOf>) => ({ status: s.status, completed_at: s.completed_at, expires_at: s.expires_at, score: s.score });
  const stats = (ps: Person[]): Stats => ({ recipients: ps.length, done: ps.filter((p) => p.status === 'done').length, renew: ps.filter((p) => p.status === 'renew').length, todo: ps.filter((p) => p.status === 'todo').length });
  const order: Record<Status, number> = { todo: 0, renew: 1, done: 2 };

  /** For managers: every course they may see, with how many people are done, due a refresher, or still to do. */
  async function list(orgId: string, visible: (c: CourseRow) => boolean): Promise<Array<{ course: CourseRow; stats: Stats }>> {
    const courses = (await store.listCourses(orgId)).filter(visible);
    const [members, links, done] = await Promise.all([repo.listMembers(orgId), repo.listMemberTeams(orgId), store.completions(courses.map((c) => c.id))]);
    return Promise.all(courses.map(async (course) => ({ course, stats: stats(await people(course, members, links, done)) })));
  }
  async function progress(orgId: string, id: string): Promise<{ course: CourseRow; stats: Stats; people: Person[] } | null> {
    const course = await store.getCourse(orgId, id); if (!course) return null;
    const [members, links, done] = await Promise.all([repo.listMembers(orgId), repo.listMemberTeams(orgId), store.completions([id])]);
    const ps = (await people(course, members, links, done)).sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
    return { course, stats: stats(ps), people: ps };
  }

  /** What a person sees: active courses for their venue and teams, with their own status. */
  async function listFor(who: Who): Promise<Listed[]> {
    const courses = (await store.listCourses(who.orgId)).filter((c) => c.active && visibleTo(c, who));
    const done = await store.completions(courses.map((c) => c.id));
    return courses.map((c) => ({ id: c.id, title: c.title, description: c.description, lessons: c.lessons.length, questions: c.quiz.length, pass_percent: c.pass_percent, renew_months: c.renew_months,
      ...statusOf(c, done.filter((d) => d.course_id === c.id && d.email.toLowerCase() === who.email.toLowerCase()), now()) }));
  }
  async function openFor(who: Who, id: string): Promise<CourseRow> {
    const c = await store.getCourse(who.orgId, id);
    if (!c || !c.active || !visibleTo(c, who)) throw notFound('Course not found');
    return c;
  }
  /** The course as a learner sees it: the quiz without its answers. */
  async function courseFor(who: Who, id: string) {
    const c = await openFor(who, id);
    return { id: c.id, title: c.title, description: c.description, pass_percent: c.pass_percent, renew_months: c.renew_months, lessons: c.lessons, quiz: c.quiz.map((q) => ({ id: q.id, q: q.q, options: q.options })) };
  }
  async function submit(who: Who, id: string, input: { answers?: number[]; confirm?: boolean }): Promise<{ passed: boolean; score: number | null; correct: number; total: number; wrong: string[]; completed_at: string | null }> {
    const c = await openFor(who, id); const at = now().toISOString();
    if (!c.quiz.length) {
      if (input.confirm !== true) throw badRequest('Confirm you have read and understood this course');
      await store.addCompletion({ course_id: c.id, org_id: who.orgId, email: who.email.toLowerCase(), score: null, completed_at: at });
      return { passed: true, score: null, correct: 0, total: 0, wrong: [], completed_at: at };
    }
    const answers = input.answers ?? [];
    if (answers.length !== c.quiz.length) throw badRequest('Answer every question');
    const wrong = c.quiz.filter((q, i) => answers[i] !== q.answer).map((q) => q.id);
    const correct = c.quiz.length - wrong.length; const score = Math.round((correct / c.quiz.length) * 100); const passed = score >= c.pass_percent;
    if (passed) await store.addCompletion({ course_id: c.id, org_id: who.orgId, email: who.email.toLowerCase(), score, completed_at: at });
    return { passed, score, correct, total: c.quiz.length, wrong, completed_at: passed ? at : null };
  }

  return { create, update, remove, get: (orgId: string, id: string) => store.getCourse(orgId, id), list, progress, listFor, courseFor, submit, audienceFor };
}
export type Training = ReturnType<typeof createTraining>;
