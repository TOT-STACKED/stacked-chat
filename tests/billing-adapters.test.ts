import { describe, expect, it } from 'vitest';
import type { Db, DbResult } from '../src/lib/supabase.js';
import { createSupabaseBillingStore } from '../src/modules/billing/store.js';
import { SignatureError, createStripeApi, encodeForm, normaliseSubscription, signWebhook, verifyWebhookSignature } from '../src/modules/billing/stripe.js';

describe('Stripe request encoding', () => {
  it('encodes nested objects and arrays the way Stripe expects', () => {
    expect(decodeURIComponent(encodeForm({
      customer: 'cus_1', items: [{ price: 'price_a', quantity: 2 }, { id: 'si_1', deleted: true }],
      trial_settings: { end_behavior: { missing_payment_method: 'pause' } }, skip: undefined, none: null,
    }))).toBe('customer=cus_1&items[0][price]=price_a&items[0][quantity]=2&items[1][id]=si_1&items[1][deleted]=true&trial_settings[end_behavior][missing_payment_method]=pause');
  });
});

describe('Stripe client', () => {
  function stripeWith(response: object, status = 200) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const api = createStripeApi({
      secretKey: 'sk_test_x',
      fetchImpl: (async (url: string, init: RequestInit) => { calls.push({ url, init }); return { ok: status < 300, status, json: async () => response } as Response; }) as unknown as typeof fetch,
    });
    return { api, calls };
  }
  const rawSub = { id: 'sub_1', customer: 'cus_1', status: 'trialing', trial_end: 1800000000, metadata: { org_id: 'o' },
    items: { data: [{ id: 'si_1', quantity: 3, current_period_end: 1810000000, price: { id: 'price_a', recurring: { interval: 'year' } } }] } };

  it('sends test-mode auth, a pinned API version and an idempotency key on item updates', async () => {
    const { api, calls } = stripeWith(rawSub);
    const s = await api.updateSubscriptionItems('sub_1', [{ id: 'si_1', quantity: 5 }, { price: 'price_b', quantity: 1 }, { id: 'si_2', deleted: true }], 'key-1');
    const c = calls[0]!;
    expect(c.url).toBe('https://api.stripe.com/v1/subscriptions/sub_1');
    const h = c.init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer sk_test_x');
    expect(h['Stripe-Version']).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(h['Idempotency-Key']).toBe('key-1');
    const body = decodeURIComponent(String(c.init.body));
    expect(body).toContain('proration_behavior=create_prorations');
    expect(body).toContain('items[0][id]=si_1&items[0][quantity]=5');
    expect(body).toContain('items[2][deleted]=true');
    expect(s).toMatchObject({ id: 'sub_1', interval: 'year', current_period_end: 1810000000, items: [{ id: 'si_1', price_id: 'price_a', quantity: 3 }] });
  });
  it('starts a trial with no card: pause (not charge, not cancel) if none is added', async () => {
    const { api, calls } = stripeWith(rawSub);
    await api.createTrialSubscription({ customerId: 'cus_1', orgId: 'o', trialEnd: 1800000000, items: [{ price: 'price_a', quantity: 3 }] });
    const body = decodeURIComponent(String(calls[0]!.init.body));
    expect(body).toContain('trial_end=1800000000');
    expect(body).toContain('trial_settings[end_behavior][missing_payment_method]=pause');
    expect(body).toContain('metadata[org_id]=o');
  });
  it('turns Stripe errors into a StripeError without leaking the key', async () => {
    const { api } = stripeWith({ error: { message: 'No such price', code: 'resource_missing' } }, 400);
    await expect(api.getSubscription('sub_1')).rejects.toMatchObject({ status: 400, message: 'No such price' });
    await api.getSubscription('x').catch((e) => expect(String(e.message)).not.toContain('sk_test'));
  });
  it('normalises both the old and the new subscription shapes', () => {
    expect(normaliseSubscription({ ...rawSub, current_period_end: 99 }).current_period_end).toBe(99);
    expect(normaliseSubscription(rawSub).current_period_end).toBe(1810000000);
    expect(normaliseSubscription({ ...rawSub, default_payment_method: { id: 'pm_1' } }).default_payment_method).toBe('pm_1');
  });
});

describe('webhook signature', () => {
  const body = '{"id":"evt_1"}';
  it('accepts a genuine signature and rejects everything else', () => {
    expect(() => verifyWebhookSignature(body, signWebhook(body, 'whsec_a'), 'whsec_a')).not.toThrow();
    expect(() => verifyWebhookSignature(body, signWebhook(body, 'whsec_a'), 'whsec_b')).toThrow(SignatureError);
    expect(() => verifyWebhookSignature(body + ' ', signWebhook(body, 'whsec_a'), 'whsec_a')).toThrow(SignatureError);
    expect(() => verifyWebhookSignature(body, undefined, 'whsec_a')).toThrow(SignatureError);
    expect(() => verifyWebhookSignature(body, 't=1', 'whsec_a')).toThrow(SignatureError);
  });
  it('rejects old timestamps (replay) but allows a few minutes of clock drift', () => {
    const now = 2_000_000_000_000;
    const at = (secAgo: number) => signWebhook(body, 's', Math.floor(now / 1000) - secAgo);
    expect(() => verifyWebhookSignature(body, at(120), 's', { now })).not.toThrow();
    expect(() => verifyWebhookSignature(body, at(900), 's', { now })).toThrow(SignatureError);
  });
  it('accepts when any one of several v1 signatures matches (key rotation)', () => {
    const good = signWebhook(body, 's').replace('t=', 't=');
    const [t, v1] = good.split(',') as [string, string];
    expect(() => verifyWebhookSignature(body, `${t},v1=deadbeef,${v1}`, 's')).not.toThrow();
  });
});

describe('Supabase billing store', () => {
  function recordingDb(...answers: DbResult[]) {
    const calls: Array<{ path: string; init?: { method?: string; body?: unknown; headers?: Record<string, string> } }> = [];
    const db: Db = { ping: async () => true, rest: async <T>(path: string, init?: never) => { calls.push({ path, init }); return (answers.shift() ?? { status: 200, data: [] }) as DbResult<T>; } };
    return { db, calls };
  }
  it('claims a Stripe event with insert-if-absent, and treats an already-seen finished event as a duplicate', async () => {
    const a = recordingDb({ status: 201, data: [{ id: 'evt_1' }] });
    expect(await createSupabaseBillingStore(a.db).claimEvent('evt_1', 'invoice.paid')).toBe('new');
    expect(a.calls[0]!.init?.headers?.Prefer).toContain('ignore-duplicates');
    const b = recordingDb({ status: 201, data: [] }, { status: 200, data: [{ processed_at: '2026-01-01' }] });
    expect(await createSupabaseBillingStore(b.db).claimEvent('evt_1', 'invoice.paid')).toBe('duplicate');
    const c = recordingDb({ status: 201, data: [] }, { status: 200, data: [{ processed_at: null }] }); // earlier attempt crashed
    expect(await createSupabaseBillingStore(c.db).claimEvent('evt_1', 'invoice.paid')).toBe('new');
  });
  it('bumps usage through the atomic database function', async () => {
    const a = recordingDb({ status: 200, data: 7 });
    expect(await createSupabaseBillingStore(a.db).bumpUsage('site-1', '2026-10-01')).toBe(7);
    expect(a.calls[0]).toMatchObject({ path: '/rpc/usage_bump', init: { method: 'POST', body: { p_site: 'site-1', p_month: '2026-10-01' } } });
  });
  it('counts staff as active, non-kiosk members who belong to a site', async () => {
    const a = recordingDb({ status: 200, data: [{ site_id: 's1' }, { site_id: 's1' }, { site_id: 's2' }] });
    expect(await createSupabaseBillingStore(a.db).countActiveStaff('org-1')).toEqual({ s1: 2, s2: 1 });
    expect(a.calls[0]!.path).toContain('status=eq.active');
    expect(a.calls[0]!.path).toContain('role=neq.kiosk');
  });
  it('only reports a flag as new for the call that set it', async () => {
    expect(await createSupabaseBillingStore(recordingDb({ status: 200, data: [{ site_id: 's' }] }).db).flagUsage('s', '2026-10-01')).toBe(true);
    expect(await createSupabaseBillingStore(recordingDb({ status: 200, data: [] }).db).flagUsage('s', '2026-10-01')).toBe(false);
  });
  it('surfaces database errors instead of hiding them', async () => {
    await expect(createSupabaseBillingStore(recordingDb({ status: 500, data: null }).db).getAccount('o')).rejects.toThrow(/get account failed/);
  });
});

import { setupStripePrices } from '../src/modules/billing/setup.js';
describe('stripe setup script', () => {
  function fakeStripe(existing: Array<{ lookup_key: string; id: string }> = []) {
    const created: Record<string, string>[] = [];
    let n = 0;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      if (init.method === 'GET') return { ok: true, json: async () => ({ data: existing }) } as Response;
      const body = Object.fromEntries(new URLSearchParams(String(init.body))) as Record<string, string>;
      created.push({ path, ...body });
      return { ok: true, json: async () => ({ id: `${path.includes('product') ? 'prod' : 'price'}_${++n}` }) } as Response;
    }) as unknown as typeof fetch;
    return { fetchImpl, created };
  }
  it('creates one product and six GBP, VAT-exclusive prices at the agreed amounts', async () => {
    const { fetchImpl, created } = fakeStripe();
    const ids = await setupStripePrices({ secretKey: 'sk_test_x', fetchImpl });
    expect(Object.keys(ids).sort()).toEqual([
      'STRIPE_PRICE_GROUP_ANNUAL', 'STRIPE_PRICE_GROUP_MONTHLY', 'STRIPE_PRICE_LARGE_ANNUAL', 'STRIPE_PRICE_LARGE_MONTHLY', 'STRIPE_PRICE_STANDARD_ANNUAL', 'STRIPE_PRICE_STANDARD_MONTHLY',
    ]);
    expect(created.filter((c) => c.path === '/v1/products')).toHaveLength(1);
    const prices = created.filter((c) => c.path === '/v1/prices');
    expect(prices).toHaveLength(6);
    expect(prices.every((p) => p.currency === 'gbp' && p.tax_behavior === 'exclusive')).toBe(true);
    const by = (k: string) => Number(prices.find((p) => p.lookup_key === k)!.unit_amount);
    expect([by('stackedchat_standard_month'), by('stackedchat_standard_year'), by('stackedchat_group_month'), by('stackedchat_group_year'), by('stackedchat_large_month'), by('stackedchat_large_year')])
      .toEqual([4500, 45000, 3900, 39000, 7900, 79000]);
  });
  it('is safe to run again: existing prices are reused, nothing duplicated', async () => {
    const existing = ['standard', 'group', 'large'].flatMap((k) => ['month', 'year'].map((i) => ({ lookup_key: `stackedchat_${k}_${i}`, id: `price_old_${k}_${i}` })));
    const { fetchImpl, created } = fakeStripe(existing);
    const ids = await setupStripePrices({ secretKey: 'sk_test_x', fetchImpl });
    expect(created).toHaveLength(0);
    expect(ids.STRIPE_PRICE_GROUP_MONTHLY).toBe('price_old_group_month');
  });
  it('refuses a live key unless explicitly allowed', async () => {
    await expect(setupStripePrices({ secretKey: 'sk_live_x', fetchImpl: fakeStripe().fetchImpl })).rejects.toThrow(/live/i);
  });
});
