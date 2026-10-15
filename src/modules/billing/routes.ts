import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiHttpError, forbidden, unauthorized } from '../../lib/errors.js';
import { atLeast, bestRole } from '../../lib/permissions.js';
import { assertOrgAccess, userOnly } from '../access.js';
import { ErrorBody, Id, SECURITY } from '../schemas.js';
import type { BillingConfig } from './config.js';
import type { Billing } from './service.js';
import { SignatureError, verifyWebhookSignature } from './stripe.js';
import { safeEqualStr } from './util.js';

interface Ctx { billing: Billing | null; config: BillingConfig | null; notConfiguredReason: string }

const SummaryOut = z.looseObject({ currency: z.literal('gbp'), excludes_vat: z.boolean(), pitch: z.string() });
const CheckoutOut = z.union([
  z.object({ action: z.literal('trial_started'), trial_ends_at: z.string() }),
  z.object({ action: z.literal('redirect'), url: z.string() }),
]);
const SiteBillingOut = z.object({ id: Id, org_id: Id, name: z.string(), billing_tier: z.enum(['standard', 'large']), active: z.boolean() });

const notConfigured = (reason: string) => new ApiHttpError(503, 'billing_not_configured', reason);

export async function billingRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const need = (): { billing: Billing; config: BillingConfig } => {
    if (!ctx.billing || !ctx.config) throw notConfigured(ctx.notConfiguredReason);
    return { billing: ctx.billing, config: ctx.config };
  };
  /** Billing is for owners and HQ admins, signed in as a person (never an API key). */
  const billingAdmin = (req: Parameters<typeof userOnly>[0], orgId: string) => {
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    if (!atLeast(bestRole(actor, orgId, null), 'hq_admin')) throw forbidden('Only owners and HQ admins can manage billing');
    return actor;
  };

  r.get('/api/v1/orgs/:orgId/billing/summary', {
    preHandler: app.authenticate,
    schema: {
      tags: ['billing'], summary: 'Plan, venue counts, price, trial countdown and fair-use usage', security: SECURITY,
      params: z.object({ orgId: Id }),
      response: { 200: SummaryOut, 404: ErrorBody, 403: ErrorBody, 503: ErrorBody },
    },
  }, async (req) => {
    const { orgId } = req.params;
    billingAdmin(req, orgId);
    return need().billing.summary(orgId);
  });

  r.post('/api/v1/orgs/:orgId/billing/checkout', {
    preHandler: app.authenticate,
    schema: {
      tags: ['billing'], security: SECURITY,
      summary: 'Start the 30-day free trial (no card), or, once started, open Stripe to add a card',
      params: z.object({ orgId: Id }),
      body: z.object({ interval: z.enum(['month', 'year']).default('month') }).default({ interval: 'month' }),
      response: { 200: CheckoutOut, 400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 409: ErrorBody, 503: ErrorBody },
    },
  }, async (req) => {
    const { orgId } = req.params;
    const actor = billingAdmin(req, orgId);
    return need().billing.startOrAddCard(orgId, { interval: req.body.interval, email: actor.email });
  });

  r.post('/api/v1/orgs/:orgId/billing/portal', {
    preHandler: app.authenticate,
    schema: {
      tags: ['billing'], summary: 'Open the Stripe Customer Portal (card, invoices, details)', security: SECURITY,
      params: z.object({ orgId: Id }),
      response: { 200: z.object({ url: z.string() }), 403: ErrorBody, 404: ErrorBody, 409: ErrorBody, 503: ErrorBody },
    },
  }, async (req) => {
    const { orgId } = req.params;
    billingAdmin(req, orgId);
    return need().billing.portal(orgId);
  });

  r.patch('/api/v1/orgs/:orgId/sites/:siteId/billing', {
    preHandler: app.authenticate,
    schema: {
      tags: ['billing'], summary: "Set a venue's tier (standard/large) or switch it on or off", security: SECURITY,
      params: z.object({ orgId: Id, siteId: Id }),
      body: z.object({ billing_tier: z.enum(['standard', 'large']).optional(), active: z.boolean().optional() })
        .refine((b) => b.billing_tier !== undefined || b.active !== undefined, 'Nothing to change'),
      response: { 200: SiteBillingOut, 400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 503: ErrorBody },
    },
  }, async (req) => {
    const { orgId, siteId } = req.params;
    billingAdmin(req, orgId);
    return need().billing.setSiteBilling(orgId, siteId, req.body);
  });

  // Nightly safety net, called by a scheduler with the shared CRON_SECRET.
  r.post('/api/v1/internal/billing/reconcile', {
    schema: { hide: true },
  }, async (req) => {
    const { billing, config } = need();
    const given = req.headers['x-cron-secret'];
    if (!config.cronSecret || typeof given !== 'string' || !safeEqualStr(given, config.cronSecret)) throw unauthorized('Bad cron secret');
    return billing.reconcile();
  });
}

/** Stripe's webhook. Own scope so it can read the raw body (needed to check the signature). */
export async function billingWebhookRoute(app: FastifyInstance, ctx: Ctx) {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.post('/billing/webhook', { schema: { hide: true } }, async (req, reply) => {
    if (!ctx.billing || !ctx.config) throw notConfigured(ctx.notConfiguredReason);
    const raw = req.body as Buffer;
    try {
      verifyWebhookSignature(raw, req.headers['stripe-signature'] as string | undefined, ctx.config.webhookSecret);
    } catch (e) {
      if (e instanceof SignatureError) return reply.status(400).send({ error: { code: 'bad_signature', message: e.message } });
      throw e;
    }
    let event: { id: string; type: string; created?: number; data: { object: Record<string, unknown> } };
    try { event = JSON.parse(raw.toString('utf8')); } catch { return reply.status(400).send({ error: { code: 'bad_request', message: 'Not JSON' } }); }
    if (!event?.id || !event.type || !event.data?.object) return reply.status(400).send({ error: { code: 'bad_request', message: 'Not a Stripe event' } });
    const result = await ctx.billing.handleEvent(event); // throws -> 500 -> Stripe retries
    return reply.status(200).send({ received: true, result });
  });
}
