import type { Membership, Role } from './permissions.js';

export interface OrgRow { id: string; name: string; slug: string }
export interface SiteRow { id: string; org_id: string; name: string; slug: string; created_at: string | null }
export interface MemberRow {
  id: string; org_id: string; site_id: string | null; user_id: string | null; email: string;
  display_name: string | null; role: Role; status: 'invited' | 'active' | 'disabled'; created_at: string;
}
export interface ApiKeyRow {
  id: string; org_id: string; site_id: string | null; name: string; scopes: string[]; key_prefix: string;
  key_hash: string; created_by: string | null; created_at: string; last_used_at: string | null;
  expires_at: string | null; revoked_at: string | null;
}
export interface NewMember { org_id: string; site_id: string | null; email: string; display_name?: string | null; role: Role; status: 'invited' | 'active' }
export interface NewApiKey { org_id: string; site_id: string | null; name: string; scopes: string[]; key_prefix: string; key_hash: string; created_by: string | null; expires_at: string | null }

/** Everything the identity/tenancy modules need from storage. Swappable (Supabase in prod, in-memory in tests). */
export interface Repo {
  membershipsForUser(userId: string, email: string): Promise<Membership[]>;
  /** Attach an auth user id to any not-yet-linked member rows with this email (first sign-in). */
  linkUser(email: string, userId: string): Promise<void>;
  getOrg(orgId: string): Promise<OrgRow | null>;
  listSites(orgId: string, onlySiteIds?: string[]): Promise<SiteRow[]>;
  getSite(siteId: string): Promise<SiteRow | null>;
  listMembers(orgId: string, siteId?: string | null): Promise<MemberRow[]>;
  getMember(orgId: string, memberId: string): Promise<MemberRow | null>;
  createMember(m: NewMember): Promise<MemberRow>;
  updateMember(memberId: string, patch: { role?: Role; status?: 'invited' | 'active' | 'disabled' }): Promise<MemberRow>;
  countActiveOwners(orgId: string): Promise<number>;
  insertApiKey(k: NewApiKey): Promise<ApiKeyRow>;
  listApiKeys(orgId: string): Promise<ApiKeyRow[]>;
  revokeApiKey(orgId: string, keyId: string): Promise<boolean>;
  findApiKeyByHash(hash: string): Promise<ApiKeyRow | null>;
  touchApiKey(keyId: string): Promise<void>;
}
