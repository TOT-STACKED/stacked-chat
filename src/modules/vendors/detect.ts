import { PROFILES, SUPPORT_URLS, VENDOR_NAMES } from './index.js';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = new Map<string, RegExp>();
/** whole-word, case-insensitive match ("toast" must not match "toaster") */
export function mentions(text: string, name: string): boolean {
  let re = wordRe.get(name);
  if (!re) { re = new RegExp(`(^|[^a-z0-9])${esc(name.toLowerCase())}([^a-z0-9]|$)`, 'i'); wordRe.set(name, re); }
  return re.test(text);
}
/** "Tech on Toast" is our own community name, not the Toast POS. */
const scrub = (t: string) => t.replace(/tech on toast/gi, ' ');

export interface Turn { role: 'user' | 'assistant'; content: string }

/**
 * Which vendor playbooks to give the assistant. The strongest signal is the current message, then the person's recent
 * messages, then anything said recently, and finally the venue's own recorded tech stack. At most two.
 */
export function pickProfiles(message: string, history: Turn[], techStack: Record<string, string> | null): string[] {
  const keys = Object.keys(PROFILES);
  const find = (text: string) => keys.filter((k) => mentions(scrub(text), k));
  const now = find(message);
  if (now.length) return now.slice(0, 2);
  const recentUser = find(history.slice(-4).filter((m) => m.role === 'user').map((m) => m.content).join(' '));
  if (recentUser.length) return recentUser.slice(0, 2);
  const recentAny = find(history.slice(-2).map((m) => m.content).join(' '));
  if (recentAny.length) return recentAny.slice(0, 2);
  const stack = techStack ? find(Object.values(techStack).join(' ; ')) : [];
  return stack.slice(0, 2);
}

/** A vendor the PERSON mentioned (never one the assistant brought up in passing), for NPS. Any product we recognise by name. */
export function vendorFromPerson(message: string, history: Turn[]): string | null {
  const userText = scrub([message, ...history.slice(-4).filter((m) => m.role === 'user').map((m) => m.content)].join(' '));
  const hit = Object.keys(PROFILES).find((k) => mentions(userText, k)) ?? VENDOR_NAMES.find((n) => n.length > 3 && mentions(userText, n));
  return hit ? hit.toLowerCase() : null;
}

const ASKED_TO_RATE = [
  /(which|what)[^.?!]{0,50}(vendor|product|tool|system|supplier)[^.?!]{0,50}(rate|rating|review|feedback|nps)/i,
  /(rate|rating|review|feedback|nps)[^.?!]{0,50}(which|what)[^.?!]{0,30}(vendor|product|tool|system|supplier)/i,
];
/** If the assistant just asked "which vendor would you like to rate?", the person's short reply IS the vendor (any vendor). */
export function vendorAnswerToRatingQuestion(message: string, history: Turn[]): string | null {
  const lastBot = [...history].reverse().find((m) => m.role === 'assistant')?.content ?? '';
  if (!ASKED_TO_RATE.some((r) => r.test(lastBot))) return null;
  const v = message.trim().replace(/^(the |my |it'?s? |rate |i'?(d| would)? ?(like|want)? ?to ?rate ?|let'?s ?rate ?)/i, '').replace(/[.!?,]+$/, '').trim();
  return v && v.length <= 40 && v.split(/\s+/).length <= 5 && !/[<>"`\\{}$]/.test(v) ? v.toLowerCase() : null;
}

/** A support link is only worth showing when the person is genuinely asking for tech help. */
export const TECH_INTENT = /\b(not working|isn'?t working|not connecting|won'?t|wont|broken|down|crash(ing|ed)?|error|issue|problem|fault|glitch|fix|setup|set ?up|configure|connect|disconnect|offline|frozen|freeze|stuck|reset|reboot|restart|re-?sync|sync|update|install|uninstall|log ?in|login|logged out|password|printer|terminal|card machine|payment|epos|e-?pos|till|pos|how do i|how to|troubleshoot|trouble|support|helpline|keeps|not printing|declined)\b/i;

export function supportLink(message: string, techStack: Record<string, string> | null): { vendor: string; url: string } | null {
  if (!TECH_INTENT.test(message)) return null;
  const text = scrub(message);
  const named = Object.keys(SUPPORT_URLS).find((v) => mentions(text, v));
  const fromStack = !named && techStack ? Object.keys(SUPPORT_URLS).find((v) => Object.values(techStack).some((val) => mentions(val, v))) : undefined;
  const vendor = named ?? fromStack;
  return vendor ? { vendor, url: SUPPORT_URLS[vendor]! } : null;
}

/** "[NPS:sky]" in the assistant's reply means the person asked to rate that vendor. Returns the vendor and the reply without the tag. */
export function takeNpsTag(reply: string): { reply: string; vendor: string | null } {
  const m = /\[NPS:([^\]]+)\]/i.exec(reply);
  const vendor = m ? m[1]!.toLowerCase().trim().slice(0, 60) : null;
  return { reply: reply.replace(/\[NPS:[^\]]*\]/gi, '').trim(), vendor: vendor && !/[<>"`\\{}$]/.test(vendor) ? vendor : null };
}
