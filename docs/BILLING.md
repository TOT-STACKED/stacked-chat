# Per-venue billing (Stripe, test mode)

One price per venue. Unlimited staff. About half what per-employee apps cost.

| Rate | Monthly | Yearly (2 months free) | Who |
|---|---|---|---|
| Venue | £45 | £450 | 1 to 4 venues, up to about 75 staff each |
| Group | £39 | £390 | 5+ active venues (applies automatically; every standard venue) |
| Large venue | £79 | £790 | any venue with 75+ staff |

All prices exclude VAT. Large venues count towards the 5 but always pay £79. 30-day trial, no card to start.

## How it works

- One Stripe Customer and one Subscription per organisation. One subscription item per rate, quantity = active venues on that rate.
- `src/modules/billing/pricing.ts` decides the quantities (pure, heavily tested). `service.ts` `sync()` makes Stripe match, with proration, and does nothing when nothing differs.
- Sync runs when a venue is added or its tier/active flag changes, and nightly (`POST /api/v1/internal/billing/reconcile`) to catch venues created by the legacy sign-up flow.
- Webhook `POST /billing/webhook` verifies the signature, stores each event id so redelivery never runs twice, and handles `checkout.session.completed`, `customer.subscription.created|updated|deleted|trial_will_end`, `invoice.paid`, `invoice.payment_failed`.
- Access: trial/active = full. Payment failed = 7 days grace with an admin banner, then admins are read-only (writes return 402). Staff are never locked out of reading. Cancelled = read-only, data kept 90 days and flagged for review (nothing is auto-deleted).
- An organisation with **no billing account is unmanaged**: full access, never gated. Existing customers stay that way until their trial is started.
- Fair use: about 75 active staff per standard venue, 2,000 AI questions per venue per month (`FAIR_USE_AI_QUESTIONS`, `FAIR_USE_STAFF_PER_VENUE`). Over a limit = flagged in Manage and one Slack alert per venue per month. Nothing is ever blocked.
- Fails closed: if any Stripe setting is missing, billing answers 503 and the rest of the app is untouched. A live key (`sk_live_`) is refused unless `STRIPE_ALLOW_LIVE=true`.

## Endpoints

All owner / HQ admin only, signed-in person (not an API key):

- `GET  /api/v1/orgs/:orgId/billing/summary`
- `POST /api/v1/orgs/:orgId/billing/checkout` `{ "interval": "month" | "year" }`: starts the trial; once started, returns a Stripe Checkout URL to add a card
- `POST /api/v1/orgs/:orgId/billing/portal`: Stripe Customer Portal URL
- `PATCH /api/v1/orgs/:orgId/sites/:siteId/billing` `{ billing_tier?, active? }`

UI: Manage, Settings, Billing (`/manage/#/settings/billing`).

## Setup

1. Apply `supabase/migrations/007_billing.sql` (Supabase SQL editor, paste the file, Run).
2. Stripe dashboard, **test mode on**: Developers, API keys, copy the secret key (`sk_test_...`).
3. Create the prices: `STRIPE_SECRET_KEY=sk_test_... npm run stripe:setup`. It creates one product and six GBP prices (safe to re-run) and writes the IDs to `.env.stripe-test` (git-ignored).
4. Stripe, Settings, Billing, Customer portal: turn on, allow updating payment methods and viewing invoices; leave plan switching off (we manage that). Save.
5. Stripe, Developers, Webhooks, Add endpoint: `https://stackedchat.io/billing/webhook` (Railway staging: its own URL + `/billing/webhook`). Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`, `invoice.paid`, `invoice.payment_failed`. Copy the signing secret (`whsec_...`).
6. Set env vars on **Render** (and Railway if testing on staging): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the six `STRIPE_PRICE_*` from `.env.stripe-test`. Optional: `FAIR_USE_AI_QUESTIONS`, `FAIR_USE_STAFF_PER_VENUE`. Already set and reused: `CRON_SECRET`, `SLACK_WEBHOOK_URL`, `RESEND_API_KEY`, `RESEND_FROM`, `PUBLIC_URL`.
7. Nightly safety net: a Render Cron Job running `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://stackedchat.io/api/v1/internal/billing/reconcile`.

## Test-mode walkthrough

1. Sign in to Manage, People: make sure the company has 4 venues (Add a site).
2. Settings, Billing: **Start free trial**. See the plan, "£180 / month, excluding VAT" and "30 days left".
3. **Add card**: Stripe Checkout, card `4242 4242 4242 4242`, any future date, any CVC. Back in Manage the "No card yet" nudge goes away.
4. People, **Add a site** (the 5th). Settings, Billing now shows the **Group** rate: 5 venues at £39 = £195. Switch one venue off and it goes back to £45 each.
5. To see the end of the trial: Stripe dashboard, the subscription, **End trial**. To see a failed payment: save the card `4000 0000 0000 0341` as the payment method and end the trial; the page shows the 7-day grace banner.
