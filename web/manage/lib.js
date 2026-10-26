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

export function displayName(m) { return (m.display_name && m.display_name.trim()) || contactOf(m); }

/** "447700900123" → "07700 900123" (other countries keep their "+" code). */
export function formatPhone(e164) {
  const m = /^\+44(\d{4})(\d{6})$/.exec(String(e164 || ''));
  return m ? `0${m[1]} ${m[2]}` : String(e164 || '');
}
const PHONE_KEY = /^(\d{8,15})@phone\.invalid$/i;
/** How to show how to reach someone: their mobile number if they sign in with one, otherwise their email. */
export function contactOf(m) { return m.phone ? formatPhone(m.phone) : PHONE_KEY.test(m.email || '') ? formatPhone('+' + m.email.split('@')[0]) : m.email; }
/** A person's sign-in address as a short, readable name for places that only have the address ("done by …"). */
export function whoIs(email) { const e = String(email || ''); return PHONE_KEY.test(e) ? formatPhone('+' + e.split('@')[0]) : e.split('@')[0]; }

/** "Amy Smith 07700 900123" or "Amy Smith, 07700 900123" per line, so a manager can paste a list. Names are needed to tell people apart. */
export function parsePeople(text) {
  const seen = new Set(); const valid = []; const invalid = [];
  for (const raw of String(text || '').split(/\n|;/).map((x) => x.trim()).filter(Boolean)) {
    const m = /(\+?\d[\d\s().-]{7,}\d)/.exec(raw);
    const digits = m ? m[1].replace(/\D/g, '') : '';
    const name = m ? raw.replace(m[1], ' ').replace(/[,:\-–]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
    if (!m || digits.length < 10 || digits.length > 15 || !name) { invalid.push(raw); continue; }
    if (seen.has(digits)) continue; seen.add(digits);
    valid.push({ name, phone: m[1].trim() });
  }
  return { valid, invalid };
}
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
  const texted = results.length > 0 && results.every((r) => r.via === 'text');
  const parts = [];
  if (sent) parts.push(`${sent} invitation${sent === 1 ? '' : 's'} ${texted ? 'texted' : 'emailed'}`);
  if (saved) parts.push(`${saved} saved but the ${texted ? 'text' : 'email'} did not go${saved === 1 ? '' : ' for each'}, use Resend invite to try again`);
  if (failed.length) parts.push(`${failed.length} could not be added (${failed.map((f) => (f.email || f.name) + ': ' + f.error).join('; ')})`);
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

export function audienceLabel(item, sites, teams = []) {
  if (item.team_id) return `Team: ${(teams.find((t) => t.id === item.team_id) || {}).name || 'a team'}`;
  if (item.site_id === null) return 'Whole company';
  return (sites.find((s) => s.id === item.site_id) || {}).name || 'A site';
}
/** The audience picker uses one value: '' (company), 'site:<id>' or 'team:<id>'. */
export function audienceValue(item) { return item && item.team_id ? `team:${item.team_id}` : item && item.site_id ? `site:${item.site_id}` : ''; }
export function audienceParams(value) {
  if (String(value).startsWith('team:')) return { site_id: null, team_id: value.slice(5) };
  if (String(value).startsWith('site:')) return { site_id: value.slice(5), team_id: null };
  return { site_id: null, team_id: null };
}

/** kind: all|document|video|image; audience: all|company|<siteId>; q: free text (title) */
export function filterKnowledge(items, { kind = 'all', audience = 'all', q = '' } = {}) {
  const needle = String(q).trim().toLowerCase();
  return items.filter((i) => {
    if (kind !== 'all' && i.kind !== kind) return false;
    if (audience === 'company' && i.site_id !== null) return false;
    // picking a venue shows what that venue's staff see: its own items plus everything aimed at the whole company
    if (audience !== 'all' && audience !== 'company' && i.site_id !== null && i.site_id !== audience) return false;
    return !needle || i.title.toLowerCase().includes(needle);
  });
}

export function knowledgeCounts(items) {
  const c = { all: items.length, document: 0, video: 0, image: 0, draft: 0 };
  for (const i of items) { c[i.kind]++; if (i.status === 'draft') c.draft++; }
  return c;
}
export const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// ---- insights (display helpers) ----------------------------------------------------------------------------
export const answerRateText = (rate) => (rate === null || rate === undefined ? 'No questions yet' : `${Math.round(rate * 100)}%`);
export const asksText = (n) => `${n} ${n === 1 ? 'ask' : 'asks'}`;
export function wherePhrase(item) {
  if (!item.sites) return '';
  if (item.sites === 1) return item.site_names && item.site_names[0] ? item.site_names[0] : '1 site';
  return `${item.sites} sites`;
}
/** Bar width (0..100) relative to the biggest value in the list. */
export const barPercent = (value, max) => (max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0);

// ---- settings (display helpers) -----------------------------------------------------------------------------
/** Only the access levels that do something today are offered when creating a key. */
export const KEY_SCOPES = [['sites:read', 'Read sites'], ['teams:read', 'Read teams'], ['members:read', 'Read people'], ['kb:read', 'Read knowledge']];
export const scopeLabel = (s) => (KEY_SCOPES.find(([k]) => k === s) || [s, s])[1];
export function keyStatus(k, now = new Date()) {
  if (k.revoked) return 'Revoked';
  if (k.expires_at && new Date(k.expires_at) < now) return 'Expired';
  return 'Active';
}
export const isHexColour = (v) => /^#[0-9a-fA-F]{6}$/.test(String(v || '').trim());
/** Lower-case so "#E87830" and "#e87830" compare equal; used to decide whether anything changed. */
export const normColour = (v) => String(v || '').trim().toLowerCase();
export function lastUsedText(iso, now = new Date()) {
  if (!iso) return 'Never';
  const days = Math.floor((now - new Date(iso)) / 86_400_000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 30 ? `${days} days ago` : shortDate(iso);
}

const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** Is a checklist past its due time right now (UK time, on a day it is checked)? The same rule the reminder email uses. */
export function pastDue(l, now = new Date()) {
  if (!l.due_time) return false;
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t) => (p.find((x) => x.type === t) || {}).value || '0';
  return (l.remind_days || []).includes(DOW[get('weekday')]) && Number(get('hour')) * 60 + Number(get('minute')) >= Number(l.due_time.slice(0, 2)) * 60 + Number(l.due_time.slice(3, 5));
}

/**
 * What needs a manager's attention right now, most urgent first. Pure, so it can be tested.
 * data: { billing, board (today rows), updates, courses, insights, knowledge, members }; anything may be missing.
 */
export function homeAttention(data, now = new Date()) {
  const out = [];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const b = data.billing;
  if (b && b.account && b.state) {
    if (b.state.mode === 'grace') out.push({ id: 'billing', tone: 'bad', icon: 'billing', title: 'Your payment is overdue', sub: 'Update your card to keep everything running.', href: '#/settings/billing', cta: 'Fix billing' });
    else if (b.state.mode !== 'full') out.push({ id: 'billing', tone: 'bad', icon: 'billing', title: 'Billing needs your attention', sub: 'Some features are paused until this is sorted.', href: '#/settings/billing', cta: 'Open billing' });
    else if (b.account.status === 'trialing' && b.state.trial_days_left <= 5) out.push({ id: 'trial', tone: 'warn', icon: 'billing', title: `Your free trial ends in ${plural(b.state.trial_days_left, 'day', 'days')}`, sub: 'Add a card so nothing stops.', href: '#/settings/billing', cta: 'Add a card' });
  }
  const late = (data.board || []).filter((t) => !t.run.completed_at && pastDue(t.checklist, now));
  if (late.length) out.push({ id: 'late', tone: 'bad', icon: 'operations', title: `${plural(late.length, 'checklist is', 'checklists are')} overdue today`, sub: late.slice(0, 2).map((t) => `${t.checklist.title}${t.siteName ? ` at ${t.siteName}` : ''}`).join(', ') + (late.length > 2 ? ` and ${late.length - 2} more` : ''), href: '#/operations', cta: 'See checklists' });
  for (const c of (data.courses || []).filter((x) => x.active && x.stats.recipients && (x.stats.todo || x.stats.renew)).sort((a, z) => z.stats.todo + z.stats.renew - (a.stats.todo + a.stats.renew)).slice(0, 2)) {
    const bits = [c.stats.todo ? `${c.stats.todo} not done` : null, c.stats.renew ? `${c.stats.renew} due a refresher` : null].filter(Boolean).join(', ');
    out.push({ id: `course-${c.id}`, tone: 'warn', icon: 'training', title: `${c.title}: ${bits}`, sub: `${c.stats.done} of ${c.stats.recipients} have signed it off.`, href: '#/training', cta: 'See who' });
  }
  const recent = now.getTime() - 14 * 86_400_000;
  for (const u of (data.updates || []).filter((x) => x.stats.recipients && new Date(x.created_at).getTime() >= recent && (x.requires_ack ? x.stats.acked : x.stats.read) < x.stats.recipients).slice(0, 2)) {
    const missing = u.stats.recipients - (u.requires_ack ? u.stats.acked : u.stats.read);
    out.push({ id: `update-${u.id}`, tone: 'info', icon: 'communicate', title: `“${u.title}”: ${plural(missing, 'person has', 'people have')} not ${u.requires_ack ? 'confirmed' : 'read'} it`, sub: `${u.stats.read} of ${u.stats.recipients} have read it.`, href: '#/communicate', cta: 'See who' });
  }
  const unanswered = ((data.insights && data.insights.unanswered) || []).filter((q) => !q.draft_item_id).length;
  if (unanswered) out.push({ id: 'unanswered', tone: 'warn', icon: 'insights', title: `${plural(unanswered, 'question', 'questions')} the AI could not answer`, sub: 'Turn them into answers your team can use.', href: '#/insights', cta: 'Review' });
  const drafts = (data.knowledge || []).filter((k) => k.status === 'draft').length;
  if (drafts) out.push({ id: 'drafts', tone: 'info', icon: 'knowledge', title: `${plural(drafts, 'draft', 'drafts')} waiting to be published`, sub: 'Your team cannot see these yet.', href: '#/knowledge', cta: 'Review' });
  const invited = (data.members || []).filter((m) => m.status === 'invited').length;
  if (invited) out.push({ id: 'invited', tone: 'info', icon: 'people', title: `${plural(invited, 'person has', 'people have')} not signed in yet`, sub: 'They were invited but have not used their code.', href: '#/people', cta: 'See people' });
  const rank = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, z) => rank[a.tone] - rank[z.tone]).slice(0, 7);
}
