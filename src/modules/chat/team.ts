import type { Repo } from '../../lib/repo.js';
import type { Comms } from '../communicate/service.js';
import type { Ops } from '../operations/service.js';
import type { Training } from '../training/service.js';

/** Which venues a manager looks after: all of them (company admins) or just these. */
export interface Manages { all: boolean; siteIds: string[] }
export interface TeamWho { orgId: string; manages?: Manages }

/** Words that mean a manager is asking about people, not about their own work. */
const ABOUT_PEOPLE = /\b(who|whose|whom|how many|anyone|anybody|everyone|everybody|nobody|haven'?t|hasn'?t|hadn'?t|not (?:done|read|finished|started|completed|signed|ticked|confirmed)|team|staff|people|colleagues|venues?|sites?|overdue|outstanding|compliance|progress|behind|late|missed?)\b/i;
/** ...and about training, updates or checklists. */
const ABOUT_WORK = /\b(training|courses?|quiz|sign[- ]?off|refresher|certificates?|updates?|announcements?|read|checklists?|opening|closing|done|finished|completed|ticked|fire|food|hygiene|allergen)\b/i;
export const wantsTeam = (q: string) => ABOUT_PEOPLE.test(q) && ABOUT_WORK.test(q);

const MAX_NAMES = 25; const MAX_LINES = 60; const UPDATE_DAYS = 45; const BOARD_DAYS = 7;
const who = (m: { email: string; display_name: string | null }) => m.display_name?.trim() || (m.email.split('@')[0] ?? m.email);
const names = (xs: string[]) => (xs.length > MAX_NAMES ? `${xs.slice(0, MAX_NAMES).join(', ')} and ${xs.length - MAX_NAMES} more` : xs.join(', '));
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
const dayOf = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * For a manager: how their people are getting on with training, updates and checklists, as short lines for the chat.
 * Only people and venues this manager looks after, the same as the Manage screens. Built on request, not for every question.
 */
export function createTeam(deps: { repo: Repo; ops: Ops | null; comms: Comms | null; training: Training | null }) {
  return async function team(w: { orgId: string; manages: Manages }): Promise<string[]> {
    const { orgId, manages } = w;
    const [members, sites] = await Promise.all([deps.repo.listMembers(orgId), deps.repo.listSites(orgId)]);
    const mine = new Set(manages.siteIds);
    const siteName = new Map(sites.map((s) => [s.id, s.name]));
    const scope = manages.all ? sites.map((s) => s.id) : sites.filter((s) => mine.has(s.id)).map((s) => s.id);
    const multi = scope.length > 1;
    /** where each person works, only for people this manager looks after */
    const where = new Map<string, string>();
    for (const m of members) {
      if (m.status !== 'active' || !m.email) continue;
      const inScope = m.site_id === null ? manages.all : scope.includes(m.site_id);
      if (inScope && !where.has(m.email.toLowerCase())) where.set(m.email.toLowerCase(), m.site_id ? siteName.get(m.site_id) ?? '' : 'company');
    }
    const label = (p: { email: string; name: string }) => (multi && where.get(p.email.toLowerCase()) ? `${p.name} (${where.get(p.email.toLowerCase())})` : p.name);
    const mineOnly = <T extends { email: string }>(ps: T[]) => ps.filter((p) => where.has(p.email.toLowerCase()));
    const lines: string[] = [];

    if (deps.training) {
      const courses = (await deps.training.list(orgId, (c) => c.active && (c.site_id === null || scope.includes(c.site_id))).catch(() => [])).map((x) => x.course);
      for (const c of courses) {
        const d = await deps.training.progress(orgId, c.id).catch(() => null); if (!d) continue;
        const ps = mineOnly(d.people); if (!ps.length) { lines.push(`Course "${c.title}": nobody you look after is set to take it yet`); continue; }
        const todo = ps.filter((p) => p.status === 'todo').map(label); const renew = ps.filter((p) => p.status === 'renew').map(label); const done = ps.filter((p) => p.status === 'done');
        lines.push(`Course "${c.title}": ${done.length} of ${ps.length} done${todo.length ? `. Not done yet: ${names(todo)}` : ''}${renew.length ? `. Due a refresher: ${names(renew)}` : ''}`);
      }
    }

    if (deps.comms) {
      const since = Date.now() - UPDATE_DAYS * 86_400_000;
      const ups = (await deps.comms.list(orgId, (a) => (a.site_id === null || scope.includes(a.site_id)) && new Date(a.created_at).getTime() >= since).catch(() => [])).slice(0, 8);
      for (const u of ups) {
        const d = await deps.comms.readers(orgId, u.item.id).catch(() => null); if (!d) continue;
        const ps = mineOnly(d.people); if (!ps.length) continue;
        const unread = ps.filter((p) => !p.read_at).map(label); const unconfirmed = u.item.requires_ack ? ps.filter((p) => p.read_at && !p.acked_at).map(label) : [];
        lines.push(`Update "${u.item.title}": ${ps.length - unread.length} of ${ps.length} have read it${unread.length ? `. Not read: ${names(unread)}` : ''}${unconfirmed.length ? `. Read but not confirmed: ${names(unconfirmed)}` : ''}`);
      }
    }

    if (deps.ops && scope.length) {
      const today = await deps.ops.board(orgId, scope).catch(() => []);
      for (const t of today) {
        const r = t.run; const at = multi ? ` at ${siteName.get(t.site_id) ?? 'a venue'}` : '';
        const late = t.checklist.due_time ? `, due by ${t.checklist.due_time}` : '';
        lines.push(`Checklist "${t.checklist.title}"${at} today: ${r.completed_at ? `done at ${time(r.completed_at)} by ${(r.completed_by ?? '').split('@')[0]}` : r.started ? `${r.done} of ${r.total} ticked, not finished${late}` : `not started${late}`}`);
      }
      // earlier days this week (today is already covered above)
      const todayDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
      const recent = (await deps.ops.recent(orgId, scope, BOARD_DAYS).catch(() => [])).filter((x) => x.date !== todayDate).slice(0, 30);
      for (const x of recent) {
        const at = multi ? ` at ${siteName.get(x.site_id) ?? 'a venue'}` : '';
        lines.push(`Checklist "${x.checklist.title}"${at} on ${dayOf(x.date)}: ${x.run.completed_at ? 'done' : `${x.run.done} of ${x.run.total} ticked, not finished`}${x.run.note ? ` (note: ${x.run.note})` : ''}`);
      }
    }
    return lines.slice(0, MAX_LINES);
  };
}
