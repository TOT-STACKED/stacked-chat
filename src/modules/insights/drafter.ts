/** Writes a starting-point answer for a question the AI could not answer. A person always reviews it before anything is published. */
export interface AnswerDrafter {
  /** returns the draft text, or null if it could not write one (then a blank template is used) */
  draft(question: string, context: string[]): Promise<string | null>;
}

const SYSTEM = `You help a hospitality manager write a short internal knowledge-base answer for their staff.
Staff asked a question and the company's AI assistant could not answer it from the company's knowledge.
Write a draft answer in plain, friendly English, under 150 words, that the manager will check and edit.

Rules, all of them important:
- Use ONLY facts that appear in the company documents provided. Do not use outside knowledge about this company.
- Never invent numbers, prices, times, names, legal, safety, allergen or pay rules.
- Where the answer depends on the company's own policy and the documents do not say, write [CONFIRM: what the manager needs to fill in] in that spot.
- If the documents say nothing relevant, write one short sentence of structure and a single [CONFIRM: ...] for the answer.
- No preamble and no markdown headings. Output only the draft answer.`;

export function createAnthropicDrafter(opts: { apiKey: string; model: string; fetchImpl?: typeof fetch }): AnswerDrafter {
  const f = opts.fetchImpl ?? fetch;
  return {
    async draft(question, context) {
      try {
        const docs = context.length ? context.map((c, i) => `Document excerpt ${i + 1}:\n${c}`).join('\n\n') : '(No relevant company documents were found.)';
        const res = await f('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: opts.model, max_tokens: 500, system: SYSTEM, messages: [{ role: 'user', content: `Question from staff: ${question}\n\nCompany documents:\n${docs}` }] }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
        const out = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
        return out || null;
      } catch { return null; }
    },
  };
}

/** What a draft contains when no AI is available, or it fails: an honest blank for the manager to fill in. */
export const blankDraft = (question: string) => `Question: ${question}\n\nAnswer: [CONFIRM: write the answer here]`;
