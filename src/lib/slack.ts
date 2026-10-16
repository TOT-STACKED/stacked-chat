/** One-line alerts to a Slack channel via an incoming webhook. Best effort: never throws, never blocks. */
export type Notify = (text: string) => Promise<void>;
export function createSlackNotifier(url: string, fetchImpl: typeof fetch = fetch): Notify {
  return async (text) => {
    try { await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }); } catch { /* alerts are best effort */ }
  };
}
