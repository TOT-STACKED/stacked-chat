import { announcementEmail, type Mailer } from '../../lib/email.js';
import { badRequest, notFound } from '../../lib/errors.js';
import type { MemberRow, Repo, TeamRow } from '../../lib/repo.js';
import type { AnnouncementRow, CommsStore, ReadRow } from './store.js';

export const MAX_TITLE = 120;
export const MAX_BODY = 3000;
export const MAX_EMAILS = 500;
/** How far back staff see updates. Managers see everything. */
export const FEED_DAYS = 60;

export interface Audience { site_id: string | null; team_id: string | null }
export interface Stats { recipients: number; read: number; acked: number }
export interface Person { email: string; name: string; read_at: string | null; acked_at: string | null }
export interface FeedItem { id: string; title: string; body: string; requires_ack: boolean; created_by: string | null; created_at: string; audience: Audience; read_at: string | null; acked_at: string | null }
export interface Who { orgId: string; siteId: string; email: string; teamIds: string[] }

const clean = (s: string) => s.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const nameOf = (m: { email: string; display_name: string | null }) => m.display_name?.trim() || (m.email.split('@')[0] ?? m.email);

/** Who an update is for: a team's members, or the people at a venue, or everyone who works at a venue. Company-level admins are the senders, so they are not counted as recipients unless they are in the team. */
export function recipientsOf(a: Audience, members: MemberRow[], links: Array<{ member_id: string; team_id: string }>): MemberRow[] {
  const active = members.filter((m) => m.status === 'active' && m.email);
  let pick: MemberRow[];
  if (a.team_id) { const ids = new Set(links.filter((l) => l.team_id === a.team_id).map((l) => l.member_id)); pick = active.filter((m) => ids.has(m.id)); }
  else if (a.site_id) pick = active.filter((m) => m.site_id === a.site_id);
  else pick = active.filter((m) => m.site_id !== null);
  const seen = new Set<string>();
  return pick.filter((m) => { const k = m.email.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Does this person (at this venue, in these teams) see the update? Same rule as published knowledge. */
export function visibleTo(a: Audience, who: { siteId: string; teamIds: string[] }): boolean {
  if (a.team_id) return who.teamIds.includes(a.team_id);
  return a.site_id === null || a.site_id === who.siteId;
}

export function createComms(deps: { store: CommsStore; repo: Repo; mailer?: Mailer | null; publicUrl: string; now?: () => Date }) {
  const { store, repo } = deps; const now = () => (deps.now ? deps.now() : new Date());

  async function audienceFor(orgId: string, a: { site_id?: string | null; team_id?: string | null }): Promise<Audience> {
    if (a.team_id) {
      const t = await repo.getTeam(orgId, a.team_id);
      if (!t) throw badRequest('That team is not part of this company');
      return { site_id: t.site_id, team_id: t.id };
    }
    if (a.site_id) {
      if (!(await repo.listSites(orgId)).some((s) => s.id === a.site_id)) throw badRequest('That venue is not part of this company');
      return { site_id: a.site_id, team_id: null };
    }
    return { site_id: null, team_id: null };
  }
  function check(title: string, body: string) {
    const t = title.replace(/\s+/g, ' ').trim(); const b = clean(body);
    if (!t) throw badRequest('Give the update a title');
    if (t.length > MAX_TITLE) throw badRequest(`The title can be up to ${MAX_TITLE} characters`);
    if (!b) throw badRequest('Write the message');
    if (b.length > MAX_BODY) throw badRequest(`The message can be up to ${MAX_BODY.toLocaleString('en-GB')} characters`);
    return { title: t, body: b };
  }

  async function create(orgId: string, o: { title: string; body: string; site_id?: string | null; team_id?: string | null; requires_ack?: boolean; email?: boolean; by: string; byName?: string }): Promise<{ item: AnnouncementRow; emailed: number }> {
    const aud = await audienceFor(orgId, o); const { title, body } = check(o.title, o.body);
    const item = await store.insert({ org_id: orgId, ...aud, title, body, requires_ack: !!o.requires_ack, created_by: o.by });
    let emailed = 0;
    if (o.email && deps.mailer) {
      const org = await repo.getOrg(orgId);
      const people = recipientsOf(aud, await repo.listMembers(orgId), await repo.listMemberTeams(orgId)).slice(0, MAX_EMAILS);
      for (const p of people) {
        const r = await deps.mailer.send(announcementEmail({ to: p.email, org: org?.name ?? 'your company', title, body, from: o.byName ?? o.by, ask: item.requires_ack, url: `${deps.publicUrl.replace(/\/$/, '')}/chat/` }));
        if (r === 'sent') emailed++;
      }
    }
    return { item, emailed };
  }
  async function update(orgId: string, id: string, p: { title?: string; body?: string; requires_ack?: boolean }): Promise<AnnouncementRow> {
    const cur = await store.get(orgId, id); if (!cur) throw notFound('Update not found');
    const c = check(p.title ?? cur.title, p.body ?? cur.body);
    return store.update(id, { title: c.title, body: c.body, ...(p.requires_ack !== undefined ? { requires_ack: p.requires_ack } : {}) });
  }
  async function remove(orgId: string, id: string): Promise<void> { if (!(await store.get(orgId, id))) throw notFound('Update not found'); await store.remove(id); }
  const get = (orgId: string, id: string) => store.get(orgId, id);

  const statsFor = (a: AnnouncementRow, members: MemberRow[], links: Array<{ member_id: string; team_id: string }>, reads: ReadRow[]): Stats => {
    const rec = new Set(recipientsOf(a, members, links).map((m) => m.email.toLowerCase()));
    const mine = reads.filter((r) => r.announcement_id === a.id && rec.has(r.email.toLowerCase()));
    return { recipients: rec.size, read: mine.length, acked: mine.filter((r) => r.acked_at).length };
  };
  /** For managers: the latest updates with how many people have read each. `visible` narrows to what this manager may see. */
  async function list(orgId: string, visible: (a: AnnouncementRow) => boolean): Promise<Array<{ item: AnnouncementRow; stats: Stats }>> {
    const rows = (await store.list(orgId, 100)).filter(visible);
    const [members, links, reads] = await Promise.all([repo.listMembers(orgId), repo.listMemberTeams(orgId), store.reads(rows.map((r) => r.id))]);
    return rows.map((item) => ({ item, stats: statsFor(item, members, links, reads) }));
  }
  /** Who has read it, and who has not. */
  async function readers(orgId: string, id: string): Promise<{ item: AnnouncementRow; stats: Stats; people: Person[] } | null> {
    const item = await store.get(orgId, id); if (!item) return null;
    const [members, links, reads] = await Promise.all([repo.listMembers(orgId), repo.listMemberTeams(orgId), store.reads([id])]);
    const people = recipientsOf(item, members, links).map((m) => { const r = reads.find((x) => x.email.toLowerCase() === m.email.toLowerCase()); return { email: m.email, name: nameOf(m), read_at: r?.read_at ?? null, acked_at: r?.acked_at ?? null }; })
      .sort((a, b) => Number(!!a.read_at) - Number(!!b.read_at) || a.name.localeCompare(b.name));
    return { item, stats: statsFor(item, members, links, reads), people };
  }

  /** What staff see: updates for their venue and teams, newest first, with their own read state. */
  async function feed(who: Who): Promise<FeedItem[]> {
    const since = new Date(now().getTime() - FEED_DAYS * 86_400_000).toISOString();
    const rows = (await store.list(who.orgId, 100)).filter((r) => r.created_at >= since && visibleTo(r, who)).slice(0, 40);
    const reads = await store.reads(rows.map((r) => r.id));
    return rows.map((r) => { const mine = reads.find((x) => x.announcement_id === r.id && x.email.toLowerCase() === who.email.toLowerCase());
      return { id: r.id, title: r.title, body: r.body, requires_ack: r.requires_ack, created_by: r.created_by, created_at: r.created_at, audience: { site_id: r.site_id, team_id: r.team_id }, read_at: mine?.read_at ?? null, acked_at: mine?.acked_at ?? null }; });
  }
  async function markRead(who: Who, id: string, ack: boolean): Promise<void> {
    const a = await store.get(who.orgId, id);
    if (!a || !visibleTo(a, who)) throw notFound('Update not found');
    if (ack && !a.requires_ack) throw badRequest('This update does not need confirming');
    await store.markRead(id, who.email.toLowerCase(), ack, now().toISOString());
  }

  return { create, update, remove, get, list, readers, feed, markRead, audienceFor };
}
export type Comms = ReturnType<typeof createComms>;
export type { TeamRow };
