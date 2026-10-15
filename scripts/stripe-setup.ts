/**
 * Creates the Stripe products/prices for per-venue billing (TEST MODE) and writes the Price IDs
 * to .env.stripe-test (git-ignored) so you can copy them into Render. Safe to run more than once.
 *
 *   STRIPE_SECRET_KEY=sk_test_... npm run stripe:setup
 */
import { writeFileSync } from 'node:fs';
import { setupStripePrices } from '../src/modules/billing/setup.js';

async function main() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) { console.error('Set STRIPE_SECRET_KEY to your Stripe TEST secret key (sk_test_...) and run again.'); process.exit(1); }
  const ids = await setupStripePrices({ secretKey, allowLive: process.env.STRIPE_ALLOW_LIVE === 'true', log: (m) => console.log(m) });
  const lines = Object.entries(ids).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  writeFileSync('.env.stripe-test', lines);
  console.log('\nWrote .env.stripe-test. Set these on Render (price IDs are not secret, but are specific to this Stripe account):\n');
  console.log(lines);
}
main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
