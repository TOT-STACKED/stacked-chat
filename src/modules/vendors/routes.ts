import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { forbidden, notFound } from '../../lib/errors.js';
import { atLeast, bestRole } from '../../lib/permissions.js';
import type { Repo } from '../../lib/repo.js';
import { assertOrgAccess, userOnly } from '../access.js';
import { plainText } from '../branding/validate.js';
import { assertSiteInOrg } from '../orgs/routes.js';
import { ErrorBody, Id, SECURITY } from '../schemas.js';
import { TECH_CATEGORIES } from './index.js';
import type { TechStackStore } from './store.js';

interface Ctx { store: TechStackStore | null; repo?: Repo; gate: (orgId: string) => Promise<void> }

const KEYS = TECH_CATEGORIES.map(([k]) => k) as [string, ...string[]];
const Stack = z.partialRecord(z.enum(KEYS), z.union([z.literal('').transform(() => undefined), plainText(60)])).transform((s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v)) as Record<string, string>);

export async function techStackRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const store = () => { if (!ctx.store) throw notFound('Tech stack is not available'); return ctx.store; };
  const admin = (req: Parameters<typeof userOnly>[0], orgId: string) => {
    const actor = userOnly(req); assertOrgAccess(req, orgId);
    if (!atLeast(bestRole(actor, orgId, null), 'hq_admin')) throw forbidden('Only organisation admins can change the tech stack');
  };

  r.get('/api/v1/orgs/:orgId/tech-stack', {
    preHandler: app.authenticate,
    schema: {
      tags: ['settings'], summary: "The systems each venue uses (EPOS, payments, rota...), so the assistant gives answers for the right product", security: SECURITY,
      params: z.object({ orgId: Id }),
      response: { 200: z.object({ categories: z.array(z.object({ key: z.string(), label: z.string() })), sites: z.array(z.object({ id: Id, name: z.string(), stack: z.record(z.string(), z.string()) })) }), 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId } = req.params; admin(req, orgId);
    return { categories: TECH_CATEGORIES.map(([key, label]) => ({ key, label })), sites: await store().list(orgId) };
  });

  r.patch('/api/v1/orgs/:orgId/sites/:siteId/tech-stack', {
    preHandler: app.authenticate,
    schema: {
      tags: ['settings'], summary: "Set the systems a venue uses. Send the whole set; an empty value clears one.", security: SECURITY,
      params: z.object({ orgId: Id, siteId: Id }), body: z.object({ stack: Stack }),
      response: { 200: z.object({ stack: z.record(z.string(), z.string()) }), 400: ErrorBody, 402: ErrorBody, 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId, siteId } = req.params; admin(req, orgId);
    await ctx.gate(orgId);
    await assertSiteInOrg(ctx.repo!, orgId, siteId);
    return { stack: await store().set(siteId, req.body.stack) };
  });
}
