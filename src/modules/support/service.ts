import { esc, type Mail, type Mailer } from '../../lib/email.js';
import { ApiHttpError, badRequest } from '../../lib/errors.js';
import { bestRole, type UserPrincipal } from '../../lib/permissions.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import type { Repo } from '../../lib/repo.js';
import type { Notify } from '../../lib/slack.js';
import { safeText } from '../chat/nps.js';
import type { TicketStore } from '../chat/help.js';

export const KINDS = ['problem', 'question', 'idea'] as const;
export type SupportKind = (typeof KINDS)[number];
const KIND_LABEL: Record<SupportKind, string> = { problem: 'Something is not working', question: 'A question', idea: 'An idea' };
const ROLE_WORDS: Record<string, string> = { owner: 'Owner', hq_admin: 'HQ admin', site_manager: 'Site manager', staff: 'Staff', kiosk: 'Kiosk' };

export interface SupportInput { message: string; kind?: SupportKind; org_id?: string | null; site_id?: string | null; page?: string | null; source?: 'manage' | 'chat'; device?: string | null }
export interface SupportResult { sent: boolean; emailed: boolean; ticket: boolean }

/** A request to Stacked support: to Slack straight away, to the support inbox (so a reply goes to the customer), and an acknowledgement back to them. */
export function supportEmail(o: { to: string; replyTo?: string; from: string; name: string; role: string; org: string; venue: string | null; kind: SupportKind; message: string; where: string; device: string | null }): Mail {
  const subject = `[Support] ${KIND_LABEL[o.kind]}: ${o.message.length > 60 ? o.message.slice(0, 57) + '…' : o.message}`.replace(/\s+/g, ' ');
  const text = [`${o.name} (${o.from}), ${o.role} at ${o.org}${o.venue ? `, ${o.venue}` : ''}`, `${KIND_LABEL[o.kind]}. From ${o.where}.`, '', o.message, ...(o.device ? ['', `Device: ${o.device}`] : []), '', 'Just reply to this email to answer them.'].join('\n');
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1B1A17">
<p style="font-size:15px;line-height:1.5;margin:0 0 6px"><b>${esc(o.name)}</b> (${esc(o.from)})</p>
<p style="font-size:14px;color:#6B675F;margin:0 0 16px">${esc(o.role)} at ${esc(o.org)}${o.venue ? `, ${esc(o.venue)}` : ''} · ${esc(KIND_LABEL[o.kind])} · from ${esc(o.where)}</p>
<div style="background:#F5F3EE;border-radius:12px;padding:14px 16px;margin:0 0 14px;font-size:15px;line-height:1.5;white-space:pre-wrap">${esc(o.message)}</div>
${o.device ? `<p style="font-size:12.5px;color:#6B675F;margin:0 0 14px">Device: ${esc(o.device)}</p>` : ''}
<p style="font-size:14px;margin:0">Just reply to this email to answer them.</p></div>`;
  return { to: o.to, subject, text, html, ...(o.replyTo ? { replyTo: o.replyTo } : {}) };
}
export function supportReceipt(o: { to: string; name: string; message: string; support?: string }): Mail {
  const hi = o.name ? `Hi ${o.name.split(/\s+/)[0]},` : 'Hello,';
  const text = `${hi}\n\nThanks, we have your message and someone from the Stacked team will email you back${o.support ? ` from ${o.support}` : ''}.\n\nWhat you sent:\n${o.message}\n\nStacked Chat`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#38278F"><p style="font-size:16px;line-height:1.55;margin:0 0 14px">${esc(hi)}</p><p style="font-size:15px;line-height:1.55;margin:0 0 16px">Thanks, we have your message and someone from the Stacked team will email you back${o.support ? ` from ${esc(o.support)}` : ''}.</p><div style="background:#F1F0E9;border-radius:12px;padding:12px 14px;font-size:14px;line-height:1.5;color:#4A453C;white-space:pre-wrap">${esc(o.message)}</div></div>`;
  return { to: o.to, subject: 'We have your message', text, html };
}

export function createSupport(deps: { repo: Repo; tickets?: TicketStore | null; notify?: Notify | null; mailer?: Mailer | null; supportEmail?: string; perHour?: number; now?: () => number }) {
  const limiter = new RateLimiter(deps.perHour ?? 6, 3_600_000, deps.now);

  async function send(p: UserPrincipal, input: SupportInput): Promise<SupportResult> {
    const rl = limiter.hit(p.userId);
    if (!rl.allowed) throw new ApiHttpError(429, 'rate_limited', 'You have sent a few messages this hour. We have them, and we will reply by email.');
    const message = safeText(input.message ?? '', 2000);
    if (message.length < 3) throw badRequest('Tell us a little about what you need');
    const kind: SupportKind = KINDS.includes(input.kind as SupportKind) ? (input.kind as SupportKind) : 'question';
    const orgIds = [...new Set(p.memberships.map((m) => m.orgId))];
    const orgId = input.org_id && orgIds.includes(input.org_id) ? input.org_id : orgIds[0] ?? null;
    const org = orgId ? await deps.repo.getOrg(orgId) : null;
    let site = input.site_id ? await deps.repo.getSite(input.site_id) : null;
    if (site && (!orgId || site.org_id !== orgId || bestRole(p, site.org_id, site.id) === null)) site = null;
    const member = orgId ? (await deps.repo.listMembers(orgId)).find((m) => m.email.toLowerCase() === p.email.toLowerCase() && m.status === 'active') : undefined;
    const name = member?.display_name?.trim() || (p.email.split('@')[0] ?? p.email);
    const role = ROLE_WORDS[(orgId ? bestRole(p, orgId, site?.id ?? null) : null) ?? member?.role ?? ''] ?? 'User';
    const where = input.source === 'chat' ? 'the chat' : `Manage${input.page ? ` (${safeText(input.page, 80)})` : ''}`;
    const device = input.device ? safeText(input.device, 200) || null : null;

    // 1. Slack, so someone sees it at once
    await deps.notify?.(['🛟 *Support request, Stacked Chat*', `*From:* ${name} (${p.email}), ${role}`, `*Company:* ${org?.name ?? 'Unknown'}${site ? ` · *Venue:* ${site.name}` : ''}`, `*Type:* ${KIND_LABEL[kind]} · from ${where}`, `*Message:* ${message.slice(0, 600)}`, ...(device ? [`*Device:* ${device}`] : [])].join('\n'));
    // 2. the log, when we know a venue to file it under
    let ticket = false;
    const venueId = site?.id ?? (orgId ? (await deps.repo.listSites(orgId))[0]?.id : undefined);
    if (deps.tickets && venueId) { try { await deps.tickets.save({ email: p.email, name, venue: site?.name ?? org?.name ?? '', venue_id: venueId, issue: `[${KIND_LABEL[kind]}] ${message}`, conversation: [], status: 'open', escalated: true }); ticket = true; } catch { /* the message has still gone to Slack */ } }
    // 3. email: to the support inbox (reply goes to the customer), and a receipt to them
    let emailed = false;
    if (deps.mailer) {
      if (deps.supportEmail) emailed = (await deps.mailer.send(supportEmail({ to: deps.supportEmail, replyTo: p.email, from: p.email, name, role, org: org?.name ?? 'Unknown', venue: site?.name ?? null, kind, message, where, device }))) === 'sent';
      await deps.mailer.send(supportReceipt({ to: p.email, name, message, support: deps.supportEmail }));
    }
    return { sent: true, emailed, ticket };
  }
  return { send };
}
export type Support = ReturnType<typeof createSupport>;
