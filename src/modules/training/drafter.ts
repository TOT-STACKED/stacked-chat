import { badRequest } from '../../lib/errors.js';
import { cleanLessons, cleanQuiz } from './service.js';

/** A first draft of a course, written from one of the company's own documents. A manager always checks it before it is saved. */
export interface DraftedCourse {
  title: string; description: string;
  lessons: Array<{ title: string; body: string }>;
  quiz: Array<{ q: string; options: string[]; answer: number }>;
}
export interface CourseDrafter {
  /** the draft, or null if it could not be written */
  draft(input: { title: string; text: string }): Promise<DraftedCourse | null>;
}

/** The most document text sent to the model. Longer documents are cut, and the manager is told. */
export const MAX_SOURCE_CHARS = 24_000;

const SYSTEM = `You help a hospitality manager turn one of their company's documents into a short staff training course.
Write in plain, friendly British English for busy front-of-house and kitchen staff.

Rules, all of them important:
- Use ONLY what the document says. Never add facts, numbers, times, temperatures, legal, safety or allergen rules that are not in it.
- 3 to 6 lessons. Each lesson has a short title and a body of 2 to 6 short sentences or a few short lines. Cover the document's key points in a sensible order.
- Then 4 to 6 multiple-choice questions. Each has 3 options and exactly one correct answer that the lessons clearly teach. Wrong answers must be plausible but clearly wrong. Vary which position the correct answer is in.
- Do not ask trick questions or about small details; ask what a person must actually remember to do the job safely.
- If the document is not suitable for training (for example it is only a list of contact numbers), still do your best with the real content.

Reply with ONLY a JSON object, no other text, in exactly this shape:
{"title": "...", "description": "one sentence on what the course covers", "lessons": [{"title": "...", "body": "..."}], "quiz": [{"q": "...", "options": ["...", "...", "..."], "answer": 0}]}
"answer" is the zero-based position of the correct option.`;

/** Pull the JSON out of the model's reply and check every part, so what reaches the manager is always well-formed. */
export function parseDraft(raw: string): DraftedCourse | null {
  const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let j: unknown;
  try { j = JSON.parse(raw.slice(a, b + 1)); } catch { return null; }
  const o = j as { title?: unknown; description?: unknown; lessons?: unknown; quiz?: unknown };
  if (!o || !Array.isArray(o.lessons)) return null;
  try {
    const lessons = cleanLessons((o.lessons as Array<{ title: string; body: string }>).map((l) => ({ title: String(l?.title ?? ''), body: String(l?.body ?? '') })).filter((l) => l.title.trim() && l.body.trim()).slice(0, 12));
    const quiz = cleanQuiz((Array.isArray(o.quiz) ? o.quiz : []).filter((q: { q?: unknown; options?: unknown; answer?: unknown }) => q && typeof q.q === 'string' && Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 4 && Number.isInteger(q.answer)
      && (q.answer as number) >= 0 && (q.answer as number) < (q.options as unknown[]).length).slice(0, 8) as Array<{ q: string; options: string[]; answer: number }>);
    return { title: String(o.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120), description: String(o.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 500), lessons: lessons.map(({ title, body }) => ({ title, body })), quiz: quiz.map(({ q, options, answer }) => ({ q, options, answer })) };
  } catch (e) { if (e instanceof Error) return null; throw e; }
}

export function createAnthropicCourseDrafter(opts: { apiKey: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number }): CourseDrafter {
  const f = opts.fetchImpl ?? fetch;
  return {
    async draft({ title, text }) {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 90_000);
      try {
        const res = await f('https://api.anthropic.com/v1/messages', {
          method: 'POST', signal: ctl.signal,
          headers: { 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: opts.model, max_tokens: 4000, system: SYSTEM, messages: [{ role: 'user', content: `Document title: ${title}\n\nDocument:\n${text.slice(0, MAX_SOURCE_CHARS)}` }] }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
        const out = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
        return out ? parseDraft(out) : null;
      } catch { return null; } finally { clearTimeout(timer); }
    },
  };
}
export const tooShort = () => badRequest('That document is too short to build a course from. Add more detail to it first.');
