/** Pure analysis of stored conversations. No database, no AI: easy to test. */
export interface Message { role?: string; content?: unknown }
export interface Conversation { id: number | string; venue_id: string | null; email: string | null; created_at: string; messages: Message[] | null }

/** Phrases that mean the AI could not answer from the knowledge it has (same signal the old admin used). */
export const GAP_PHRASES = [
  "i don't have", 'i do not have', 'i dont have', 'not in your knowledge', 'not in the knowledge', 'not in my knowledge',
  'no information', 'no info', "don't know", 'dont know', 'do not know', "couldn't find", 'could not find', 'couldnt find',
  'no relevant', 'no matching', 'unable to find', 'not sure', "haven't been told", 'havent been told',
  "isn't in", 'is not in', "doesn't appear", 'doesnt appear', 'does not appear',
  'not able to find', "can't find", 'cannot find', "hasn't been uploaded", 'not been uploaded', 'not been added', 'an admin can add',
  'not in the library', "i don't have that", "not something that's been added",
];

const STOP = new Set(['the', 'and', 'for', 'are', 'was', 'were', 'you', 'your', 'our', 'can', 'could', 'would', 'should', 'will', 'does', 'did', 'has', 'have', 'had',
  'this', 'that', 'these', 'those', 'with', 'what', 'when', 'where', 'which', 'who', 'why', 'how', 'any', 'all', 'get', 'got', 'its', 'not', 'but', 'from', 'into', 'about',
  'hello', 'hey', 'hiya', 'morning', 'afternoon', 'evening', 'good', 'okay', 'cheers', 'yes', 'yeah', 'nope', 'sure', 'great', 'cool', 'bye', 'sorry',
  'please', 'need', 'want', 'know', 'there', 'here', 'then', 'than', 'they', 'them', 'been', 'being', 'some', 'just', 'tell', 'let', 'also', 'much', 'many', 'thanks', 'thank']);

const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, (m) => (w.length - m.length >= 3 ? '' : m));

/**
 * A key that is the same for questions that mean the same thing: the sorted, de-duplicated, simply-stemmed
 * meaningful words. "Can I swap a shift?" and "can i swap shifts" both give "shift swap".
 * Empty for chit-chat ("hi", "thanks"), which is then ignored.
 */
export function questionKey(q: string): string {
  const words = q.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).map((w) => w.replace(/'s$/, '').replace(/'/g, ''))
    .filter((w) => w.length > 2 && !STOP.has(w)).map(stem).filter((w) => w.length > 1);
  return [...new Set(words)].sort().join(' ');
}

export interface Ask { key: string; text: string; site_id: string | null; email: string | null; at: string; unanswered: boolean }

const text = (c: unknown) => (typeof c === 'string' ? c : '');

/** Every question in the conversations, with whether the AI's reply showed it could not answer. */
export function extractAsks(convs: Conversation[]): Ask[] {
  const out: Ask[] = [];
  for (const c of convs) {
    const msgs = Array.isArray(c.messages) ? c.messages : [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i]!;
      if (m.role !== 'user') continue;
      const q = text(m.content).trim();
      const key = q.length >= 4 ? questionKey(q) : '';
      if (!key) continue;
      // the AI's answer to THIS question: the first assistant message before the next question
      let answer: string | null = null;
      for (let j = i + 1; j < msgs.length && msgs[j]!.role !== 'user'; j++) if (msgs[j]!.role === 'assistant') { answer = text(msgs[j]!.content).toLowerCase(); break; }
      out.push({ key, text: q.length > 180 ? q.slice(0, 177) + '…' : q, site_id: c.venue_id, email: c.email ? c.email.toLowerCase() : null, at: c.created_at,
        unanswered: answer !== null && GAP_PHRASES.some((p) => answer.includes(p)) });
    }
  }
  return out;
}

export interface Group { key: string; question: string; count: number; sites: number; site_ids: string[]; last_asked: string; unanswered: number }

/** Group the same question together. The shown wording is the most common phrasing (shortest on a tie). */
export function groupAsks(asks: Ask[]): Group[] {
  const by = new Map<string, { texts: Map<string, number>; asks: Ask[] }>();
  for (const a of asks) {
    const g: { texts: Map<string, number>; asks: Ask[] } = by.get(a.key) ?? { texts: new Map(), asks: [] };
    g.texts.set(a.text, (g.texts.get(a.text) ?? 0) + 1); g.asks.push(a); by.set(a.key, g);
  }
  return [...by].map(([key, g]) => {
    const question = [...g.texts].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length)[0]![0];
    const sites = [...new Set(g.asks.map((a) => a.site_id).filter((x): x is string => !!x))];
    return { key, question, count: g.asks.length, sites: sites.length, site_ids: sites, last_asked: g.asks.map((a) => a.at).sort().at(-1)!, unanswered: g.asks.filter((a) => a.unanswered).length };
  }).sort((a, b) => b.count - a.count || b.last_asked.localeCompare(a.last_asked));
}

/** Questions the AI could not answer, most often asked first. A question counts when it went unanswered at least once. */
export const unansweredGroups = (asks: Ask[]) => groupAsks(asks.filter((a) => a.unanswered));
