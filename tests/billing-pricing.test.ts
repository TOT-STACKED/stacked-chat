import { describe, expect, it } from 'vitest';
import { billingState } from '../src/modules/billing/gating.js';
import { formatGbp, priceFor, type VenueForPricing } from '../src/modules/billing/pricing.js';

const std = (n: number, active = true): VenueForPricing[] => Array.from({ length: n }, () => ({ active, billing_tier: 'standard' as const }));
const large = (n: number): VenueForPricing[] => Array.from({ length: n }, () => ({ active: true, billing_tier: 'large' as const }));
const line = (p: ReturnType<typeof priceFor>, key: string) => p.lines.find((l) => l.key === key);

describe('priceFor: standard / group switch', () => {
  it('1-4 venues pay the Venue rate (45/month)', () => {
    for (const n of [1, 2, 3, 4]) {
      const p = priceFor(std(n), 'month');
      expect(p.group_rate).toBe(false);
      expect(line(p, 'standard')).toMatchObject({ quantity: n, unit_pence: 4500 });
      expect(p.total_pence).toBe(4500 * n);
    }
  });
  it('4 -> 5 venues: every venue moves to the Group rate (39)', () => {
    const four = priceFor(std(4), 'month');
    const five = priceFor(std(5), 'month');
    expect(four.total_pence).toBe(18000);
    expect(five.group_rate).toBe(true);
    expect(line(five, 'standard')).toBeUndefined();
    expect(line(five, 'group')).toMatchObject({ quantity: 5, unit_pence: 3900 });
    expect(five.total_pence).toBe(19500);
  });
  it('5 -> 4 venues moves back to the Venue rate', () => {
    expect(priceFor(std(4), 'month').group_rate).toBe(false);
    expect(priceFor([...std(4), ...std(1, false)], 'month').group_rate).toBe(false); // the 5th is deactivated
  });
  it('inactive venues are not charged and do not count towards 5', () => {
    const p = priceFor([...std(3), ...std(10, false)], 'month');
    expect(p.active_venues).toBe(3);
    expect(p.total_pence).toBe(13500);
  });
  it('no venues, no charge, no lines', () => {
    expect(priceFor([], 'month')).toMatchObject({ lines: [], total_pence: 0, group_rate: false });
  });
});

describe('priceFor: large venues', () => {
  it('large venues are 79 and count towards the group threshold but never get the group rate', () => {
    const p = priceFor([...std(3), ...large(2)], 'month'); // 5 active
    expect(p.group_rate).toBe(true);
    expect(line(p, 'group')).toMatchObject({ quantity: 3, unit_pence: 3900 });
    expect(line(p, 'large')).toMatchObject({ quantity: 2, unit_pence: 7900 });
    expect(p.total_pence).toBe(3 * 3900 + 2 * 7900);
  });
  it('mixed below the threshold: standard 45 + large 79', () => {
    const p = priceFor([...std(2), ...large(1)], 'month');
    expect(p.group_rate).toBe(false);
    expect(p.total_pence).toBe(2 * 4500 + 7900);
  });
  it('large-only organisation pays 79 each at any size', () => {
    expect(priceFor(large(1), 'month').total_pence).toBe(7900);
    expect(priceFor(large(6), 'month').total_pence).toBe(6 * 7900);
    expect(priceFor(large(6), 'month').lines).toHaveLength(1);
  });
  it('an inactive large venue is ignored', () => {
    expect(priceFor([...std(1), { active: false, billing_tier: 'large' }], 'month').total_pence).toBe(4500);
  });
});

describe('priceFor: annual is 2 months free', () => {
  it('annual unit prices are 450 / 390 / 790', () => {
    expect(priceFor(std(1), 'year').total_pence).toBe(45000);
    expect(priceFor(std(5), 'year').total_pence).toBe(5 * 39000);
    expect(priceFor(large(1), 'year').total_pence).toBe(79000);
  });
  it('annual is exactly 10 x monthly in every combination', () => {
    for (const v of [std(1), std(4), std(5), [...std(3), ...large(2)], large(3)]) {
      expect(priceFor(v, 'year').total_pence).toBe(priceFor(v, 'month').total_pence * 10);
    }
  });
});

it('formats GBP without clutter', () => {
  expect(formatGbp(4500)).toBe('£45');
  expect(formatGbp(19550)).toBe('£195.50');
  expect(formatGbp(0)).toBe('£0');
});

describe('billingState (access gating)', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const day = 86_400_000;
  const iso = (offsetDays: number) => new Date(now.getTime() + offsetDays * day).toISOString();
  const acct = (o: Partial<Parameters<typeof billingState>[0] & object>) => ({
    status: 'active' as const, trial_ends_at: null, has_payment_method: true, past_due_since: null, canceled_at: null, ...o,
  });

  it('no billing account = unmanaged: full access, nothing shown (every current customer)', () => {
    expect(billingState(null, now)).toMatchObject({ mode: 'unmanaged', writable: true, banner: null });
  });
  it('trial: full access, countdown, and a card nudge until one is added', () => {
    expect(billingState(acct({ status: 'trialing', trial_ends_at: iso(10), has_payment_method: false }), now))
      .toMatchObject({ mode: 'full', writable: true, banner: 'trial', trial_days_left: 10 });
    expect(billingState(acct({ status: 'trialing', trial_ends_at: iso(10) }), now).banner).toBeNull();
  });
  it('trial ended with no card: restricted', () => {
    expect(billingState(acct({ status: 'trialing', trial_ends_at: iso(-1), has_payment_method: false }), now))
      .toMatchObject({ mode: 'restricted', writable: false, banner: 'trial_ended' });
  });
  it('active: full access', () => {
    expect(billingState(acct({}), now)).toMatchObject({ mode: 'full', writable: true, banner: null });
  });
  it('past_due: 7-day grace with a banner, then read-only', () => {
    expect(billingState(acct({ status: 'past_due', past_due_since: iso(-3) }), now))
      .toMatchObject({ mode: 'grace', writable: true, banner: 'past_due' });
    expect(billingState(acct({ status: 'past_due', past_due_since: iso(-6.9) }), now).mode).toBe('grace');
    expect(billingState(acct({ status: 'past_due', past_due_since: iso(-7.1) }), now))
      .toMatchObject({ mode: 'restricted', writable: false });
  });
  it('paused (trial ended, no card) is restricted', () => {
    expect(billingState(acct({ status: 'paused', trial_ends_at: iso(-2) }), now)).toMatchObject({ mode: 'restricted', writable: false });
  });
  it('canceled: read-only, data kept 90 days', () => {
    const s = billingState(acct({ status: 'canceled', canceled_at: iso(-10) }), now);
    expect(s).toMatchObject({ mode: 'canceled', writable: false });
    expect(new Date(s.retention_ends_at!).getTime()).toBe(new Date(iso(80)).getTime());
  });
});
