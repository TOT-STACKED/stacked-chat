import { randomUUID } from 'node:crypto';
import { conflict } from '../src/lib/errors.js';
import type { Membership, Role } from '../src/lib/permissions.js';
import type { ApiKeyRow, MemberRow, NewApiKey, NewMember, OrgRow, Repo, SiteRow } from '../src/lib/repo.js';
import type { TokenVerifier } from '../src/lib/auth.js';

/** In-memory Repo that behaves like the Supabase one (unique member per org/site/email, etc). */
export class FakeRepo implements Repo {
  orgs: OrgRow[] = [];
  sites: SiteRow[] = [];
  members: MemberRow[] = [];
  keys: ApiKeyRow[] = [];
  touched: string[] = [];

  addOrg(name: string): OrgRow { const o = { id: randomUUID(), name, slug: name.toLowerCase().replace(/\W+/g, '-') }; this.orgs.push(o); return o; }
  addSite(org: OrgRow, name: string): SiteRow { const s = { id: randomUUID(), org_id: org.id, name, slug: name.toLowerCase().replace(/\W+/g, '-'), created_at: new Date().toISOString() }; this.sites.push(s); return s; }
  addMember(org: OrgRow, email: string, role: Role, site: SiteRow | null = null, userId: string | null = null, status: MemberRow['status'] = 'active'): MemberRow {
    const m: MemberRow = { id: randomUUID(), org_id: org.id, site_id: site?.id ?? null, user_id: userId, email: email.toLowerCase(), display_name: null, role, status, created_at: new Date().toISOString() };
    this.members.push(m); return m;
  }

  async membershipsForUser(userId: string, email: string): Promise<Membership[]> {
    return this.members
      .filter((m) => m.status === 'active' && (m.user_id === userId || (m.user_id === null && m.email === email.toLowerCase())))
      .map((m) => ({ memberId: m.id, orgId: m.org_id, siteId: m.site_id, role: m.role,
        orgName: this.orgs.find((o) => o.id === m.org_id)?.name ?? null, siteName: this.sites.find((s) => s.id === m.site_id)?.name ?? null }));
  }
  async linkUser(email: string, userId: string) { for (const m of this.members) if (m.email === email.toLowerCase() && m.user_id === null) m.user_id = userId; }
  async getOrg(id: string) { return this.orgs.find((o) => o.id === id) ?? null; }
  async listSites(orgId: string, only?: string[]) { return this.sites.filter((s) => s.org_id === orgId && (!only || only.includes(s.id))); }
  async getSite(id: string) { return this.sites.find((s) => s.id === id) ?? null; }
  async listMembers(orgId: string, siteId?: string | null) {
    return this.members.filter((m) => m.org_id === orgId && (siteId === undefined || m.site_id === siteId));
  }
  async getMember(orgId: string, id: string) { return this.members.find((m) => m.id === id && m.org_id === orgId) ?? null; }
  async createMember(n: NewMember) {
    if (this.members.some((m) => m.org_id === n.org_id && m.site_id === n.site_id && m.email === n.email.toLowerCase())) throw conflict('That already exists');
    return this.addMember({ id: n.org_id, name: '', slug: '' }, n.email, n.role, n.site_id ? { id: n.site_id } as SiteRow : null, null, n.status);
  }
  async updateMember(id: string, patch: { role?: Role; status?: MemberRow['status'] }) {
    const m = this.members.find((x) => x.id === id)!;
    if (patch.role) m.role = patch.role;
    if (patch.status) m.status = patch.status;
    return m;
  }
  async countActiveOwners(orgId: string) { return this.members.filter((m) => m.org_id === orgId && m.role === 'owner' && m.status === 'active').length; }
  async insertApiKey(k: NewApiKey) {
    const row: ApiKeyRow = { id: randomUUID(), created_at: new Date().toISOString(), last_used_at: null, revoked_at: null, ...k };
    this.keys.push(row); return row;
  }
  async listApiKeys(orgId: string) { return this.keys.filter((k) => k.org_id === orgId); }
  async revokeApiKey(orgId: string, id: string) {
    const k = this.keys.find((x) => x.id === id && x.org_id === orgId && !x.revoked_at);
    if (!k) return false; k.revoked_at = new Date().toISOString(); return true;
  }
  async findApiKeyByHash(h: string) { return this.keys.find((k) => k.key_hash === h) ?? null; }
  async touchApiKey(id: string) { this.touched.push(id); }
}

/** token string -> verified user. Anything else is an invalid session. */
export function fakeVerifier(users: Record<string, { userId: string; email: string }>): TokenVerifier {
  return async (token) => users[token] ?? null;
}
