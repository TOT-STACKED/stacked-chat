import { INTERVALS, PLAN_LABEL, PRICE_KEYS, UNIT_PENCE, priceEnvName, type Interval, type PriceKey } from './plans.js';
import { encodeForm } from './stripe.js';

/** Creates (or finds) the Stripe product and the six per-venue prices. Safe to run again: prices are found by lookup key. */
export async function setupStripePrices(opts: { secretKey: string; allowLive?: boolean; fetchImpl?: typeof fetch; log?: (m: string) => void }): Promise<Record<string, string>> {
  const live = /^(sk|rk)_live_/.test(opts.secretKey);
  if (live && !opts.allowLive) throw new Error('Refusing to use a live Stripe key. Use a test key (sk_test_...), or set STRIPE_ALLOW_LIVE=true when you are ready to go live.');
  const f = opts.fetchImpl ?? fetch;
  const log = opts.log ?? (() => {});
  const call = async (method: 'GET' | 'POST', path: string, params: Record<string, unknown> = {}) => {
    const body = encodeForm(params);
    const res = await f('https://api.stripe.com' + path + (method === 'GET' && body ? '?' + body : ''), {
      method,
      headers: { Authorization: 'Bearer ' + opts.secretKey, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: method === 'POST' ? body : undefined,
    });
    const data = (await res.json()) as { error?: { message?: string } } & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!res.ok) throw new Error(`Stripe: ${data.error?.message ?? res.status}`);
    return data;
  };

  const lookup = (k: PriceKey, i: Interval) => `stackedchat_${k}_${i}`;
  const all = PRICE_KEYS.flatMap((k) => INTERVALS.map((i) => ({ k, i, key: lookup(k, i) })));

  const found = await call('GET', '/v1/prices', { lookup_keys: all.map((a) => a.key), active: true, limit: 20 });
  const existing = new Map<string, string>((found.data as Array<{ lookup_key: string; id: string }>).map((p) => [p.lookup_key, p.id]));

  let product: string | null = null;
  const out: Record<string, string> = {};
  for (const a of all) {
    let id = existing.get(a.key);
    if (id) log(`found   ${a.key} -> ${id}`);
    else {
      if (!product) product = (await call('POST', '/v1/products', { name: 'Stacked Chat', description: 'AI knowledge and team comms, priced per venue. Unlimited staff.' })).id as string;
      id = (await call('POST', '/v1/prices', {
        product, currency: 'gbp', unit_amount: UNIT_PENCE[a.k][a.i], tax_behavior: 'exclusive',
        recurring: { interval: a.i }, lookup_key: a.key, nickname: `${PLAN_LABEL[a.k]} (${a.i === 'month' ? 'monthly' : 'annual'})`,
        metadata: { plan: a.k },
      })).id as string;
      log(`created ${a.key} -> ${id}`);
    }
    out[priceEnvName(a.k, a.i)] = id;
  }
  return out;
}
