/** Reads the writing off a picture (a drink spec card, a menu page, a laminated procedure). Behind an interface so tests never call a real model. */
export type PictureType = 'image/png' | 'image/jpeg' | 'image/webp';
export interface PictureReader {
  /** the text as written, or a short description if there is no writing; null if it could not be read */
  read(input: { data: Buffer; mediaType: PictureType }): Promise<string | null>;
}

/** Anthropic limit for one image */
export const MAX_READABLE_BYTES = 5 * 1024 * 1024;

const INSTRUCTION = `This is a photo or scan from a UK hospitality venue: for example a cocktail or dish spec card, a recipe, a menu page, an allergen chart or a procedure.
Copy out ALL the writing you can read, exactly as written, keeping the order and the line breaks. Keep quantities, units, ingredients, steps, allergens and prices exactly as shown. Lay recipes out as a name, then ingredients one per line, then method steps.
Do not add, correct or guess anything. If part of it is unreadable, write [unclear] in its place.
If the picture has no writing at all, reply with one or two plain sentences saying what it shows. Reply with the text only, no introduction.`;

export function createAnthropicPictureReader(opts: { apiKey: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number }): PictureReader {
  const f = opts.fetchImpl ?? fetch;
  return {
    async read({ data, mediaType }) {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 60_000);
      try {
        const res = await f('https://api.anthropic.com/v1/messages', {
          method: 'POST', signal: ctl.signal,
          headers: { 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({
            model: opts.model, max_tokens: 2000,
            messages: [{ role: 'user', content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: data.toString('base64') } },
              { type: 'text', text: INSTRUCTION },
            ] }],
          }),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
        const out = (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
        return out || null;
      } catch { return null; } finally { clearTimeout(timer); }
    },
  };
}
