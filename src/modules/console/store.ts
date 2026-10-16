import type { Db } from '../../lib/supabase.js';
import type { Conversation } from '../insights/analyze.js';
import type { NpsScore } from './intel.js';

export interface OrgRow { id: string; name: string; slug: string; created_at: string }
export interface SiteRow { id: string; org_id: string; name: string; created_at: string | null; billing_tier: 'standard' | 'large'; active: boolean }
export interface MemberLite { org_id: string; site_id: string | null; email: string; display_name: string | null; role: string; status: string }
export interface UsageLite { site_id: string; ai_questions: number; flagged_at: string | null }

/** Everything the Console reads, across ALL customers. Server-side only, behind the staff check. */
export interface ConsoleStore {
  orgs(): Promise<OrgRow[]>;
  sites(): Promise<SiteRow[]>;
  members(): Promise<MemberLite[]>;
  usage(month: string): Promise<UsageLite[]>;
  conversations(sinceIso: string): Promise<Conversation[]>;
  nps(sinceIso: string): Promise<NpsScore[]>;
}

const enc = encodeURIComponent;
export const CONSOLE_CONVERSATION_LIMIT = 5000;

export function createSupabaseConsoleStore(db: Db): ConsoleStore {
  const get = async <T>(path: string, what: string): Promise<T[]> => {
    const r = await db.rest<T[]>(path);
    if (r.status >= 300) throw new Error(`console store: ${what} failed (${r.status})`);
    return r.data ?? [];
  };
  return {
    orgs: () => get('/organisations?select=id,name,slug,created_at&order=created_at.asc&limit=5000', 'orgs'),
    async sites() { return (await get<SiteRow & { org_id: string | null }>('/venues?select=id,org_id,name,created_at,billing_tier,active&limit=20000', 'sites')).filter((s) => s.org_id) as SiteRow[]; },
    members: () => get('/members?select=org_id,site_id,email,display_name,role,status&limit=50000', 'members'),
    usage: (month) => get(`/usage_monthly?month=eq.${enc(month)}&select=site_id,ai_questions,flagged_at&limit=50000`, 'usage'),
    conversations: (since) => get(`/conversations?created_at=gte.${enc(since)}&select=id,venue_id,email,created_at,messages&order=created_at.desc&limit=${CONSOLE_CONVERSATION_LIMIT}`, 'conversations'),
    nps: (since) => get(`/nps_scores?created_at=gte.${enc(since)}&select=vendor,score,comment,created_at&limit=20000`, 'nps'),
  };
}
