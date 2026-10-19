import { significantWords } from '../insights/analyze.js';
import type { ItemRow } from '../knowledge/store.js';

export interface Asker { siteId: string; teamIds: string[] }

/** Published knowledge this person may see: company-wide, their site, or their team. Drafts never. */
export function visibleTo(item: ItemRow, who: Asker): boolean {
  if (item.status !== 'published') return false;
  if (item.team_id !== null) return who.teamIds.includes(item.team_id);
  return item.site_id === null || item.site_id === who.siteId;
}

/** Split a document into readable passages: paragraphs, merged up to ~900 characters, long ones cut at a sentence. */
export function splitPassages(body: string, max = 900): string[] {
  const out: string[] = []; let cur = '';
  const flush = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  for (const para of body.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const p = para.trim(); if (!p) continue;
    if (p.length > max) {
      flush();
      let rest = p;
      while (rest.length > max) {
        const cut = Math.max(rest.lastIndexOf('. ', max - 2), rest.lastIndexOf('\n', max - 2), Math.floor(max * 0.6));
        out.push(rest.slice(0, cut + 1).trim()); rest = rest.slice(cut + 1).trim();
      }
      cur = rest;
    } else if ((cur + '\n\n' + p).length > max) { flush(); cur = p; }
    else cur = cur ? cur + '\n\n' + p : p;
  }
  flush();
  return out;
}

const bigrams = (w: string) => { const b: string[] = []; for (let i = 0; i < w.length - 1; i++) b.push(w.slice(i, i + 2)); return b; };
/** Typo tolerance for phones typed mid-service ("openoing", "restrautn"): long words that start alike and share most letter pairs. */
export function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || a[0] !== b[0] || Math.abs(a.length - b.length) > 3) return false;
  const x = bigrams(a); const y = new Set(bigrams(b));
  const shared = x.filter((g) => y.has(g)).length;
  return (2 * shared) / (x.length + y.size) >= 0.55;
}
const matches = (word: string, have: Set<string>) => have.has(word) || [...have].some((h) => near(word, h));

export interface Passage { item_id: string; title: string; text: string; score: number }

/** The passages that best match the question. Titles count extra. Nothing is returned if nothing matches. */
export function retrievePassages(items: ItemRow[], question: string, limit = 5): Passage[] {
  const words = [...new Set(significantWords(question))];
  if (!words.length) return [];
  const scored: Passage[] = [];
  for (const item of items) {
    // a picture's description (a spec typed in, or read off a photo of a spec card) answers questions like a document does
    const source = item.kind === 'document' ? item.body : item.kind === 'image' ? item.description : null;
    if (!source) continue;
    const titleWords = new Set(significantWords(item.title));
    const titleHits = words.filter((w) => matches(w, titleWords)).length;
    for (const text of splitPassages(source)) {
      const have = new Set(significantWords(text));
      const hits = words.filter((w) => matches(w, have)).length;
      const score = hits + titleHits * 2;
      if (hits > 0 || titleHits > 0) scored.push({ item_id: item.id, title: item.title, text, score });
    }
  }
  const best = scored.sort((a, b) => b.score - a.score);
  // at most 3 passages from any one document, so one long handbook cannot crowd out everything else
  const perDoc = new Map<string, number>(); const out: Passage[] = [];
  for (const p of best) { const n = perDoc.get(p.item_id) ?? 0; if (n >= 3) continue; perDoc.set(p.item_id, n + 1); out.push(p); if (out.length >= limit) break; }
  return out;
}

export const wantsVideo = (q: string) => /\b(video|watch|tutorial|walkthrough|demo|show me how)\b/i.test(q);
export const wantsPhoto = (q: string) => /\b(photo|photos|picture|pictures|image|images|pic|pics|looks?\s+like)\b/i.test(q);

/** Pictures whose own description supplied the best passages: show them with the answer, even if nobody said "photo". */
export function imagesBehind(items: ItemRow[], passages: Passage[], max = 1): ItemRow[] {
  const ids = [...new Set(passages.slice(0, 2).map((p) => p.item_id))];
  return ids.map((id) => items.find((i) => i.id === id && i.kind === 'image')).filter((i): i is ItemRow => !!i).slice(0, max);
}

/** A video worth attaching (one), and a photo only when the person asked to see one. */
export function pickMedia(items: ItemRow[], question: string): { videos: ItemRow[]; images: ItemRow[] } {
  const words = [...new Set(significantWords(question))];
  const hits = (i: ItemRow) => { const have = new Set(significantWords(`${i.title} ${i.description ?? ''}`)); return words.filter((w) => have.has(w)).length; };
  const need = wantsVideo(question) ? 1 : 2;
  const videos = items.filter((i) => i.kind === 'video' && hits(i) >= need).sort((a, b) => hits(b) - hits(a)).slice(0, 1);
  const images = wantsPhoto(question) ? items.filter((i) => i.kind === 'image' && hits(i) >= 1).sort((a, b) => hits(b) - hits(a)).slice(0, 1) : [];
  return { videos, images };
}
