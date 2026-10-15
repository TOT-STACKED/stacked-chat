import { createHmac, timingSafeEqual } from 'node:crypto';

/** Normalised view of a Stripe subscription: only what billing needs. */
export interface StripeSub {
  id: string;
  customer: string;
  status: string; // trialing | active | past_due | canceled | unpaid | incomplete | incomplete_expired | paused
  trial_end: number | null; // unix seconds
  current_period_end: number | null;
  canceled_at: number | null;
  interval: 'month' | 'year' | null;
  default_payment_method: string | null;
  items: Array<{ id: string; price_id: string; quantity: number }>;
  metadata: Record<string, string>;
}

export type ItemOp =
  | { id: string; quantity: number }                // change quantity of an existing item
  | { price: string; quantity: number }             // add a new item
  | { id: string; deleted: true };                  // remove an item

/** The few Stripe operations billing needs, behind an interface so tests never call Stripe. */
export interface StripeApi {
  createCustomer(p: { name: string; email?: string; orgId: string }): Promise<{ id: string }>;
  createTrialSubscription(p: { customerId: string; orgId: string; items: Array<{ price: string; quantity: number }>; trialEnd: number }): Promise<StripeSub>;
  getSubscription(id: string): Promise<StripeSub>;
  updateSubscriptionItems(id: string, ops: ItemOp[], idempotencyKey: string): Promise<StripeSub>;
  resumeSubscription(id: string): Promise<StripeSub>;
  createSetupCheckout(p: { customerId: string; orgId: string; subscriptionId: string; successUrl: string; cancelUrl: string }): Promise<{ url: string }>;
  createPortalSession(p: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  /** After a card is saved through Checkout: make it the default for the customer and the subscription. */
  attachDefaultPaymentMethod(p: { customerId: string; subscriptionId: string; setupIntentId: string }): Promise<void>;
}

export class StripeError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) { super(message); }
}

// ---- request encoding (Stripe takes form bodies with bracketed keys) ----------------------
export function encodeForm(value: Record<string, unknown>): string {
  const pairs: string[] = [];
  const walk = (prefix: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(`${prefix}[${i}]`, x));
    else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(`${prefix}[${k}]`, x);
    else pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(v))}`);
  };
  for (const [k, v] of Object.entries(value)) walk(k, v);
  return pairs.join('&');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

export function normaliseSubscription(raw: Raw): StripeSub {
  const items: Raw[] = raw.items?.data ?? [];
  const pm = raw.default_payment_method;
  return {
    id: raw.id,
    customer: typeof raw.customer === 'string' ? raw.customer : raw.customer?.id,
    status: raw.status,
    trial_end: raw.trial_end ?? null,
    // newer API versions keep the period on each item, older ones on the subscription
    current_period_end: raw.current_period_end ?? items[0]?.current_period_end ?? null,
    canceled_at: raw.canceled_at ?? raw.ended_at ?? null,
    interval: items[0]?.price?.recurring?.interval ?? null,
    default_payment_method: typeof pm === 'string' ? pm : pm?.id ?? null,
    items: items.map((i) => ({ id: i.id, price_id: typeof i.price === 'string' ? i.price : i.price?.id, quantity: i.quantity ?? 0 })),
    metadata: raw.metadata ?? {},
  };
}

/** Stripe over fetch (same style as the rest of the codebase: no SDK). */
export function createStripeApi(opts: { secretKey: string; fetchImpl?: typeof fetch; apiVersion?: string }): StripeApi {
  const f = opts.fetchImpl ?? fetch;
  async function call(method: 'GET' | 'POST', path: string, params?: Record<string, unknown>, idempotencyKey?: string): Promise<Raw> {
    const body = params ? encodeForm(params) : undefined;
    const res = await f('https://api.stripe.com' + path + (method === 'GET' && body ? '?' + body : ''), {
      method,
      headers: {
        Authorization: 'Bearer ' + opts.secretKey,
        'Stripe-Version': opts.apiVersion ?? '2025-03-31.basil',
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: method === 'POST' ? body : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as Raw;
    if (!res.ok) throw new StripeError(res.status, data?.error?.message ?? `Stripe error ${res.status}`, data?.error?.code);
    return data;
  }
  const sub = async (p: Promise<Raw>) => normaliseSubscription(await p);

  return {
    createCustomer: async ({ name, email, orgId }) => {
      const c = await call('POST', '/v1/customers', { name, email, metadata: { org_id: orgId } });
      return { id: c.id };
    },
    createTrialSubscription: ({ customerId, orgId, items, trialEnd }) => sub(call('POST', '/v1/subscriptions', {
      customer: customerId,
      items,
      trial_end: trialEnd,
      // No card needed to start. If none is added by the end of the trial, pause rather than charge or cancel.
      trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
      payment_settings: { save_default_payment_method: 'on_subscription' },
      metadata: { org_id: orgId },
    })),
    getSubscription: (id) => sub(call('GET', `/v1/subscriptions/${encodeURIComponent(id)}`)),
    updateSubscriptionItems: (id, ops, key) => sub(call('POST', `/v1/subscriptions/${encodeURIComponent(id)}`, {
      items: ops.map((o) => ('deleted' in o ? { id: o.id, deleted: true } : o)),
      proration_behavior: 'create_prorations',
    }, key)),
    resumeSubscription: (id) => sub(call('POST', `/v1/subscriptions/${encodeURIComponent(id)}/resume`, { billing_cycle_anchor: 'now' })),
    createSetupCheckout: async ({ customerId, orgId, subscriptionId, successUrl, cancelUrl }) => {
      const s = await call('POST', '/v1/checkout/sessions', {
        mode: 'setup', customer: customerId, currency: 'gbp', payment_method_types: ['card'],
        success_url: successUrl, cancel_url: cancelUrl,
        metadata: { org_id: orgId, subscription_id: subscriptionId },
        setup_intent_data: { metadata: { org_id: orgId, subscription_id: subscriptionId } },
      });
      return { url: s.url };
    },
    createPortalSession: async ({ customerId, returnUrl }) => {
      const s = await call('POST', '/v1/billing_portal/sessions', { customer: customerId, return_url: returnUrl });
      return { url: s.url };
    },
    attachDefaultPaymentMethod: async ({ customerId, subscriptionId, setupIntentId }) => {
      const si = await call('GET', `/v1/setup_intents/${encodeURIComponent(setupIntentId)}`);
      const pm = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id;
      if (!pm) throw new StripeError(400, 'Setup intent has no payment method');
      await call('POST', `/v1/customers/${encodeURIComponent(customerId)}`, { invoice_settings: { default_payment_method: pm } });
      await call('POST', `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, { default_payment_method: pm });
    },
  };
}

// ---- webhook signature (Stripe-Signature: t=...,v1=...) ------------------------------------
export class SignatureError extends Error {}

/** Verifies a Stripe webhook against the raw body. Throws SignatureError if it is not genuine or too old. */
export function verifyWebhookSignature(rawBody: Buffer | string, header: string | undefined, secret: string, opts: { toleranceSec?: number; now?: number } = {}): void {
  if (!header) throw new SignatureError('Missing Stripe-Signature header');
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!t || !sigs.length) throw new SignatureError('Malformed Stripe-Signature header');
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
  const ok = sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) throw new SignatureError('Signature does not match');
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (Math.abs(now - Number(t)) > (opts.toleranceSec ?? 300)) throw new SignatureError('Timestamp outside tolerance');
}

/** Test helper: builds a header the same way Stripe does. */
export function signWebhook(rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;
}
