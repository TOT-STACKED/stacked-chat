/** One-line alerts to a Slack channel via an incoming webhook. Best effort: never throws, never blocks.
 *  It reports whether Slack accepted the message (true), refused it (false), so callers can say so honestly. */
export type Notify = (text: string) => Promise<boolean | void>;
export function createSlackNotifier(url: string, fetchImpl: typeof fetch = fetch): Notify {
  return async (text) => {
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      return res.ok;
    } catch { return false; /* alerts are best effort */ }
  };
}

/** For the Console's connection check: what Slack said, in plain words. Never includes the webhook address. */
export async function checkSlack(url: string | undefined, text: string, fetchImpl: typeof fetch = fetch): Promise<{ configured: boolean; ok: boolean; status: number | null; detail: string }> {
  if (!url) return { configured: false, ok: false, status: null, detail: 'No Slack link is set (SLACK_WEBHOOK_URL).' };
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const body = (await res.text().catch(() => '')).slice(0, 80);
    if (res.ok) return { configured: true, ok: true, status: res.status, detail: 'Slack accepted the test message. Look for it in the channel the link belongs to.' };
    const why = /no_service|invalid_token|channel_not_found|channel_is_archived|action_prohibited|no_team|team_disabled/.exec(body)?.[0];
    return { configured: true, ok: false, status: res.status, detail: `Slack refused it (${res.status}${why ? `, ${why}` : ''}). The link has probably been revoked, or its channel was archived. Make a new Incoming Webhook in Slack and update SLACK_WEBHOOK_URL on Render.` };
  } catch (e) { return { configured: true, ok: false, status: null, detail: `Could not reach Slack: ${(e as Error).message}` }; }
}
