import { badRequest } from '../../lib/errors.js';
import type { Knowledge } from '../knowledge/service.js';
import type { ItemRow } from '../knowledge/store.js';
import { extractAsks, groupAsks, unansweredGroups, type Ask } from './analyze.js';
import { blankDraft, type AnswerDrafter } from './drafter.js';
import type { InsightsStore } from './store.js';

export const WINDOWS = [7, 30, 90] as const;

export interface InsightsDeps {
  store: InsightsStore;
  knowledge: Knowledge;
  drafter?: AnswerDrafter | null;
  now?: () => Date;
}

/** Pick up to 3 short excerpts from published documents that share words with the question. */
export function findContext(items: ItemRow[], question: string): string[] {
  const words = [...new Set(question.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3))];
  if (!words.length) return [];
  return items.filter((i) => i.kind === 'document' && i.status === 'published' && i.body)
    .map((i) => {
      const body = i.body!; const lower = body.toLowerCase();
      const hits = words.filter((w) => lower.includes(w));
      const at = hits.length ? lower.indexOf(hits[0]!) : 0;
      return { hits: hits.length, text: `[${i.title}]\n${body.slice(Math.max(0, at - 150), at + 650).trim()}` };
    })
    .filter((x) => x.hits > 0).sort((a, b) => b.hits - a.hits).slice(0, 3).map((x) => x.text);
}

export function createInsights(deps: InsightsDeps) {
  const { store, knowledge } = deps;
  const now = () => (deps.now ?? (() => new Date()))();

  async function asksFor(siteIds: string[], days: number): Promise<{ asks: Ask[]; conversations: number }> {
    const since = new Date(now().getTime() - days * 86_400_000).toISOString();
    const convs = await store.conversations(siteIds, since);
    return { asks: extractAsks(convs), conversations: convs.length };
  }

  /** Everything the Insights screen shows, for the venues this person may see. */
  async function compute(orgId: string, o: { days: number; siteIds: string[] }) {
    if (!(WINDOWS as readonly number[]).includes(o.days)) throw badRequest('days must be 7, 30 or 90');
    const [{ asks, conversations }, sites, teamsOf, items] = await Promise.all([asksFor(o.siteIds, o.days), store.sites(orgId), store.memberTeams(orgId), knowledge.list(orgId)]);
    const siteName = new Map(sites.map((s) => [s.id, s.name]));
    const drafted = new Map(items.filter((i) => i.source_question).map((i) => [i.source_question!, i]));

    const unanswered = unansweredGroups(asks);
    const unansweredAsks = asks.filter((a) => a.unanswered).length;

    const teamsByEmail = new Map(teamsOf.map((m) => [m.email, m.teams]));
    const byTeam = new Map<string, number>();
    for (const a of asks) {
      const teams = (a.email && teamsByEmail.get(a.email)) || [];
      for (const t of teams.length ? teams : ['No team']) byTeam.set(t, (byTeam.get(t) ?? 0) + 1);
    }
    const bySite = new Map<string, number>();
    for (const a of asks) if (a.site_id) bySite.set(a.site_id, (bySite.get(a.site_id) ?? 0) + 1);

    return {
      days: o.days,
      totals: {
        questions: asks.length, conversations,
        people: new Set(asks.map((a) => a.email).filter(Boolean)).size,
        unanswered: unansweredAsks,
        answer_rate: asks.length ? Math.round(((asks.length - unansweredAsks) / asks.length) * 1000) / 1000 : null,
      },
      most_asked: groupAsks(asks).slice(0, 10).map(({ key, question, count, sites: n }) => ({ key, question, count, sites: n })),
      unanswered: unanswered.slice(0, 25).map((g) => ({
        key: g.key, question: g.question, count: g.count, sites: g.sites, site_names: g.site_ids.map((id) => siteName.get(id) ?? 'A site'), last_asked: g.last_asked,
        draft_item_id: drafted.get(g.key)?.id ?? null, draft_status: drafted.get(g.key)?.status ?? null,
      })),
      by_team: [...byTeam].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      by_site: [...bySite].map(([id, count]) => ({ site_id: id, name: siteName.get(id) ?? 'A site', count })).sort((a, b) => b.count - a.count),
    };
  }

  /**
   * Turn unanswered questions into DRAFT knowledge items (never published). The question text comes from our own
   * analysis, not from the caller. A question that already has a draft is skipped.
   */
  async function draftAnswers(orgId: string, o: { keys: string[]; days: number; siteIds: string[]; by: string; canWriteTo: (siteId: string | null) => boolean }) {
    const { asks } = await asksFor(o.siteIds, o.days);
    const groups = new Map(unansweredGroups(asks).map((g) => [g.key, g]));
    const items = await knowledge.list(orgId);
    const have = new Set(items.map((i) => i.source_question).filter(Boolean));
    const titles = new Set(items.filter((i) => i.kind === 'document').map((i) => (i.doc_filename ?? i.title).toLowerCase()));
    const created: Array<{ key: string; item_id: string; title: string; site_id: string | null }> = [];
    const skipped: Array<{ key: string; reason: 'already_drafted' | 'not_found' | 'not_allowed' | 'failed' }> = [];
    let ai = false;

    for (const key of [...new Set(o.keys)].slice(0, 10)) {
      const g = groups.get(key);
      if (!g) { skipped.push({ key, reason: 'not_found' }); continue; }
      if (have.has(key)) { skipped.push({ key, reason: 'already_drafted' }); continue; }
      // aimed at the people who asked: their site if it was one, otherwise the whole company (or the first site you may write to)
      let site: string | null = g.site_ids.length === 1 ? g.site_ids[0]! : null;
      if (!o.canWriteTo(site)) site = g.site_ids.find((id) => o.canWriteTo(id)) ?? null;
      if (!o.canWriteTo(site)) { skipped.push({ key, reason: 'not_allowed' }); continue; }

      const written = deps.drafter ? await deps.drafter.draft(g.question, findContext(items, g.question)) : null;
      if (written) ai = true;
      let title = g.question.slice(0, 120); for (let n = 2; titles.has(title.toLowerCase()); n++) title = `${g.question.slice(0, 110)} (${n})`;
      try {
        const item = await knowledge.createDocument(orgId, { title, body: written ?? blankDraft(g.question), site_id: site, status: 'draft', by: o.by, source: 'ai_draft', source_question: key });
        titles.add(title.toLowerCase()); have.add(key);
        created.push({ key, item_id: item.id, title, site_id: site });
      } catch { skipped.push({ key, reason: 'failed' }); }
    }
    return { created, skipped, ai };
  }

  return { compute, draftAnswers };
}

export type Insights = ReturnType<typeof createInsights>;
