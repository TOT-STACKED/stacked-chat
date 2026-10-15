/** Prices and rules for per-venue billing. GBP, VAT-exclusive, in pence. One place to change them. */
export type Interval = 'month' | 'year';
export type PriceKey = 'standard' | 'group' | 'large';
export type Tier = 'standard' | 'large';

export const PRICE_KEYS: PriceKey[] = ['standard', 'group', 'large'];
export const INTERVALS: Interval[] = ['month', 'year'];

export const PLAN_LABEL: Record<PriceKey, string> = { standard: 'Venue', group: 'Group', large: 'Large venue' };

/** Annual is 2 months free (10 x monthly). */
export const UNIT_PENCE: Record<PriceKey, Record<Interval, number>> = {
  standard: { month: 4500, year: 45000 },
  group: { month: 3900, year: 39000 },
  large: { month: 7900, year: 79000 },
};

/** An organisation with this many (or more) active venues gets the group rate on its standard venues. */
export const GROUP_THRESHOLD = 5;
export const TRIAL_DAYS = 30;
export const PAST_DUE_GRACE_DAYS = 7;
export const CANCELED_RETENTION_DAYS = 90;

export const PITCH = 'One price per venue. Unlimited staff. About half what per-employee apps cost.';

export const priceEnvName = (key: PriceKey, interval: Interval) => `STRIPE_PRICE_${key.toUpperCase()}_${interval === 'month' ? 'MONTHLY' : 'ANNUAL'}`;
export const ALL_PRICE_ENVS = PRICE_KEYS.flatMap((k) => INTERVALS.map((i) => priceEnvName(k, i)));
