// Pure logic for the Manage app (no DOM), so it can be unit-tested. Mirrors the server's rules:
// the server is always the authority, this only decides what to SHOW.
export const ROLE_ORDER = ['owner', 'hq_admin', 'site_manager', 'staff', 'kiosk'];
export const ROLE_LABEL = { owner: 'Owner', hq_admin: 'HQ admin', site_manager: 'Site manager', staff: 'Staff', kiosk: 'Kiosk' };
export const ROLE_RANK = { owner: 50, hq_admin: 40, site_manager: 30, staff: 20, kiosk: 10 };

/** Highest role held at this level. siteId === null means organisation level (org-wide roles only). */
export function bestRole(memberships, orgId, siteId) {
  let best = null;
  for (const m of memberships) {
    if (m.orgId !== orgId) continue;
    const applies = siteId === null ? m.siteId === null : m.siteId === null || m.siteId === siteId;
    if (applies && (best === null || ROLE_RANK[m.role] > ROLE_RANK[best])) best = m.role;
  }
  return best;
}
export const atLeast = (role, min) => role != null && ROLE_RANK[role] >= ROLE_RANK[min];

/** Can this person manage people at this level (organisation: HQ admin+, a site: site manager+)? */
export const canManage = (memberships, orgId, siteId) => atLeast(bestRole(memberships, orgId, siteId), siteId === null ? 'hq_admin' : 'site_manager');

/** Is this person a manager anywhere in the organisation? (staff don't use Manage) */
export const isManagerAnywhere = (memberships, orgId) =>
  memberships.some((m) => m.orgId === orgId && atLeast(m.role, 'site_manager'));

/** You can grant roles below your own; owners can grant any. */
export function grantableRoles(actorRole) {
  if (!actorRole) return [];
  if (actorRole === 'owner') return [...ROLE_ORDER];
  return ROLE_ORDER.filter((r) => ROLE_RANK[r] < ROLE_RANK[actorRole]);
}
/** owner/HQ admin are company-wide, site manager/kiosk need a site, staff may be either. */
export function roleScopeOk(role, siteId) {
  if (role === 'owner' || role === 'hq_admin') return siteId === null;
  if (role === 'site_manager' || role === 'kiosk') return siteId !== null;
  return true;
}
/** Roles you may pick for someone at this scope. */
export const rolesFor = (actorRole, siteId) => grantableRoles(actorRole).filter((r) => roleScopeOk(r, siteId));

/** Can you change this existing member? (never equal or higher rank, unless you are an owner) */
export function canEditMember(actorRole, member) {
  if (!actorRole) return false;
  return actorRole === 'owner' || ROLE_RANK[member.role] < ROLE_RANK[actorRole];
}

export function displayName(m) { return (m.display_name && m.display_name.trim()) || m.email.split('@')[0]; }
export function initials(name) {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

/** Teams that can apply to someone at this scope: company-wide ones, plus that site's own. */
export const teamsForScope = (teams, siteId) => teams.filter((t) => t.site_id === null || (siteId !== null && t.site_id === siteId));

export function countMembers(members, sites, teams) {
  const live = members.filter((m) => m.status !== 'disabled');
  const bySite = {}; const byTeam = {};
  for (const s of sites) bySite[s.id] = live.filter((m) => m.site_id === s.id).length;
  for (const t of teams) byTeam[t.id] = live.filter((m) => m.team_ids.includes(t.id)).length;
  return { total: live.length, bySite, byTeam };
}

export const MANAGER_ROLES = ['owner', 'hq_admin', 'site_manager'];
/** sel: {kind:'company'} | {kind:'site', id} | {kind:'team', id}; chip: everyone|managers|staff|invited */
export function filterMembers(members, sel, chip) {
  return members.filter((m) => {
    if (sel.kind === 'site' && m.site_id !== sel.id) return false;
    if (sel.kind === 'team' && !m.team_ids.includes(sel.id)) return false;
    if (chip === 'managers') return MANAGER_ROLES.includes(m.role);
    if (chip === 'staff') return m.role === 'staff' || m.role === 'kiosk';
    if (chip === 'invited') return m.status === 'invited';
    return true;
  });
}

/** Split pasted text (commas, spaces, new lines) into unique, valid, lower-case emails. */
export function parseEmails(text) {
  const seen = new Set(); const valid = []; const invalid = [];
  for (const raw of String(text || '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)) {
    const e = raw.toLowerCase();
    if (seen.has(e)) continue; seen.add(e);
    (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? valid : invalid).push(e);
  }
  return { valid, invalid };
}

export function statusLabel(m) { return m.status === 'invited' ? 'Invited' : m.status === 'disabled' ? 'Disabled' : 'Active'; }
export function inviteResultText(results) {
  const sent = results.filter((r) => r.invite === 'sent').length;
  const saved = results.filter((r) => r.ok && r.invite !== 'sent').length;
  const failed = results.filter((r) => !r.ok);
  const parts = [];
  if (sent) parts.push(`${sent} invitation${sent === 1 ? '' : 's'} emailed`);
  if (saved) parts.push(`${saved} saved but not emailed, use Resend invite to try again`);
  if (failed.length) parts.push(`${failed.length} could not be added (${failed.map((f) => f.email + ': ' + f.error).join('; ')})`);
  return parts.join('. ') + '.';
}

// ---- billing (display helpers; the server decides the real numbers) --------------------------------
export function formatGbp(pence) {
  const pounds = pence / 100;
  return '£' + pounds.toLocaleString('en-GB', { minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 });
}
export const INTERVAL_WORD = { month: 'month', year: 'year' };

/** "Venue", "Group", or "Venue + Large venue": whatever the lines on the bill are. */
export function planName(pricing) {
  if (!pricing || !pricing.lines.length) return 'No venues yet';
  return pricing.lines.map((l) => l.label).join(' + ');
}

/** What to tell an admin about their billing state, or null. */
export function bannerFor(state) {
  if (!state || !state.banner) return null;
  const d = state.trial_days_left;
  switch (state.banner) {
    case 'trial': return { tone: 'info', text: `Your free trial has ${d} day${d === 1 ? '' : 's'} left. Add a card before it ends so nothing is interrupted. You won't be charged until then.`, cta: 'card' };
    case 'trial_ended': return { tone: 'warn', text: 'Your free trial has ended, so your account is read-only. Add a card to carry on. Staff can still read everything.', cta: 'card' };
    case 'past_due': return { tone: 'warn', text: `Your last payment didn't go through. Update your card by ${state.grace_ends_at ? new Date(state.grace_ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : 'the end of the week'} to avoid your account becoming read-only.`, cta: 'portal' };
    case 'restricted': return { tone: 'warn', text: 'Payment is overdue, so your account is read-only. Staff can still read everything. Update your card to restore full access.', cta: 'portal' };
    case 'canceled': return { tone: 'warn', text: 'This subscription has ended. Your data is kept for 90 days. Contact Stacked to restart it.', cta: null };
    default: return null;
  }
}

/** 0..1 for a usage bar (capped, so an over-limit venue shows a full bar). */
export const usageRatio = (used, cap) => (cap > 0 ? Math.min(1, used / cap) : 0);
export const venueCountText = (n) => `${n} venue${n === 1 ? '' : 's'}`;

// ---- knowledge (display helpers) -----------------------------------------------------------------------
export const KIND_LABEL = { document: 'Document', video: 'Video', image: 'Image' };
export const KIND_ICON = { document: 'shield', video: 'screen', image: 'box' };

export function audienceLabel(item, sites) {
  if (item.site_id === null) return 'Whole company';
  return (sites.find((s) => s.id === item.site_id) || {}).name || 'A site';
}

/** kind: all|document|video|image; audience: all|company|<siteId>; q: free text (title) */
export function filterKnowledge(items, { kind = 'all', audience = 'all', q = '' } = {}) {
  const needle = String(q).trim().toLowerCase();
  return items.filter((i) => {
    if (kind !== 'all' && i.kind !== kind) return false;
    if (audience === 'company' && i.site_id !== null) return false;
    if (audience !== 'all' && audience !== 'company' && i.site_id !== audience) return false;
    return !needle || i.title.toLowerCase().includes(needle);
  });
}

export function knowledgeCounts(items) {
  const c = { all: items.length, document: 0, video: 0, image: 0, draft: 0 };
  for (const i of items) { c[i.kind]++; if (i.status === 'draft') c.draft++; }
  return c;
}
export const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
