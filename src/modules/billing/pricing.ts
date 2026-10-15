import { GROUP_THRESHOLD, PLAN_LABEL, UNIT_PENCE, type Interval, type PriceKey, type Tier } from './plans.js';

export interface VenueForPricing { active: boolean; billing_tier: Tier }
export interface PricingLine { key: PriceKey; label: string; quantity: number; unit_pence: number; total_pence: number }
export interface Pricing {
  interval: Interval;
  active_venues: number;
  standard_venues: number;
  large_venues: number;
  /** true when the organisation has reached the group threshold, so standard venues get the group rate */
  group_rate: boolean;
  lines: PricingLine[];
  total_pence: number;
}

/**
 * What an organisation should be charged, from its venues alone. Pure, so it is easy to test heavily.
 * All ACTIVE venues (large ones included) count towards the group threshold; only standard venues
 * move to the group rate. Large venues stay at the large rate either way.
 */
export function priceFor(venues: VenueForPricing[], interval: Interval): Pricing {
  const active = venues.filter((v) => v.active);
  const large = active.filter((v) => v.billing_tier === 'large').length;
  const standard = active.length - large;
  const group = active.length >= GROUP_THRESHOLD;
  const stdKey: PriceKey = group ? 'group' : 'standard';

  const lines: PricingLine[] = [];
  const add = (key: PriceKey, quantity: number) => {
    if (quantity <= 0) return;
    const unit = UNIT_PENCE[key][interval];
    lines.push({ key, label: PLAN_LABEL[key], quantity, unit_pence: unit, total_pence: unit * quantity });
  };
  add(stdKey, standard);
  add('large', large);

  return {
    interval, active_venues: active.length, standard_venues: standard, large_venues: large, group_rate: group,
    lines, total_pence: lines.reduce((n, l) => n + l.total_pence, 0),
  };
}

export const formatGbp = (pence: number) => '£' + (pence / 100).toLocaleString('en-GB', { minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 });
