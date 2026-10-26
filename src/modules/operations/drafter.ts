import { MAX_ITEMS, MAX_ITEM_CHARS } from './service.js';

/** A first draft of a checklist. A manager always reads and changes it before it is saved. */
export interface DraftedChecklist { title: string; items: string[] }
export interface ChecklistDrafter {
  /** the draft, or null if it could not be written */
  draft(input: { brief: string; kind: 'opening' | 'closing' | 'custom'; venue: string | null; source: { title: string; text: string } | null }): Promise<DraftedChecklist | null>;
}

/** The most document text sent to the model. */
export const MAX_SOURCE_CHARS = 24_000;
export const MAX_DRAFT_ITEMS = 30;

const SYSTEM = `You help a hospitality manager write a checklist their team ticks off on their phone.
Write in plain, friendly British English. Each item is one short, concrete action a person can do and tick, starting with a verb, for example "Switch on the extraction and check it is running".

Rules, all of them important:
- 8 to 25 items, in the order a person would do them. One action per item, no more than 120 characters each. No numbering, no headings, no sub-items.
- Fit the kind of checklist (opening, closing or other) and the kind of venue the manager describes.
- Do not invent specific numbers, temperatures, times, codes, product names or legal rules. Where a venue-specific detail is needed, say what to do without the number, for example "Record the fridge temperatures in the log", or put a blank in square brackets such as "Set the alarm [ADD: alarm procedure]".
- Safety, food hygiene and allergen steps must stay general and cautious. Never say something is safe or compliant.
- If a document is given, base the items on what it says, and do not contradict it. Otherwise use common, sensible hospitality practice.

Reply with ONLY a JSON object, no other text, in exactly this shape:
{"title": "short title, for example Opening checklist", "items": ["...", "..."]}`;

/** Pull the JSON out of the model's reply and tidy every item, so what reaches the manager is always well-formed. */
export function parseChecklistDraft(raw: string): DraftedChecklist | null {
  const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let j: unknown;
  try { j = JSON.parse(raw.slice(a, b + 1)); } catch { return null; }
  const o = j as { title?: unknown; items?: unknown };
  if (!o || !Array.isArray(o.items)) return null;
  const seen = new Set<string>();
  const items = (o.items as unknown[]).map((x) => (typeof x === 'string' ? x : '').replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim())
    .filter((t) => t && t.length <= MAX_ITEM_CHARS && !seen.has(t.toLowerCase()) && !!seen.add(t.toLowerCase())).slice(0, Math.min(MAX_DRAFT_ITEMS, MAX_ITEMS));
  if (!items.length) return null;
  return { title: String(o.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120), items };
}

export function createAnthropicChecklistDrafter(opts: { apiKey: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number }): ChecklistDrafter {
  const f = opts.fetchImpl ?? fetch;
  return {
    async draft({ brief, kind, venue, source }) {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 60_000);
      const content = [`Kind of checklist: ${kind === 'custom' ? 'other (not opening or closing)' : kind}`, venue ? `Venue: ${venue}` : null, `What the manager asked for:\n${brief}`,
        source ? `\nDocument to base it on, "${source.title}":\n${source.text.slice(0, MAX_SOURCE_CHARS)}` : null].filter(Boolean).join('\n');
      try {
        const res = await f('https://api.anthropic.com/v1/messages', {
          method: 'POST', signal: ctl.signal,
          headers: { 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: opts.model, max_tokens: 2000, system: SYSTEM, messages: [{ role: 'user', content }] }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
        const out = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
        return out ? parseChecklistDraft(out) : null;
      } catch { return null; } finally { clearTimeout(timer); }
    },
  };
}
