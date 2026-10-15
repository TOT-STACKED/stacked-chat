export const ROLES = ['owner', 'hq_admin', 'site_manager', 'staff', 'kiosk'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_RANK: Record<Role, number> = { owner: 50, hq_admin: 40, site_manager: 30, staff: 20, kiosk: 10 };

export interface Membership {
  memberId: string;
  orgId: string;
  /** null = the whole organisation */
  siteId: string | null;
  role: Role;
  orgName?: string | null;
  siteName?: string | null;
}
export interface UserPrincipal { kind: 'user'; userId: string; email: string; memberships: Membership[] }
export interface KeyPrincipal { kind: 'api_key'; keyId: string; orgId: string; siteId: string | null; scopes: string[] }
export type Principal = UserPrincipal | KeyPrincipal;

/**
 * Highest role the user holds that applies at this level.
 * siteId === null  -> organisation level: only organisation-wide memberships count.
 * siteId set       -> that site: organisation-wide memberships plus memberships at that site.
 */
export function bestRole(p: UserPrincipal, orgId: string, siteId: string | null): Role | null {
  let best: Role | null = null;
  for (const m of p.memberships) {
    if (m.orgId !== orgId) continue;
    const applies = siteId === null ? m.siteId === null : m.siteId === null || m.siteId === siteId;
    if (applies && (best === null || ROLE_RANK[m.role] > ROLE_RANK[best])) best = m.role;
  }
  return best;
}

export const isOrgMember = (p: UserPrincipal, orgId: string) => p.memberships.some((m) => m.orgId === orgId);
export const atLeast = (role: Role | null, min: Role) => role !== null && ROLE_RANK[role] >= ROLE_RANK[min];

/** Who may see/manage members at a given scope. */
export const canReadMembers = (p: UserPrincipal, orgId: string, siteId: string | null) => atLeast(bestRole(p, orgId, siteId), siteId === null ? 'hq_admin' : 'site_manager');
export const canManageMembers = canReadMembers;
export const canManageApiKeys = (p: UserPrincipal, orgId: string) => atLeast(bestRole(p, orgId, null), 'hq_admin');

/**
 * Role-assignment ceiling: you can only grant roles BELOW your own, except owners, who can grant any.
 * This stops a site manager promoting themselves or a friend to organisation admin.
 */
export function canAssignRole(actor: Role, target: Role): boolean {
  return actor === 'owner' || ROLE_RANK[target] < ROLE_RANK[actor];
}
/** owner / hq_admin are organisation-wide; site_manager and kiosk belong to a site; staff may be either. */
export function roleScopeValid(role: Role, siteId: string | null): boolean {
  if (role === 'owner' || role === 'hq_admin') return siteId === null;
  if (role === 'site_manager' || role === 'kiosk') return siteId !== null;
  return true;
}
