import type { Config } from '../../config.js';
import { ALL_PRICE_ENVS, priceEnvName, type Interval, type PriceKey } from './plans.js';

export interface BillingConfig {
  secretKey: string;
  webhookSecret: string;
  prices: Record<PriceKey, Record<Interval, string>>;
  publicUrl: string;
  fairUse: { aiQuestionsPerMonth: number; staffPerVenue: number };
  cronSecret: string | null;
  /** posts a one-line alert to Stacked's Slack (optional) */
  notify: ((text: string) => Promise<void>) | null;
}

export type BillingConfigResult = { ok: true; config: BillingConfig } | { ok: false; reason: string };

/**
 * Billing needs every Stripe setting. If any is missing (or the key is a live key without an explicit
 * opt-in) billing endpoints answer 503 and nothing else in the app is affected: it fails closed.
 * The reason names the env var only, never a value.
 */
export function loadBillingConfig(c: Config): BillingConfigResult {
  const missing = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', ...ALL_PRICE_ENVS].filter((k) => !((c as unknown as Record<string, unknown>)[k]));
  if (missing.length) return { ok: false, reason: `Billing is not configured (missing: ${missing.join(', ')})` };
  const key = c.STRIPE_SECRET_KEY!;
  const live = key.startsWith('sk_live_') || key.startsWith('rk_live_');
  if (live && c.STRIPE_ALLOW_LIVE !== 'true') {
    return { ok: false, reason: 'Billing is in test mode only: a live Stripe key was supplied but STRIPE_ALLOW_LIVE is not "true"' };
  }
  const cfg = c as unknown as Record<string, string>;
  const prices = {} as BillingConfig['prices'];
  for (const k of ['standard', 'group', 'large'] as PriceKey[]) {
    prices[k] = { month: cfg[priceEnvName(k, 'month')]!, year: cfg[priceEnvName(k, 'year')]! };
  }
  const slack = c.SLACK_WEBHOOK_URL;
  return {
    ok: true,
    config: {
      secretKey: key, webhookSecret: c.STRIPE_WEBHOOK_SECRET!, prices,
      publicUrl: c.PUBLIC_URL.replace(/\/$/, ''),
      fairUse: { aiQuestionsPerMonth: c.FAIR_USE_AI_QUESTIONS, staffPerVenue: c.FAIR_USE_STAFF_PER_VENUE },
      cronSecret: c.CRON_SECRET ?? null,
      notify: slack ? async (text) => { try { await fetch(slack, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }); } catch { /* alerts are best effort */ } } : null,
    },
  };
}
