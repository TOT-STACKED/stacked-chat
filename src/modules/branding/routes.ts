import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { forbidden, notFound } from '../../lib/errors.js';
import { atLeast, bestRole } from '../../lib/permissions.js';
import type { Repo } from '../../lib/repo.js';
import { assertOrgAccess, userOnly } from '../access.js';
import { assertSiteInOrg } from '../orgs/routes.js';
import { ErrorBody, Id, SECURITY } from '../schemas.js';
import type { BrandingStore } from './store.js';
import { BrandingPatch } from './validate.js';

interface Ctx { store: BrandingStore | null; repo?: Repo; gate: (orgId: string) => Promise<void> }

const BrandingOut = z.object({
  id: Id, name: z.string(), bot_name: z.string().nullable(), welcome_heading: z.string().nullable(), welcome_message: z.string().nullable(),
  primary_color: z.string().nullable(), logo_url: z.string().nullable(),
});

export async function brandingRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const store = () => { if (!ctx.store) throw notFound('Branding is not available'); return ctx.store; };

  r.get('/api/v1/orgs/:orgId/branding', {
    preHandler: app.authenticate,
    schema: {
      tags: ['settings'], summary: "How each site's chat looks (name, welcome text, colour, logo)", security: SECURITY,
      params: z.object({ orgId: Id }), response: { 200: z.object({ data: z.array(BrandingOut) }), 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    if (!atLeast(bestRole(actor, orgId, null), 'hq_admin')) throw forbidden('Only organisation admins can change how the chat looks');
    return { data: await store().list(orgId) };
  });

  r.patch('/api/v1/orgs/:orgId/sites/:siteId/branding', {
    preHandler: app.authenticate,
    schema: {
      tags: ['settings'], summary: "Change how a site's chat looks. Send an empty string to go back to the default.", security: SECURITY,
      params: z.object({ orgId: Id, siteId: Id }), body: BrandingPatch,
      response: { 200: BrandingOut, 400: ErrorBody, 402: ErrorBody, 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId, siteId } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    await ctx.gate(orgId);
    if (!atLeast(bestRole(actor, orgId, null), 'hq_admin')) throw forbidden('Only organisation admins can change how the chat looks');
    await assertSiteInOrg(ctx.repo!, orgId, siteId);
    return store().update(siteId, req.body);
  });
}
