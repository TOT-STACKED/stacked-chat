import type { Role } from './permissions.js';

export type SendResult = 'sent' | 'skipped' | 'failed';
export interface Mail { to: string; subject: string; text: string; html: string; /** replies go here (for example the person who asked for help) */ replyTo?: string }
export interface Mailer { send(mail: Mail): Promise<SendResult> }

/** Resend transport (same provider the weekly digest already uses). Never throws. */
export function createResendMailer(opts: { apiKey: string; from: string; fetchImpl?: typeof fetch }): Mailer {
  const f = opts.fetchImpl ?? fetch;
  return {
    async send(mail) {
      try {
        const res = await f('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + opts.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: opts.from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html, ...(mail.replyTo ? { reply_to: mail.replyTo } : {}) }),
        });
        return res.ok ? 'sent' : 'failed';
      } catch {
        return 'failed';
      }
    },
  };
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ROLE_WORDS: Record<Role, string> = {
  owner: 'an owner', hq_admin: 'an HQ admin', site_manager: 'a site manager', staff: 'a team member', kiosk: 'a shared device',
};

export function inviteEmail(o: { to: string; orgName: string; siteName?: string | null; inviter?: string | null; role: Role; url: string }): Mail {
  const where = o.siteName ? `${o.orgName}, ${o.siteName}` : o.orgName;
  const who = o.inviter ? `${o.inviter} has` : "You've been";
  const subject = `You've been invited to ${o.orgName} on Stacked Chat`;
  const line = o.inviter
    ? `${o.inviter} has added you to ${where} on Stacked Chat as ${ROLE_WORDS[o.role]}.`
    : `You've been added to ${where} on Stacked Chat as ${ROLE_WORDS[o.role]}.`;
  const how = `Open the link below and sign in with this email address (${o.to}). We'll email you a one-time code, so there is no password to set up.`;
  const text = `${line}\n\n${how}\n\n${o.url}\n\nIf you weren't expecting this, you can ignore this email.`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1B1A17">
<p style="font-size:16px;line-height:1.5;margin:0 0 16px">${esc(line)}</p>
<p style="font-size:15px;line-height:1.5;margin:0 0 24px;color:#4A473F">${esc(how)}</p>
<p style="margin:0 0 24px"><a href="${esc(o.url)}" style="background:#E87830;color:#1B1A17;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;display:inline-block">Open Stacked Chat</a></p>
<p style="font-size:13px;color:#6B675F;margin:0">If you weren't expecting this, you can ignore this email.</p></div>`;
  void who;
  return { to: o.to, subject, text, html };
}

/** The email a new owner gets when they start a trial themselves (not invited by anyone). */
export function welcomeEmail(o: { to: string; name?: string | null; orgName: string; url: string }): Mail {
  const hi = o.name?.trim() ? `Hi ${o.name.trim().split(/\s+/)[0]},` : 'Hello,';
  const subject = `Welcome to Stacked Chat: your 30-day trial for ${o.orgName} has started`;
  const line = `${hi} your Stacked Chat account for ${o.orgName} is ready, and your 30-day free trial has started. No card is needed.`;
  const how = `Open the link below and sign in with this email address (${o.to}). We'll email you a one-time code, so there is no password to set up. Then add your handbooks, allergen guide and how-tos, and invite your team.`;
  const text = `${line}\n\n${how}\n\n${o.url}\n\nIf you didn't ask for this, you can ignore this email and nothing will happen.`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1B1A17">
<p style="font-size:16px;line-height:1.5;margin:0 0 16px">${esc(line)}</p>
<p style="font-size:15px;line-height:1.5;margin:0 0 24px;color:#4A473F">${esc(how)}</p>
<p style="margin:0 0 24px"><a href="${esc(o.url)}" style="background:#E87830;color:#1B1A17;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;display:inline-block">Open Stacked Chat</a></p>
<p style="font-size:13px;color:#6B675F;margin:0">If you didn't ask for this, you can ignore this email and nothing will happen.</p></div>`;
  return { to: o.to, subject, text, html };
}
