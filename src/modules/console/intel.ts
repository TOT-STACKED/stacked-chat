import catalog from './data/vendor-catalog.json';
import problemTypes from './data/problem-types.json';

export interface NpsScore { vendor: string; score: number; comment: string | null; created_at: string }
export interface VendorIntel {
  vendor: string; category: string; mentions: number; conversations: number;
  problems: Array<{ label: string; count: number }>; samples: string[];
  nps: { avg: number; count: number; nps: number; promoters: number; passive: number; detractors: number } | null;
}

/** Remove things that identify a person from a sample question before it is shown. */
export function scrubSample(text: string): string {
  const t = text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]').replace(/\+?\d[\d\s-]{7,}\d/g, '[number]').replace(/\s+/g, ' ').trim();
  return t.length > 150 ? t.slice(0, 147) + '…' : t;
}

export function npsSummary(scores: number[]) {
  const n = scores.length; if (!n) return null;
  const promoters = scores.filter((s) => s >= 9).length; const detractors = scores.filter((s) => s <= 6).length;
  return {
    avg: Math.round((scores.reduce((a, b) => a + b, 0) / n) * 10) / 10, count: n, promoters, detractors, passive: n - promoters - detractors,
    nps: Math.round((promoters / n - detractors / n) * 100),
  };
}

/**
 * What operators say about each technology partner, across every customer (aggregated and anonymised): how often it
 * is mentioned, the kinds of problem, a few example questions, and the NPS people gave it.
 * `conversations` is one array of lower-cased user messages per conversation.
 */
export function vendorIntelligence(conversations: string[][], nps: NpsScore[]): VendorIntel[] {
  const all = conversations.flat();
  return catalog.map((v) => {
    const matched = all.filter((m) => v.keywords.some((k) => m.includes(k)));
    const convs = conversations.filter((c) => c.some((m) => v.keywords.some((k) => m.includes(k)))).length;
    const problems = problemTypes.map((p) => ({ label: p.label, count: matched.filter((m) => p.keywords.some((k) => m.includes(k))).length }))
      .filter((p) => p.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);
    const mine = nps.filter((n) => v.keywords.some((k) => n.vendor.toLowerCase().includes(k)) || v.vendor.toLowerCase() === n.vendor.toLowerCase());
    return { vendor: v.vendor, category: v.category, mentions: matched.length, conversations: convs, problems, samples: matched.slice(0, 3).map(scrubSample), nps: npsSummary(mine.map((n) => n.score)) };
  }).filter((v) => v.mentions > 0 || (v.nps && v.nps.count > 0)).sort((a, b) => (b.mentions - a.mentions) || ((b.nps?.count ?? 0) - (a.nps?.count ?? 0)));
}
