import { randomUUID } from 'node:crypto';
import { badRequest, notFound } from '../../lib/errors.js';
import type { ChecklistItem, ChecklistKind, ChecklistRow, OpsStore, RunRow, Tick } from './store.js';

export const MAX_ITEMS = 60;
export const MAX_ITEM_CHARS = 200;
export const KINDS: ChecklistKind[] = ['opening', 'closing', 'custom'];
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DUE = /^([01]\d|2[0-3]):[0-5]\d$/;
function dueTime(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !DUE.test(v)) throw badRequest('Choose a time like 09:30');
  return v;
}
function days(v: unknown): number[] {
  if (v === undefined) return ALL_DAYS;
  const d = [...new Set((v as unknown[]).map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).sort();
  if (!d.length) throw badRequest('Choose at least one day for the reminder');
  return d;
}

/** The venue's day: UK time, so a closing checklist done at 1am still belongs to the evening before only if the venue says so (it does not: it is the calendar date in the UK). */
export function ukDate(d: Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }

/** Lines of text become items. Blank lines go, and items that were already there keep their id so earlier ticks stay valid. */
export function cleanItems(input: string[], existing: ChecklistItem[] = []): ChecklistItem[] {
  const texts = input.map((t) => String(t).replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!texts.length) throw badRequest('Add at least one item');
  if (texts.length > MAX_ITEMS) throw badRequest(`A checklist can have up to ${MAX_ITEMS} items`);
  if (texts.some((t) => t.length > MAX_ITEM_CHARS)) throw badRequest(`Each item can be up to ${MAX_ITEM_CHARS} characters`);
  const pool = [...existing];
  return texts.map((text) => {
    const i = pool.findIndex((e) => e.text === text);
    if (i >= 0) return pool.splice(i, 1)[0]!;
    return { id: randomUUID().slice(0, 8), text };
  });
}

export interface RunView { done: number; total: number; ticks: Record<string, Tick>; started: boolean; completed_at: string | null; completed_by: string | null; note: string | null }
export interface Today { checklist: ChecklistRow; run: RunView }
export interface BoardRow { checklist: ChecklistRow; site_id: string; run: RunView }
export interface Who { orgId: string; siteId: string; email: string }

const view = (list: ChecklistRow, run: RunRow | null): RunView => {
  const ids = new Set(list.items.map((i) => i.id));
  const ticks = Object.fromEntries(Object.entries(run?.ticks ?? {}).filter(([k]) => ids.has(k)));
  return { done: Object.keys(ticks).length, total: list.items.length, ticks, started: Object.keys(ticks).length > 0, completed_at: run?.completed_at ?? null, completed_by: run?.completed_by ?? null, note: run?.note ?? null };
};
const applies = (l: ChecklistRow, siteId: string) => l.active && (l.site_id === null || l.site_id === siteId);

export function createOps(deps: { store: OpsStore; now?: () => Date }) {
  const { store } = deps; const now = () => (deps.now ? deps.now() : new Date());

  async function assertSite(orgId: string, siteId: string | null) {
    if (siteId && !(await store.siteIds(orgId)).includes(siteId)) throw badRequest('That venue is not part of this company');
  }
  function title(t: unknown): string {
    const s = String(t ?? '').replace(/\s+/g, ' ').trim();
    if (!s) throw badRequest('Give the checklist a title');
    if (s.length > 120) throw badRequest('That title is too long (120 characters at most)');
    return s;
  }
  const kind = (k: unknown): ChecklistKind => { if (!KINDS.includes(k as ChecklistKind)) throw badRequest('Choose opening, closing or custom'); return k as ChecklistKind; };

  async function create(orgId: string, o: { title: string; kind: ChecklistKind; site_id: string | null; items: string[]; due_time?: string | null; remind_days?: number[]; by: string }): Promise<ChecklistRow> {
    await assertSite(orgId, o.site_id);
    return store.insertChecklist({ org_id: orgId, site_id: o.site_id, title: title(o.title), kind: kind(o.kind), items: cleanItems(o.items), active: true, due_time: dueTime(o.due_time), remind_days: days(o.remind_days), created_by: o.by });
  }
  async function update(orgId: string, id: string, p: { title?: string; kind?: ChecklistKind; site_id?: string | null; items?: string[]; active?: boolean; due_time?: string | null; remind_days?: number[] }): Promise<ChecklistRow> {
    const cur = await store.getChecklist(orgId, id);
    if (!cur) throw notFound('Checklist not found');
    if (p.site_id !== undefined) await assertSite(orgId, p.site_id);
    return store.updateChecklist(id, {
      ...(p.title !== undefined ? { title: title(p.title) } : {}), ...(p.kind !== undefined ? { kind: kind(p.kind) } : {}),
      ...(p.site_id !== undefined ? { site_id: p.site_id } : {}), ...(p.items !== undefined ? { items: cleanItems(p.items, cur.items) } : {}),
      ...(p.active !== undefined ? { active: p.active } : {}),
      ...(p.due_time !== undefined ? { due_time: dueTime(p.due_time) } : {}), ...(p.remind_days !== undefined ? { remind_days: days(p.remind_days) } : {}),
    });
  }
  async function remove(orgId: string, id: string): Promise<void> {
    if (!(await store.getChecklist(orgId, id))) throw notFound('Checklist not found');
    await store.deleteChecklist(id);
  }

  /** What staff at one venue see today: the lists for that venue (and the whole company), with today's ticks. */
  async function today(orgId: string, siteId: string): Promise<Today[]> {
    const date = ukDate(now());
    const lists = (await store.listChecklists(orgId)).filter((l) => applies(l, siteId));
    return Promise.all(lists.map(async (l) => ({ checklist: l, run: view(l, await store.getRun(l.id, siteId, date)) })));
  }

  async function openList(who: Who, id: string): Promise<ChecklistRow> {
    const l = await store.getChecklist(who.orgId, id);
    if (!l || !applies(l, who.siteId)) throw notFound('Checklist not found');
    return l;
  }
  async function tick(who: Who, id: string, itemId: string, done: boolean): Promise<Today> {
    const l = await openList(who, id);
    if (!l.items.some((i) => i.id === itemId)) throw notFound('That item is not on this checklist');
    const key = { checklist_id: l.id, org_id: who.orgId, site_id: who.siteId, run_date: ukDate(now()) };
    const run = await store.getRun(l.id, who.siteId, key.run_date);
    if (run?.completed_at) throw badRequest('This checklist is already completed for today');
    const ticks = { ...(run?.ticks ?? {}) };
    if (done) ticks[itemId] = { by: who.email, at: now().toISOString() }; else delete ticks[itemId];
    return { checklist: l, run: view(l, await store.saveRun(key, { ticks })) };
  }
  async function complete(who: Who, id: string, note: string | null): Promise<Today> {
    const l = await openList(who, id);
    const key = { checklist_id: l.id, org_id: who.orgId, site_id: who.siteId, run_date: ukDate(now()) };
    const run = await store.getRun(l.id, who.siteId, key.run_date);
    if (run?.completed_at) return { checklist: l, run: view(l, run) };
    const v = view(l, run); const clean = note?.replace(/\s+/g, ' ').trim().slice(0, 500) || null;
    if (v.done < v.total && !clean) throw badRequest('Some items are not ticked. Tick them, or add a note to say why.');
    return { checklist: l, run: view(l, await store.saveRun(key, { completed_by: who.email, completed_at: now().toISOString(), note: clean })) };
  }

  /** For managers: every active list at every venue they run, today. */
  async function board(orgId: string, siteIds: string[], lists?: ChecklistRow[]): Promise<BoardRow[]> {
    const date = ukDate(now());
    const all = lists ?? (await store.listChecklists(orgId));
    const runs = await store.listRuns(orgId, date, date);
    const out: BoardRow[] = [];
    for (const l of all.filter((x) => x.active)) for (const s of siteIds) if (applies(l, s)) out.push({ checklist: l, site_id: s, run: view(l, runs.find((r) => r.checklist_id === l.id && r.site_id === s) ?? null) });
    return out;
  }
  /** Finished and started runs for the last few days, newest first. */
  async function recent(orgId: string, siteIds: string[], days: number): Promise<Array<{ date: string; site_id: string; checklist: ChecklistRow; run: RunView }>> {
    const to = ukDate(now()); const from = ukDate(new Date(now().getTime() - (days - 1) * 86_400_000));
    const lists = new Map((await store.listChecklists(orgId)).map((l) => [l.id, l]));
    return (await store.listRuns(orgId, from, to)).filter((r) => siteIds.includes(r.site_id) && lists.has(r.checklist_id))
      .map((r) => ({ date: r.run_date, site_id: r.site_id, checklist: lists.get(r.checklist_id)!, run: view(lists.get(r.checklist_id)!, r) }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  return { list: (orgId: string) => store.listChecklists(orgId), get: (orgId: string, id: string) => store.getChecklist(orgId, id), create, update, remove, today, tick, complete, board, recent };
}
export type Ops = ReturnType<typeof createOps>;
