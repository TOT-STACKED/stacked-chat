import { ApiHttpError } from './errors.js';
import type { Notify } from './slack.js';

/** How much AI one thing costs, in "questions". A chat answer is 1; a drafted course reads a whole document, so it counts for more. */
export const UNITS = { chat: 1, picture: 5, draft: 8 } as const;

export interface AiBudget {
  /** Count this use against today's allowance, or refuse it. Throws a 429 the person can read. */
  spend(orgId: string, units?: number): Promise<void>;
  /** for the Console: today's totals, never any content */
  snapshot(): { date: string; total: number; all: number; companies: number; busiest: Array<{ org_id: string; used: number }> };
}

const ukDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/**
 * A daily ceiling on AI use that actually blocks (the fair-use numbers in billing only flag). One free trial cannot run up the bill, and a
 * ceiling across everyone stops a flood from many trials. The day is the UK day. Counts are kept in memory: a restart only gives a fresh
 * allowance for the rest of that day, and the overall ceiling still applies. The first time a company or the whole service hits a limit
 * each day, `notify` tells Stacked, so a real customer who needs more is noticed.
 */
export function createAiBudget(o: {
  perOrg: number; perTrial: number; all: number;
  isTrial?: (orgId: string) => Promise<boolean>;
  orgName?: (orgId: string) => Promise<string | null>;
  notify?: Notify | null; now?: () => Date;
}): AiBudget {
  const now = o.now ?? (() => new Date());
  let date = ukDay(now()); let total = 0; let byOrg = new Map<string, number>(); let alerted = new Set<string>();
  const roll = () => { const d = ukDay(now()); if (d !== date) { date = d; total = 0; byOrg = new Map(); alerted = new Set(); } };
  const tell = async (key: string, text: () => Promise<string>) => {
    if (alerted.has(key)) return; alerted.add(key);
    try { await o.notify?.(await text()); } catch { /* an alert that fails must never block anyone */ }
  };
  const limitHit = () => new ApiHttpError(429, 'ai_limit', "Your company has used today's AI allowance, so the assistant is resting until midnight (UK time). If you need more, tell Stacked support.");
  return {
    async spend(orgId, units = 1) {
      roll();
      if (total + units > o.all) {
        await tell('all', async () => `⚠️ *AI daily limit reached for everyone.* ${total} of ${o.all} AI calls used today, so questions are being declined until midnight UK time. If this is real demand, raise AI_DAILY_CAP_ALL; if not, look for a flood of trial sign-ups.`);
        throw new ApiHttpError(429, 'ai_busy', 'The assistant is very busy today and has reached its daily limit. Please try again tomorrow, or tell Stacked support if it is urgent.');
      }
      const used = byOrg.get(orgId) ?? 0;
      const trial = o.isTrial ? await o.isTrial(orgId).catch(() => false) : false;
      const cap = trial ? o.perTrial : o.perOrg;
      if (used + units > cap) {
        await tell(`org:${orgId}`, async () => `⚠️ *AI daily limit reached:* ${(await o.orgName?.(orgId).catch(() => null)) ?? orgId} (${trial ? 'free trial' : 'paying'}) has used ${used} of ${cap} today, so its questions are being declined until midnight UK time. If this is a real customer, raise ${trial ? 'AI_DAILY_CAP_TRIAL' : 'AI_DAILY_CAP_ORG'}.`);
        throw limitHit();
      }
      byOrg.set(orgId, used + units); total += units;
    },
    snapshot() {
      roll();
      return { date, total, all: o.all, companies: byOrg.size, busiest: [...byOrg].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([org_id, used]) => ({ org_id, used })) };
    },
  };
}
