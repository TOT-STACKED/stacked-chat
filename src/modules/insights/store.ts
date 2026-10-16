import type { Db } from '../../lib/supabase.js';
import type { Conversation } from './analyze.js';

export interface InsightsStore {
  /** conversations at these venues since a date, newest first (capped) */
  conversations(siteIds: string[], sinceIso: string): Promise<Conversation[]>;
  sites(orgId: string): Promise<Array<{ id: string; name: string }>>;
  /** each active member's email and the names of the teams they are in */
  memberTeams(orgId: string): Promise<Array<{ email: string; teams: string[] }>>;
}

const enc = encodeURIComponent;
export const MAX_CONVERSATIONS = 2000;

export function createSupabaseInsightsStore(db: Db): InsightsStore {
  const ok = <T>(r: { status: number; data: T }, what: string): T => {
    if (r.status >= 300) throw new Error(`insights store: ${what} failed (${r.status})`);
    return r.data;
  };
  return {
    async conversations(siteIds, sinceIso) {
      if (!siteIds.length) return [];
      const ids = siteIds.map(enc).join(',');
      return ok(await db.rest<Conversation[]>(`/conversations?venue_id=in.(${ids})&created_at=gte.${enc(sinceIso)}&select=id,venue_id,email,created_at,messages&order=created_at.desc&limit=${MAX_CONVERSATIONS}`), 'conversations') ?? [];
    },
    async sites(orgId) {
      return ok(await db.rest<Array<{ id: string; name: string }>>(`/venues?org_id=eq.${enc(orgId)}&select=id,name&order=name.asc&limit=5000`), 'sites') ?? [];
    },
    async memberTeams(orgId) {
      const [members, teams] = await Promise.all([
        db.rest<Array<{ email: string; member_teams: Array<{ team_id: string }> | null }>>(`/members?org_id=eq.${enc(orgId)}&status=eq.active&select=email,member_teams(team_id)&limit=20000`),
        db.rest<Array<{ id: string; name: string }>>(`/teams?org_id=eq.${enc(orgId)}&select=id,name&limit=5000`),
      ]);
      const names = new Map((ok(teams, 'teams') ?? []).map((t) => [t.id, t.name]));
      return (ok(members, 'members') ?? []).map((m) => ({ email: m.email.toLowerCase(), teams: (m.member_teams ?? []).map((x) => names.get(x.team_id)).filter((x): x is string => !!x) }));
    },
  };
}
