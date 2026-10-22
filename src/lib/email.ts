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

/** Where the logo lives: the same site the link points to, so it follows staging and live without a setting. */
function siteOrigin(url: string): string {
  try { return new URL(url).origin; } catch { return 'https://stackedchat.io'; }
}

/** The email a new owner gets when they start a trial themselves (not invited by anyone). Branded: table layout and inline styles so it holds up in Outlook and Gmail. */
export function welcomeEmail(o: { to: string; name?: string | null; orgName: string; url: string }): Mail {
  const hi = o.name?.trim() ? `Hi ${o.name.trim().split(/\s+/)[0]},` : 'Hello,';
  const subject = `Welcome to Stacked Chat: your 30-day trial for ${o.orgName} has started`;
  const line = `${hi} your Stacked Chat account for ${o.orgName} is ready, and your 30-day free trial has started. No card is needed.`;
  const how = `Open Stacked Chat and sign in with this email address (${o.to}). We'll email you a one-time code, so there is no password to set up.`;
  const steps: Array<[string, string, string, string]> = [
    ['1', 'Add one document', 'The thing you keep re-explaining: your opening checklist, allergen guide or staff handbook. Upload a PDF or Word file, or write it in.', '#B0F070'],
    ['2', 'Invite your team', 'Add them by email. They sign in with a one-time code, on any phone.', '#90D8F0'],
    ['3', 'Ask it a question', 'Try it yourself. Every answer comes from your own documents and names its source.', '#FFC090'],
  ];
  const text = `${line}\n\n${how}\n\n${o.url}\n\nGetting started\n${steps.map(([n, t, d]) => `${n}. ${t}: ${d}`).join('\n')}\n\nIf you didn't ask for this, you can ignore this email and nothing will happen.\n\nStacked`;
  const logo = `${siteOrigin(o.url)}/manage/assets/logo-stacked.png`;
  const font = "font-family:'DM Sans',Arial,Helvetica,sans-serif";
  // Email apps strip the `background` shorthand. Every fill is set three ways (bgcolor attribute, background-color property) on a table cell, and text never relies on a fill it might lose.
  const fill = (hex: string) => `bgcolor="${hex}" style="background-color:${hex}`;
  const row = ([n, t, d, c]: [string, string, string, string]) => `<tr><td style="padding:0 0 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td ${fill('#F1F0E9')};border-radius:20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="64" valign="top" style="padding:18px 0 18px 18px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td ${fill(c)};border-radius:20px;width:40px;height:40px;text-align:center;vertical-align:middle;color:#38278F;font-weight:800;font-size:18px;${font}" width="40" height="40" align="center" valign="middle">${n}</td></tr></table></td>
<td valign="top" style="padding:18px 20px 18px 8px;${font};color:#38278F"><div style="font-size:17px;font-weight:800;line-height:1.3;color:#38278F">${esc(t)}</div><div style="font-size:15px;line-height:1.5;color:#4A453C;padding-top:4px">${esc(d)}</div></td></tr></table></td></tr></table></td></tr>`;
  const html = `<!doctype html><html><body ${fill('#F1F0E9')};margin:0;padding:0">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Your 30-day free trial for ${esc(o.orgName)} has started. No card needed.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" ${fill('#F1F0E9')};padding:28px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px">
<tr><td style="padding:0 8px 18px"><img src="${esc(logo)}" width="130" alt="Stacked" style="display:block;border:0;height:auto"></td></tr>
<tr><td ${fill('#FF5014')};border-radius:28px 28px 0 0;padding:32px 32px 28px;${font}">
<div style="font-family:'Arial Black',Arial,Helvetica,sans-serif;font-size:30px;line-height:1.05;text-transform:uppercase;color:#FFFFFF;font-weight:900">Welcome to Stacked Chat</div>
<div style="font-size:16px;line-height:1.5;color:#FFFFFF;padding-top:12px">Your 30-day free trial has started.</div></td></tr>
<tr><td ${fill('#FFFFFF')};border-radius:0 0 28px 28px;padding:30px 32px 32px;${font};color:#38278F">
<p style="font-size:16px;line-height:1.55;margin:0 0 14px;color:#38278F">${esc(line)}</p>
<p style="font-size:15px;line-height:1.55;margin:0 0 24px;color:#4A453C">${esc(how)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 30px"><tr><td ${fill('#FF5014')};border-radius:999px;border-bottom:4px solid #C34014" align="center"><a href="${esc(o.url)}" style="${font};display:block;padding:15px 30px;color:#FFFFFF;text-decoration:none;font-weight:800;font-size:16px;background-color:#FF5014;border-radius:999px"><span style="color:#FFFFFF">Open Stacked Chat</span></a></td></tr></table>
<div style="font-size:12px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:#C34014;padding:0 0 12px">Getting started</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${steps.map(row).join('')}</table>
<p style="font-size:13px;line-height:1.5;color:#6B675F;margin:14px 0 0">If you didn't ask for this, you can ignore this email and nothing will happen.</p></td></tr>
<tr><td align="center" style="padding:18px 8px 0;font-size:12px;color:#6B675F;${font}">Stacked Technologies Limited</td></tr>
</table></td></tr></table></body></html>`;
  return { to: o.to, subject, text, html };
}
