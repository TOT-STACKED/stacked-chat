import { badRequest } from '../../lib/errors.js';
import type { Db } from '../../lib/supabase.js';

export interface NpsRow { vendor: string; score: number; comment: string | null; venue_id: string; venue: string; respondent: string | null }
export interface NpsStore { save(row: NpsRow): Promise<void> }
/** Best-effort copy to the partner portal (StackCollect). A portal outage must never lose or block the rating. */
export type NpsMirror = (row: NpsRow) => Promise<void>;

export function createSupabaseNpsStore(db: Db): NpsStore {
  return { async save(row) { const r = await db.rest('/nps_scores', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: row }); if (r.status >= 300) throw new Error(`nps save failed (${r.status})`); } };
}

export function createPortalMirror(o: { url: string; key: string; fetchImpl?: typeof fetch }): NpsMirror {
  const f = o.fetchImpl ?? fetch;
  return async (row) => {
    try {
      await f(`${o.url.replace(/\/$/, '')}/rest/v1/nps_scores`, {
        method: 'POST',
        headers: { apikey: o.key, Authorization: `Bearer ${o.key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ source: 'stacked-chat', touchpoint: 'vendor-chat', score: row.score, comment: row.comment, vendor: row.vendor, respondent_name: row.respondent, company: row.venue, venue_id: row.venue_id }),
      });
    } catch { /* best effort */ }
  };
}

/** Rating text is shown in admin dashboards, so angle brackets are swapped for harmless look-alikes and control characters dropped. */
export const safeText = (s: string, max: number) => s.replace(/[<>]/g, (c) => (c === '<' ? '‹' : '›')).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

export function checkNps(input: { vendor: string; score: number; comment?: string | null }): { vendor: string; score: number; comment: string | null } {
  const vendor = safeText(input.vendor ?? '', 60);
  if (!vendor) throw badRequest('Which product are you rating?');
  if (!Number.isInteger(input.score) || input.score < 0 || input.score > 10) throw badRequest('Choose a score from 0 to 10');
  const comment = input.comment ? safeText(input.comment, 500) : '';
  return { vendor, score: input.score, comment: comment || null };
}
