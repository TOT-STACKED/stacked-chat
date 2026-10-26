/** Sends one text message. Never throws: a failure is 'failed', and no SMS provider set up is 'skipped' at the call site. */
export interface SmsFailure { at: string; status: number; code: number | null; message: string }
export interface SmsSender {
  send(to: string, text: string): Promise<'sent' | 'failed'>;
  /** why the last text failed, as the provider said it (never includes a key), or null if the last one worked */
  lastError?(): SmsFailure | null;
  /** asks the provider whether our keys are accepted, without sending anything */
  check?(): Promise<{ ok: boolean; detail: string }>;
}

/** Twilio's plain REST API. `from` is a sender name (letters, up to 11, such as "StackedChat"), a number, or a Messaging Service id (starts "MG"). */
export function createTwilioSender(opts: { accountSid: string; authToken: string; from: string; fetchImpl?: typeof fetch; log?: (msg: string, info: Record<string, unknown>) => void }): SmsSender {
  const f = opts.fetchImpl ?? fetch;
  const auth = 'Basic ' + Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString('base64');
  const api = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(opts.accountSid)}`;
  let last: SmsFailure | null = null;
  const fail = async (res: Response | null, err?: unknown): Promise<SmsFailure> => {
    let code: number | null = null; let message = err instanceof Error ? err.message : 'Could not reach Twilio';
    if (res) { const j = (await res.json().catch(() => ({}))) as { code?: number; message?: string }; code = j.code ?? null; message = j.message ?? `Twilio answered ${res.status}`; }
    return { at: new Date().toISOString(), status: res?.status ?? 0, code, message: message.slice(0, 300) };
  };
  return {
    async send(to, text) {
      try {
        const body = new URLSearchParams({ To: to, Body: text });
        if (/^MG[0-9a-f]{32}$/i.test(opts.from)) body.set('MessagingServiceSid', opts.from); else body.set('From', opts.from);
        const res = await f(`${api}/Messages.json`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        if (res.ok) { last = null; return 'sent'; }
        last = await fail(res); opts.log?.('sms failed', { status: last.status, code: last.code, message: last.message });
        return 'failed';
      } catch (e) { last = await fail(null, e); opts.log?.('sms failed', { status: 0, message: last.message }); return 'failed'; }
    },
    lastError: () => last,
    async check() {
      try {
        const res = await f(`${api}.json`, { headers: { Authorization: auth } });
        if (res.ok) { const j = (await res.json().catch(() => ({}))) as { status?: string; type?: string }; return { ok: j.status === 'active', detail: `Twilio accepts the keys. Account is ${j.status ?? 'unknown'} (${j.type ?? 'unknown type'}).` }; }
        const x = await fail(res); return { ok: false, detail: `Twilio refused the keys (${x.status}${x.code ? `, code ${x.code}` : ''}): ${x.message}` };
      } catch { return { ok: false, detail: 'Could not reach Twilio.' }; }
    },
  };
}
