/** Sends one text message. Never throws: a failure is 'failed', and no SMS provider set up is 'skipped' at the call site. */
export interface SmsSender { send(to: string, text: string): Promise<'sent' | 'failed'> }

/** Twilio's plain REST API. `from` is a sender name (letters, up to 11, such as "StackedChat"), a number, or a Messaging Service id (starts "MG"). */
export function createTwilioSender(opts: { accountSid: string; authToken: string; from: string; fetchImpl?: typeof fetch }): SmsSender {
  const f = opts.fetchImpl ?? fetch;
  const auth = 'Basic ' + Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString('base64');
  return {
    async send(to, text) {
      try {
        const body = new URLSearchParams({ To: to, Body: text });
        if (/^MG[0-9a-f]{32}$/i.test(opts.from)) body.set('MessagingServiceSid', opts.from); else body.set('From', opts.from);
        const res = await f(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(opts.accountSid)}/Messages.json`, {
          method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body,
        });
        return res.ok ? 'sent' : 'failed';
      } catch { return 'failed'; }
    },
  };
}
