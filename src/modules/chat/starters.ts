import type { ItemRow } from '../knowledge/store.js';
import { visibleTo } from './retrieve.js';

/** Practical how-to prompts for a venue that has not added much yet: they show people what is worth asking. */
export const STARTER_POOL = [
  'How do I close down the coffee machine?', 'How do I change the printer roll?', 'Where do I find the opening checklist?',
  'Who do I call if the till stops working?', 'What do I do if a guest tells me about an allergy?', 'How do I do a cash up?',
  'Where is the fire assembly point?', 'How do I report an accident?', 'What is the holiday request process?', 'How do I clean the milk steam wand?',
];

const VERBS = /^(change|close|clean|open|make|set up|set|use|reset|restart|order|count|cash up|handle|report|serve|pour|prepare|store|check|do|log|book|request|replace|refill|empty|switch|turn|start|stop|shut|lock|unlock|carry out|run|take|put|fill|wipe|descale|backflush|calibrate|reconcile|process|void|refund|add|remove|clock|submit|apply|swap|cover|record|label|defrost|cook|reheat|cool|reboot|connect|pair|load|unload|deliver|receive|rotate|sanitise|sanitize|disinfect|dispose|clear|finish|begin|greet|book in|take)\b/i;
const EXPLAINS = /\b(process|procedure|policy|rules?|guide|plan|steps?|handbook|standards?)$/i;
const FINDS = /\b(checklist|rota|menu|spec|specs|sheet|matrix|list|schedule)$/i;
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s); // keep brand names and acronyms as written

/** A question a person might ask, made from the title of something in the venue's knowledge. Null when nothing sensible can be made. */
export function questionFromTitle(raw: string): string | null {
  const t = String(raw ?? '').replace(/\.(pdf|docx?|txt|md|png|jpe?g|webp)$/i, '').replace(/[_]+/g, ' ').replace(/\(\s*draft\s*\)|\bdraft\b/gi, '').replace(/\s+/g, ' ').trim().replace(/[?.:]+$/, '');
  if (t.length < 4 || t.length > 70) return null;
  const how = /^how\s+(?:to|do i|do we|can i|should i)\s+(.+)$/i.exec(t);
  if (how) return `How do I ${lowerFirst(how[1]!)}?`;
  if (VERBS.test(t)) return `How do I ${lowerFirst(t)}?`;
  const noArt = t.replace(/^(the|our|a|an)\s+/i, '');
  if (FINDS.test(t)) return `Where do I find the ${lowerFirst(noArt)}?`;
  if (EXPLAINS.test(t)) return `What does the ${lowerFirst(noArt)} say?`;
  return `Tell me about ${/^(the|our)\s/i.test(t) ? '' : 'the '}${lowerFirst(noArt)}`.replace('Tell me about the the ', 'Tell me about the ') + '';
}

/** Questions from what this venue can already answer (documents, videos and pictures visible to everyone there), then the starter set if there are few. */
export function startersFor(items: ItemRow[], site: { siteId: string }, limit = 10): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  const add = (q: string | null) => { if (!q) return; const k = q.toLowerCase(); if (seen.has(k)) return; seen.add(k); out.push(q); };
  const mine = items.filter((i) => visibleTo(i, { siteId: site.siteId, teamIds: [] })).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  for (const i of mine) { if (out.length >= limit) break; add(questionFromTitle(i.title)); }
  if (out.length < 6) for (const q of STARTER_POOL) { if (out.length >= 6) break; add(q); }
  return out;
}
