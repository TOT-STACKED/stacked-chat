import { checklistReminderEmail, type Mailer } from '../../lib/email.js';
import type { MemberRow, Repo } from '../../lib/repo.js';
import { ukDate } from './service.js';
import type { ChecklistRow, OpsStore } from './store.js';

/** A reminder goes out from the due time, but not if the server was away so long that it would be stale. */
export const REMIND_WINDOW_MINUTES = 180;
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Day of the week (0 = Sunday) and minutes since midnight, in UK time. */
export function ukClock(d: Date): { dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return { dow: DOW[get('weekday')] ?? 0, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}
export const dueMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** Is this list past its due time today (on a day it is checked)? Used by the reminder job and the Manage board. */
export function isPastDue(l: Pick<ChecklistRow, 'due_time' | 'remind_days'>, now: Date): boolean {
  if (!l.due_time) return false;
  const c = ukClock(now);
  return l.remind_days.includes(c.dow) && c.minutes >= dueMinutes(l.due_time);
}

/** Managers of a venue; if it has none, the company's admins. Active people only, each address once. */
export function recipientsFor(members: MemberRow[], siteId: string): string[] {
  const active = members.filter((m) => m.status === 'active' && m.email);
  const pick = (rows: MemberRow[]) => [...new Set(rows.map((m) => m.email.toLowerCase()))];
  const siteManagers = pick(active.filter((m) => m.role === 'site_manager' && m.site_id === siteId));
  return siteManagers.length ? siteManagers : pick(active.filter((m) => m.site_id === null && (m.role === 'owner' || m.role === 'hq_admin')));
}

export function createReminders(deps: { store: OpsStore; repo: Repo; mailer: Mailer | null; publicUrl: string; now?: () => Date; log?: { warn: (o: object, m: string) => void } }) {
  const now = () => (deps.now ? deps.now() : new Date());

  /** One pass. Safe to run often and from several servers: the first to claim a (checklist, venue, day) sends it. */
  async function run(): Promise<{ checked: number; sent: number }> {
    if (!deps.mailer) return { checked: 0, sent: 0 };
    const t = now(); const date = ukDate(t); const clock = ukClock(t);
    let checked = 0; let sent = 0;
    const members = new Map<string, MemberRow[]>(); const sites = new Map<string, Awaited<ReturnType<Repo['listSites']>>>();
    for (const l of await deps.store.listDueChecklists()) {
      if (!l.due_time || !l.remind_days.includes(clock.dow)) continue;
      const late = clock.minutes - dueMinutes(l.due_time);
      if (late < 0 || late > REMIND_WINDOW_MINUTES) continue;
      if (!sites.has(l.org_id)) sites.set(l.org_id, await deps.repo.listSites(l.org_id));
      for (const site of sites.get(l.org_id)!.filter((s) => l.site_id === null || s.id === l.site_id)) {
        checked++;
        const runRow = await deps.store.getRun(l.id, site.id, date);
        if (runRow?.completed_at) continue;
        if (!(await deps.store.claimReminder(l.id, site.id, date))) continue;
        if (!members.has(l.org_id)) members.set(l.org_id, await deps.repo.listMembers(l.org_id));
        const done = Object.keys(runRow?.ticks ?? {}).filter((k) => l.items.some((i) => i.id === k)).length;
        for (const to of recipientsFor(members.get(l.org_id)!, site.id)) {
          const r = await deps.mailer.send(checklistReminderEmail({ to, checklist: l.title, venue: site.name, due: l.due_time, done, total: l.items.length, url: `${deps.publicUrl.replace(/\/$/, '')}/manage/#/operations` }));
          if (r === 'sent') sent++; else deps.log?.warn({ checklist: l.id, site: site.id, result: r }, 'checklist reminder not sent');
        }
      }
    }
    return { checked, sent };
  }
  return { run };
}
export type Reminders = ReturnType<typeof createReminders>;
