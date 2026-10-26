import type { ItemRow } from '../knowledge/store.js';
import type { Comms } from '../communicate/service.js';
import type { Ops } from '../operations/service.js';
import type { Training } from '../training/service.js';

/** Who is asking, as the work sources need it. */
export interface WorkWho { orgId: string; siteId: string; email: string; teamIds: string[] }
/** A page the chat can search and quote, built from Operations, Communicate or Training. */
export interface WorkDoc { id: string; title: string; body: string }
/** What this person has to do (short lines) and what the chat can search for answers. */
export interface WorkContext { notes: string[]; docs: WorkDoc[] }

/** Wrap a work page as a published document so it is searched exactly like Knowledge. Visibility was already applied. */
export function asItem(orgId: string, d: WorkDoc): ItemRow {
  return { id: d.id, org_id: orgId, kind: 'document', title: d.title, status: 'published', site_id: null, team_id: null, body: d.body, url: null, description: null, doc_filename: null, video_id: null, image_id: null,
    source: 'manager', source_question: null, created_by: null, created_at: '', updated_at: '', published_at: null };
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
const KIND = { opening: 'opening', closing: 'closing', custom: 'other' } as const;

/**
 * Everything the chat should know about a person's work: today's checklists, updates and courses.
 * Only what this person may see. Quiz answers are never included. Each part fails on its own, so a slow or broken source never stops an answer.
 */
export function createWork(deps: { ops: Ops | null; comms: Comms | null; training: Training | null }) {
  return async function work(who: WorkWho): Promise<WorkContext> {
    const [today, feed, courses, outlines] = await Promise.all([
      deps.ops ? deps.ops.today(who.orgId, who.siteId).catch(() => []) : [],
      deps.comms ? deps.comms.feed(who).catch(() => []) : [],
      deps.training ? deps.training.listFor(who).catch(() => []) : [],
      deps.training ? deps.training.outlinesFor(who).catch(() => []) : [],
    ]);
    const notes: string[] = []; const docs: WorkDoc[] = [];
    for (const t of today) {
      const r = t.run; const due = t.checklist.due_time ? `, due by ${t.checklist.due_time}` : '';
      notes.push(`Checklist "${t.checklist.title}" (${t.checklist.kind}): ${r.completed_at ? 'done today' : r.started ? `${r.done} of ${r.total} items ticked${due}` : `not started${due}`}`);
      docs.push({ id: t.checklist.id, title: `Checklist: ${t.checklist.title}`, body: `${t.checklist.title} is an ${KIND[t.checklist.kind]} checklist${t.checklist.due_time ? `, to be done by ${t.checklist.due_time}` : ''}. Its items, in order:\n${t.checklist.items.map((i, n) => `${n + 1}. ${i.text}`).join('\n')}` });
    }
    for (const u of feed) {
      if (!u.read_at || (u.requires_ack && !u.acked_at)) notes.push(`Update "${u.title}": ${u.requires_ack && u.read_at ? 'needs confirming' : u.requires_ack ? 'not read yet, needs confirming' : 'not read yet'}`);
      docs.push({ id: u.id, title: `Update: ${u.title}`, body: `${u.title}. Posted ${day(u.created_at)}.\n\n${u.body}` });
    }
    for (const c of courses) if (c.status !== 'done') notes.push(`Training "${c.title}": ${c.status === 'renew' ? 'due a refresher' : 'not done yet'}`);
    for (const c of outlines) docs.push({ id: c.id, title: `Training: ${c.title}`, body: [c.description, ...c.lessons.map((l) => `${l.title}\n${l.body}`)].filter(Boolean).join('\n\n') });
    return { notes, docs };
  };
}
