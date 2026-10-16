/** The language model behind the chat. Behind an interface so tests never call a real model. */
export interface ChatTurn { role: 'user' | 'assistant'; content: string }
export interface ChatModel {
  /** the model's reply, or null if it could not answer (timeout, outage, no key) */
  complete(input: { system: string; messages: ChatTurn[] }): Promise<string | null>;
}

export function createAnthropicChatModel(opts: { apiKey: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number }): ChatModel {
  const f = opts.fetchImpl ?? fetch;
  return {
    async complete({ system, messages }) {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 40_000);
      try {
        const res = await f('https://api.anthropic.com/v1/messages', {
          method: 'POST', signal: ctl.signal,
          headers: { 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: opts.model, max_tokens: 800, system, messages }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
        const out = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
        return out || null;
      } catch { return null; } finally { clearTimeout(timer); }
    },
  };
}
