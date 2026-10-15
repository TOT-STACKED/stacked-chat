import type { Db, DbResult } from './supabase.js';
import { ApiHttpError, conflict } from './errors.js';
import type { Membership, Role } from './permissions.js';
import type { ApiKeyRow, MemberRow, NewApiKey, NewMember, OrgRow, Repo, SiteRow } from './repo.js';

const enc = encodeURIComponent;
const MEMBER_COLS = 'id,org_id,site_id,user_id,email,display_name,role,status,created_at';
const KEY_COLS = 'id,org_id,site_id,name,scopes,key_prefix,key_hash,created_by,created_at,last_used_at,expires_at,revoked_at';

interface RawMembership {
  id: string; org_id: string; site_id: string | null; role: Role;
  organisations?: { name: string } | null; venues?: { name: string } | null;
}

function must<T>(r: DbResult<T>, what: string): T {
  if (r.status >= 400) {
    const d = r.data as { code?: string; message?: string } | null;
    if (d && d.code === '23505') throw conflict('That already exists');
    throw new ApiHttpError(503, 'database_error', `${what} failed`);
  }
  return r.data;
}

/** PostgREST-backed implementation of Repo. All access uses the service-role key (server-side only). */
export function createSupabaseRepo(db: Db): Repo {
  const one = <T>(rows: T[] | null | undefined): T | null => (Array.isArray(rows) && rows.length ? (rows[0] as T) : null);
  const toMembership = (m: RawMembership): Membership => ({
    memberId: m.id, orgId: m.org_id, siteId: m.site_id, role: m.role,
    orgName: m.organisations?.name ?? null, siteName: m.venues?.name ?? null,
  });

  return {
    async membershipsForUser(userId, email) {
      const select = 'id,org_id,site_id,role,organisations(name),venues(name)';
      const [byUser, byEmail] = await Promise.all([
        db.rest<RawMembership[]>(`/members?user_id=eq.${enc(userId)}&status=eq.active&select=${enc(select)}`),
        // members invited by email who have not signed in yet (never someone else's linked row)
        db.rest<RawMembership[]>(`/members?email=eq.${enc(email.toLowerCase())}&user_id=is.null&status=eq.active&select=${enc(select)}`),
      ]);
      const seen = new Map<string, Membership>();
      for (const m of [...(must(byUser, 'memberships') ?? []), ...(must(byEmail, 'memberships') ?? [])]) seen.set(m.id, toMembership(m));
      return [...seen.values()];
    },

    async linkUser(email, userId) {
      must(await db.rest(`/members?email=eq.${enc(email.toLowerCase())}&user_id=is.null`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { user_id: userId },
      }), 'link user');
    },

    async getOrg(orgId) {
      return one(must(await db.rest<OrgRow[]>(`/organisations?id=eq.${enc(orgId)}&select=id,name,slug&limit=1`), 'get org'));
    },

    async listSites(orgId, onlySiteIds) {
      let q = `/venues?org_id=eq.${enc(orgId)}&select=id,org_id,name,slug,created_at&order=name.asc`;
      if (onlySiteIds) {
        if (!onlySiteIds.length) return [];
        q += `&id=in.(${onlySiteIds.map(enc).join(',')})`;
      }
      return must(await db.rest<SiteRow[]>(q), 'list sites') ?? [];
    },

    async getSite(siteId) {
      return one(must(await db.rest<SiteRow[]>(`/venues?id=eq.${enc(siteId)}&select=id,org_id,name,slug,created_at&limit=1`), 'get site'));
    },

    async listMembers(orgId, siteId) {
      let q = `/members?org_id=eq.${enc(orgId)}&select=${MEMBER_COLS}&order=created_at.asc`;
      if (siteId !== undefined) q += siteId === null ? '&site_id=is.null' : `&site_id=eq.${enc(siteId)}`;
      return must(await db.rest<MemberRow[]>(q), 'list members') ?? [];
    },

    async getMember(orgId, memberId) {
      return one(must(await db.rest<MemberRow[]>(`/members?id=eq.${enc(memberId)}&org_id=eq.${enc(orgId)}&select=${MEMBER_COLS}&limit=1`), 'get member'));
    },

    async createMember(m: NewMember) {
      const r = await db.rest<MemberRow[]>(`/members?select=${MEMBER_COLS}`, {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: { org_id: m.org_id, site_id: m.site_id, email: m.email.toLowerCase(), display_name: m.display_name ?? null, role: m.role, status: m.status },
      });
      return one(must(r, 'create member'))!;
    },

    async updateMember(memberId, patch) {
      const r = await db.rest<MemberRow[]>(`/members?id=eq.${enc(memberId)}&select=${MEMBER_COLS}`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: patch,
      });
      return one(must(r, 'update member'))!;
    },

    async countActiveOwners(orgId) {
      const rows = must(await db.rest<{ id: string }[]>(`/members?org_id=eq.${enc(orgId)}&role=eq.owner&status=eq.active&select=id`), 'count owners');
      return Array.isArray(rows) ? rows.length : 0;
    },

    async insertApiKey(k: NewApiKey) {
      const r = await db.rest<ApiKeyRow[]>(`/api_keys?select=${KEY_COLS}`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: k });
      return one(must(r, 'create api key'))!;
    },

    async listApiKeys(orgId) {
      return must(await db.rest<ApiKeyRow[]>(`/api_keys?org_id=eq.${enc(orgId)}&select=${KEY_COLS}&order=created_at.desc`), 'list api keys') ?? [];
    },

    async revokeApiKey(orgId, keyId) {
      const r = await db.rest<ApiKeyRow[]>(`/api_keys?id=eq.${enc(keyId)}&org_id=eq.${enc(orgId)}&revoked_at=is.null&select=id`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { revoked_at: new Date().toISOString() },
      });
      return (must(r, 'revoke api key') ?? []).length > 0;
    },

    async findApiKeyByHash(hash) {
      return one(must(await db.rest<ApiKeyRow[]>(`/api_keys?key_hash=eq.${enc(hash)}&select=${KEY_COLS}&limit=1`), 'find api key'));
    },

    async touchApiKey(keyId) {
      await db.rest(`/api_keys?id=eq.${enc(keyId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { last_used_at: new Date().toISOString() } });
    },
  };
}
