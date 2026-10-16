import { ApiHttpError, notFound } from '../../lib/errors.js';
import { esc, type Mailer } from '../../lib/email.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import type { MemberRow, Repo } from '../../lib/repo.js';
import type { Notify } from '../../lib/slack.js';
import type { Db } from '../../lib/supabase.js';
import { safeText } from './nps.js';
import type { ConversationStore, StoredMessage } from './store.js';
import type { Who } from './service.js';

export type HelpTarget = 'manager' | 'stacked';
export interface TicketRow { email: string; name: string | null; venue: string; venue_id: string; issue: string; conversation: StoredMessage[]; status: 'open'; escalated: boolean }
export interface TicketStore { save(t: TicketRow): Promise<void> }

export function createSupabaseTicketStore(db: Db): TicketStore {
  return { async save(t) { const r = await db.rest('/tickets', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: t }); if (r.status >= 300) throw new Error(`ticket save failed (${r.status})`); } };
}

/** Who to tell: owners and HQ admins (company-wide) and the site's managers. Active people only, once each, never the asker. */
export function pickRecipients(members: MemberRow[], siteId: string, exceptEmail: string): Array<{ email: string; name: string }> {
  const seen = new Map<string, { email: string; name: string }>();
  for (const m of members) {
    if (m.status !== 'active' || m.email.toLowerCase() === exceptEmail.toLowerCase()) continue;
    const companyWide = m.site_id === null && (m.role === 'owner' || m.role === 'hq_admin');
    const siteManager = m.site_id === siteId && m.role === 'site_manager';
    if (!companyWide && !siteManager) continue;
    const email = m.email.toLowerCase();
    if (!seen.has(email)) seen.set(email, { email, name: m.display_name?.trim() || (email.split('@')[0] ?? email) });
  }
  // site managers first (closest to the problem), then company admins
  return [...seen.values()].sort((a, b) => Number(members.some((m) => m.email.toLowerCase() === b.email && m.role === 'site_manager')) - Number(members.some((m) => m.email.toLowerCase() === a.email && m.role === 'site_manager')));
}

export function helpEmail(o: { to: string; toName: string; from: string; fromName: string; venue: string; org: string; question: string; answer: string | null; note: string | null; manageUrl: string }) {
  const subject = `${o.fromName} at ${o.venue} needs help: ${o.question.length > 70 ? o.question.slice(0, 67) + '…' : o.question}`;
  const lines = [`${o.fromName} (${o.from}) asked the AI assistant at ${o.venue} and wants a person to take a look.`, '', `Question: ${o.question}`];
  if (o.answer) lines.push('', `What the assistant said: ${o.answer.length > 600 ? o.answer.slice(0, 597) + '…' : o.answer}`);
  if (o.note) lines.push('', `Their note: ${o.note}`);
  lines.push('', `Just reply to this email to answer them directly. To help the whole team next time, add the answer in Knowledge:`, o.manageUrl);
  const text = lines.join('\n');
  const para = (t: string) => `<p style="font-size:15px;line-height:1.5;margin:0 0 14px">${t}</p>`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1B1A17">
${para(`<b>${esc(o.fromName)}</b> (${esc(o.from)}) asked the AI assistant at <b>${esc(o.venue)}</b> and wants a person to take a look.`)}
<div style="background:#F5F3EE;border-radius:12px;padding:14px 16px;margin:0 0 14px"><div style="font-size:12px;color:#6B675F;font-weight:600;margin-bottom:4px">QUESTION</div><div style="font-size:15px">${esc(o.question)}</div></div>
${o.answer ? `<div style="border:1px solid #E6E2D8;border-radius:12px;padding:14px 16px;margin:0 0 14px"><div style="font-size:12px;color:#6B675F;font-weight:600;margin-bottom:4px">WHAT THE ASSISTANT SAID</div><div style="font-size:14px;color:#4A473F;white-space:pre-wrap">${esc(o.answer.length > 600 ? o.answer.slice(0, 597) + '…' : o.answer)}</div></div>` : ''}
${o.note ? para(`<b>Their note:</b> ${esc(o.note)}`) : ''}
${para('Just reply to this email to answer them directly.')}
<p style="margin:0 0 6px"><a href="${esc(o.manageUrl)}" style="background:#E87830;color:#1B1A17;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:10px;display:inline-block">Add the answer to Knowledge</a></p>
<p style="font-size:13px;color:#6B675F;margin:10px 0 0">That way the assistant can answer it for the whole team next time.</p></div>`;
  return { to: o.to, subject, text, html, replyTo: o.from };
}

export interface HelpDeps { repo: Repo; tickets: TicketStore | null; mailer?: Mailer; conversations: ConversationStore; publicUrl: string; notify?: Notify | null; perHour?: number; now?: () => number }
export interface HelpResult { target: HelpTarget; logged: boolean; notified: string[] }

export function createHelp(deps: HelpDeps) {
  const limiter = new RateLimiter(deps.perHour ?? 5, 3_600_000, deps.now);

  /** Send the latest question in a conversation to a person: the venue's managers (by email) or Stacked support (Slack). */
  async function ask(who: Who, input: { target: HelpTarget; conversation_id: number; note?: string | null }): Promise<HelpResult> {
    const rl = limiter.hit(who.email.toLowerCase());
    if (!rl.allowed) throw new ApiHttpError(429, 'rate_limited', 'You have already asked for help a few times this hour. Your manager has been told.');
    const c = await deps.conversations.get(input.conversation_id);
    if (!c || (c.email ?? '').toLowerCase() !== who.email.toLowerCase() || c.venue_id !== who.siteId) throw notFound('Conversation not found');
    const msgs = Array.isArray(c.messages) ? c.messages : [];
    const question = safeText([...msgs].reverse().find((m) => m.role === 'user')?.content ?? '', 500);
    const answer = [...msgs].reverse().find((m) => m.role === 'assistant')?.content ?? null;
    const note = input.note ? safeText(input.note, 500) || null : null;
    if (!question) throw notFound('Nothing to send yet');

    let logged = false;
    try { await deps.tickets?.save({ email: who.email, name: who.name, venue: who.siteName, venue_id: who.siteId, issue: note ? `${question}\n\nNote: ${note}` : question, conversation: msgs.slice(-8), status: 'open', escalated: input.target === 'stacked' }); logged = !!deps.tickets; } catch { /* the request still goes out */ }

    if (input.target === 'stacked') {
      await deps.notify?.(['🎫 *Help request, Stacked Chat*', `*Company:* ${who.orgName}`, `*Venue:* ${who.siteName}`, `*From:* ${who.name ?? 'Unknown'} (${who.email})`, `*Question:* ${question.slice(0, 300)}`, ...(note ? [`*Note:* ${note.slice(0, 300)}`] : [])].join('\n'));
      return { target: 'stacked', logged, notified: deps.notify ? ['Stacked support'] : [] };
    }

    const to = pickRecipients(await deps.repo.listMembers(who.orgId), who.siteId, who.email).slice(0, 8);
    const notified: string[] = [];
    for (const r of to) {
      const sent = await deps.mailer?.send(helpEmail({ to: r.email, toName: r.name, from: who.email, fromName: who.name ?? who.email, venue: who.siteName, org: who.orgName, question, answer, note, manageUrl: deps.publicUrl.replace(/\/$/, '') + '/manage/#/knowledge' }));
      if (sent === 'sent') notified.push(r.name);
    }
    return { target: 'manager', logged, notified };
  }
  return { ask };
}
export type Help = ReturnType<typeof createHelp>;
