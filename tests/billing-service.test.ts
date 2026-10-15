import { beforeEach, describe, expect, it } from 'vitest';
import { createBilling, type Billing } from '../src/modules/billing/service.js';
import { FakeBillingStore, FakeStripe, testBillingConfig } from '../src/testing/billing-fakes.js';
import { FakeMailer } from '../src/testing/fakes.js';

const ORG = 'org-1';
const cfg = testBillingConfig();
const P = cfg.prices;

let store: FakeBillingStore; let stripe: FakeStripe; let billing: Billing; let mailer: FakeMailer; let clock: Date; let alerts: string[];

beforeEach(() => {
  store = new FakeBillingStore(); stripe = new FakeStripe(cfg); mailer = new FakeMailer(); clock = new Date('2026-10-15T12:00:00Z'); alerts = [];
  billing = createBilling({
    store, stripe, mailer, config: testBillingConfig({ notify: async (t) => { alerts.push(t); } }),
    orgName: async () => 'Acme Group', now: () => clock,
  });
});

const addVenues = (n: number, over: { billing_tier?: 'standard' | 'large'; active?: boolean } = {}) => Array.from({ length: n }, (_, i) => store.addSite(ORG, `V${store.sites.length + i}`, over));
const start = async (interval: 'month' | 'year' = 'month') => {
  await billing.startOrAddCard(ORG, { interval, email: 'boss@acme.test' });
  return (await store.getAccount(ORG))!.stripe_subscription_id!;
};

describe('starting the trial', () => {
  it('creates a customer and a 30-day trial with no card, charging the right items', async () => {
    addVenues(2);
    const r = await billing.startOrAddCard(ORG, { interval: 'month', email: 'boss@acme.test' });
    expect(r.action).toBe('trial_started');
    const a = (await store.getAccount(ORG))!;
    expect(a).toMatchObject({ status: 'trialing', interval: 'month', has_payment_method: false });
    expect(new Date(a.trial_ends_at!).getTime()).toBe(clock.getTime() + 30 * 86_400_000);
    expect(stripe.qty(a.stripe_subscription_id!, P.standard.month)).toBe(2);
  });
  it('needs at least one active venue', async () => {
    await expect(billing.startOrAddCard(ORG, { interval: 'month', email: 'a@b.test' })).rejects.toMatchObject({ statusCode: 400 });
    addVenues(1, { active: false });
    await expect(billing.startOrAddCard(ORG, { interval: 'month', email: 'a@b.test' })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('a second call (trial already running) opens Stripe to add a card instead of starting again', async () => {
    addVenues(1);
    await start();
    const again = await billing.startOrAddCard(ORG, { interval: 'month', email: 'boss@acme.test' });
    expect(again).toEqual({ action: 'redirect', url: 'https://checkout.stripe.test/session' });
    expect(stripe.customers).toHaveLength(1);
    expect(stripe.subs.size).toBe(1);
  });
  it('simultaneous starts create one customer and one subscription', async () => {
    addVenues(1);
    await Promise.all([1, 2, 3].map(() => billing.startOrAddCard(ORG, { interval: 'month', email: 'a@b.test' })));
    expect(stripe.customers).toHaveLength(1);
    expect(stripe.subs.size).toBe(1);
  });
  it('a start that failed after creating the customer reuses that customer', async () => {
    addVenues(1);
    await store.saveAccount(ORG, { stripe_customer_id: 'cus_existing' });
    await billing.startOrAddCard(ORG, { interval: 'month', email: 'a@b.test' });
    expect(stripe.calls).not.toContain('createCustomer');
    expect((await store.getAccount(ORG))!.stripe_customer_id).toBe('cus_existing');
  });
  it('a cancelled subscription cannot be restarted from here', async () => {
    addVenues(1); await start();
    await store.saveAccount(ORG, { status: 'canceled' });
    await expect(billing.startOrAddCard(ORG, { interval: 'month', email: 'a@b.test' })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('syncSubscription: quantities follow the venues', () => {
  it('4 -> 5 venues: all standard venues move to the group price', async () => {
    addVenues(4); const sub = await start();
    expect(stripe.qty(sub, P.standard.month)).toBe(4);
    addVenues(1);
    const r = await billing.sync(ORG);
    expect(r.changed).toBe(true);
    expect(stripe.qty(sub, P.standard.month)).toBe(0);
    expect(stripe.qty(sub, P.group.month)).toBe(5);
    expect(r.pricing?.total_pence).toBe(5 * 3900);
    const op = stripe.updates.at(-1)!.ops;
    expect(op).toEqual(expect.arrayContaining([{ price: P.group.month, quantity: 5 }, expect.objectContaining({ deleted: true })]));
  });
  it('5 -> 4 venues: moves back to the standard price', async () => {
    const v = addVenues(5); const sub = await start();
    expect(stripe.qty(sub, P.group.month)).toBe(5);
    await billing.setSiteBilling(ORG, v[4]!.id, { active: false });
    expect(stripe.qty(sub, P.group.month)).toBe(0);
    expect(stripe.qty(sub, P.standard.month)).toBe(4);
  });
  it('mixed large and standard, below and above the threshold', async () => {
    const v = addVenues(3); const sub = await start();
    await billing.setSiteBilling(ORG, v[0]!.id, { billing_tier: 'large' });
    expect(stripe.qty(sub, P.standard.month)).toBe(2);
    expect(stripe.qty(sub, P.large.month)).toBe(1);
    addVenues(2); // 5 active in total, 1 large
    await billing.sync(ORG);
    expect(stripe.qty(sub, P.standard.month)).toBe(0);
    expect(stripe.qty(sub, P.group.month)).toBe(4);
    expect(stripe.qty(sub, P.large.month)).toBe(1);
    await billing.setSiteBilling(ORG, v[0]!.id, { billing_tier: 'standard' }); // large back to standard
    expect(stripe.qty(sub, P.large.month)).toBe(0);
    expect(stripe.qty(sub, P.group.month)).toBe(5);
  });
  it('annual organisations use the annual prices throughout', async () => {
    addVenues(4); const sub = await start('year');
    expect(stripe.qty(sub, P.standard.year)).toBe(4);
    addVenues(1); await billing.sync(ORG);
    expect(stripe.qty(sub, P.group.year)).toBe(5);
    expect(stripe.qty(sub, P.group.month)).toBe(0);
    expect(stripe.subs.get(sub)!.items.every((i) => i.price_id.endsWith('_y'))).toBe(true);
  });
  it('is idempotent: running it again with nothing changed sends nothing to Stripe', async () => {
    addVenues(5); await start();
    const before = stripe.updates.length;
    for (let i = 0; i < 3; i++) expect((await billing.sync(ORG)).changed).toBe(false);
    expect(stripe.updates.length).toBe(before);
  });
  it('concurrent syncs end in the right state with no duplicate items', async () => {
    addVenues(4); const sub = await start();
    addVenues(1);
    await Promise.all([billing.sync(ORG), billing.sync(ORG), billing.sync(ORG)]);
    const items = stripe.subs.get(sub)!.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ price_id: P.group.month, quantity: 5 });
  });
  it('adds nothing for inactive venues and leaves the subscription alone with none', async () => {
    const v = addVenues(1); const sub = await start();
    const r = await billing.setSiteBilling(ORG, v[0]!.id, { active: false });
    expect(r.active).toBe(false);
    expect(stripe.qty(sub, P.standard.month)).toBe(1); // untouched: Stripe needs one item
    expect((await billing.sync(ORG)).skipped).toBe('no_active_venues');
  });
  it('does nothing before there is a subscription, and for cancelled ones', async () => {
    addVenues(2);
    expect((await billing.sync(ORG)).skipped).toBe('no_subscription');
    await start(); await store.saveAccount(ORG, { status: 'canceled' });
    expect((await billing.sync(ORG)).skipped).toBe('canceled');
  });
  it('a Stripe failure is retried on the next sync and never throws from syncQuietly', async () => {
    addVenues(4); const sub = await start(); addVenues(1);
    stripe.failNextUpdate = true;
    await expect(billing.syncQuietly(ORG)).resolves.toBeUndefined();
    expect(stripe.qty(sub, P.group.month)).toBe(0);
    await billing.sync(ORG);
    expect(stripe.qty(sub, P.group.month)).toBe(5);
  });
  it('refuses to change a venue that belongs to another organisation', async () => {
    const other = store.addSite('org-2', 'Other');
    addVenues(1); await start();
    await expect(billing.setSiteBilling(ORG, other.id, { active: false })).rejects.toMatchObject({ statusCode: 404 });
  });
  it('toggling 4 -> 5 -> 4 -> 5 lands correctly each time (no stale cached request)', async () => {
    const v = addVenues(4); const sub = await start(); const fifth = addVenues(1)[0]!;
    for (const active of [true, false, true]) {
      await billing.setSiteBilling(ORG, fifth.id, { active });
      expect(stripe.qty(sub, active ? P.group.month : P.standard.month)).toBe(active ? 5 : 4);
    }
    void v;
  });
});

describe('summary', () => {
  it('previews the price before a plan, then reports it on a plan', async () => {
    addVenues(5);
    const before = await billing.summary(ORG);
    expect(before.account).toBeNull();
    expect(before.pricing).toMatchObject({ group_rate: true, total_pence: 19500 });
    expect(before.next_invoice_pence).toBeNull();
    expect(before.state.mode).toBe('unmanaged');
    await start();
    const after = await billing.summary(ORG);
    expect(after.state).toMatchObject({ mode: 'full', trial_days_left: 30, banner: 'trial' });
    expect(after.next_invoice_pence).toBe(19500);
    expect(after.venues).toMatchObject({ active: 5, standard: 5, large: 0 });
    expect(after.excludes_vat).toBe(true);
    expect(after.pitch).toBe('One price per venue. Unlimited staff. About half what per-employee apps cost.');
  });
});

describe('gating', () => {
  it('writes are allowed for unmanaged, trialing and active organisations', async () => {
    addVenues(1);
    await expect(billing.assertWritable(ORG)).resolves.toBeUndefined();
    await start();
    await expect(billing.assertWritable(ORG)).resolves.toBeUndefined();
  });
  it('writes are refused with 402 once restricted, and allowed again when fixed', async () => {
    addVenues(1); await start();
    await store.saveAccount(ORG, { status: 'past_due', past_due_since: new Date(clock.getTime() - 8 * 86_400_000).toISOString() });
    await expect(billing.assertWritable(ORG)).rejects.toMatchObject({ statusCode: 402, code: 'billing_required' });
    await store.saveAccount(ORG, { status: 'active', past_due_since: null });
    await expect(billing.assertWritable(ORG)).resolves.toBeUndefined();
  });
  it('fails open: if billing state cannot be read nobody is locked out', async () => {
    store.getAccount = async () => { throw new Error('db down'); };
    await expect(billing.assertWritable(ORG)).resolves.toBeUndefined();
    expect((await billing.stateForSite('x')).writable).toBe(true);
  });
});

describe('fair use metering', () => {
  it('counts questions per venue and flags (once, without blocking) when over the monthly cap', async () => {
    const [v] = addVenues(1);
    for (let i = 0; i < 2000; i++) await billing.recordQuestion(v!.id);
    expect(alerts).toHaveLength(0);
    await billing.recordQuestion(v!.id);
    await billing.recordQuestion(v!.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain('has passed 2000 AI questions');
    const u = (await billing.usageFor(ORG)).find((x) => x.site_id === v!.id)!;
    expect(u).toMatchObject({ ai_questions: 2002, over_ai: true });
  });
  it('the AI cap is configurable', async () => {
    const small = createBilling({ store, stripe, config: testBillingConfig({ fairUse: { aiQuestionsPerMonth: 3, staffPerVenue: 75 } }), orgName: async () => 'x' });
    const [v] = addVenues(1);
    for (let i = 0; i < 4; i++) await small.recordQuestion(v!.id);
    expect((await small.usageFor(ORG))[0]).toMatchObject({ over_ai: true });
  });
  it('a new month starts from zero', async () => {
    const [v] = addVenues(1);
    for (let i = 0; i < 5; i++) await billing.recordQuestion(v!.id);
    clock = new Date('2026-11-02T09:00:00Z');
    expect((await billing.usageFor(ORG))[0]!.ai_questions).toBe(0);
  });
  it('flags standard venues over ~75 active staff; large venues are not capped on staff', async () => {
    const [s, l] = [store.addSite(ORG, 'Std'), store.addSite(ORG, 'Hotel', { billing_tier: 'large' })];
    store.staff = { [s.id]: 76, [l.id]: 140 };
    const u = await billing.usageFor(ORG);
    expect(u.find((x) => x.site_id === s.id)).toMatchObject({ active_staff: 76, over_staff: true });
    expect(u.find((x) => x.site_id === l.id)).toMatchObject({ active_staff: 140, over_staff: false });
    expect((await billing.summary(ORG)).fair_use.any_over).toBe(true);
  });
  it('never throws, even if the database is down (the chat must not break)', async () => {
    store.bumpUsage = async () => { throw new Error('db down'); };
    await expect(billing.recordQuestion('some-site')).resolves.toBeUndefined();
  });
});

describe('reconcile (nightly safety net)', () => {
  it('fixes subscriptions whose venues changed outside our code', async () => {
    addVenues(4); const sub = await start();
    addVenues(1); // e.g. created by the legacy sign-up flow, which writes straight to the database
    const r = await billing.reconcile();
    expect(r).toMatchObject({ accounts: 1, changed: 1, failed: 0 });
    expect(stripe.qty(sub, P.group.month)).toBe(5);
  });
  it('one failing organisation does not stop the rest', async () => {
    addVenues(1); await start();
    await store.saveAccount('org-2', { stripe_subscription_id: 'sub_missing', status: 'active' });
    store.addSite('org-2', 'X');
    const r = await billing.reconcile();
    expect(r).toMatchObject({ accounts: 2, failed: 1 });
  });
  it('reports cancelled organisations past 90 days for review, deleting nothing', async () => {
    addVenues(1); await start();
    await store.saveAccount(ORG, { status: 'canceled', canceled_at: new Date(clock.getTime() - 91 * 86_400_000).toISOString() });
    const r = await billing.reconcile();
    expect(r.purgeDue).toEqual([ORG]);
    expect(alerts.some((a) => a.includes('90-day'))).toBe(true);
    expect(store.sites).toHaveLength(1);
  });
});
