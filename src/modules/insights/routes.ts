import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { forbidden, notFound } from '../../lib/errors.js';
import { atLeast, bestRole, canManageMembers, type UserPrincipal } from '../../lib/permissions.js';
import { assertOrgAccess, userOnly } from '../access.js';
import { ErrorBody, Id, SECURITY } from '../schemas.js';
import type { Insights } from './service.js';
import type { InsightsStore } from './store.js';

interface Ctx { insights: Insights | null; store: InsightsStore | null; gate: (orgId: string) => Promise<void> }

const Days = z.coerce.number().int().default(30);

export async function insightsRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const svc = (): Insights => { if (!ctx.insights || !ctx.store) throw notFound('Insights are not available'); return ctx.insights; };

  /** Company admins see every venue; a site manager sees only the venues they run. Anyone else: not allowed. */
  async function visibleSites(actor: UserPrincipal, orgId: string, only?: string): Promise<string[]> {
    const all = (await ctx.store!.sites(orgId)).map((s) => s.id);
    const ids = atLeast(bestRole(actor, orgId, null), 'hq_admin') ? all : all.filter((id) => atLeast(bestRole(actor, orgId, id), 'site_manager'));
    if (!ids.length) throw forbidden('Insights are for managers');
    if (only) { if (!ids.includes(only)) throw forbidden('You cannot see insights for that site'); return [only]; }
    return ids;
  }

  const Totals = z.object({ questions: z.number(), conversations: z.number(), people: z.number(), unanswered: z.number(), answer_rate: z.number().nullable() });
  r.get('/api/v1/orgs/:orgId/insights', {
    preHandler: app.authenticate,
    schema: {
      tags: ['insights'], summary: 'What people ask, what the AI could not answer, and usage by team and site', security: SECURITY,
      params: z.object({ orgId: Id }), querystring: z.object({ days: Days, site_id: Id.optional() }),
      response: {
        200: z.object({
          days: z.number(), totals: Totals,
          most_asked: z.array(z.object({ key: z.string(), question: z.string(), count: z.number(), sites: z.number() })),
          unanswered: z.array(z.object({ key: z.string(), question: z.string(), count: z.number(), sites: z.number(), site_names: z.array(z.string()), last_asked: z.string(), draft_item_id: z.string().nullable(), draft_status: z.string().nullable() })),
          by_team: z.array(z.object({ name: z.string(), count: z.number() })),
          by_site: z.array(z.object({ site_id: z.string(), name: z.string(), count: z.number() })),
        }),
        400: ErrorBody, 403: ErrorBody, 404: ErrorBody,
      },
    },
  }, async (req) => {
    const { orgId } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    const siteIds = await visibleSites(actor, orgId, req.query.site_id);
    return svc().compute(orgId, { days: req.query.days, siteIds });
  });

  r.post('/api/v1/orgs/:orgId/insights/drafts', {
    preHandler: app.authenticate,
    schema: {
      tags: ['insights'], security: SECURITY,
      summary: 'Write draft answers (never published) for unanswered questions, into Knowledge for review',
      params: z.object({ orgId: Id }),
      body: z.object({ keys: z.array(z.string().min(1).max(300)).min(1).max(10), days: z.number().int().min(1).max(366).default(30) }),
      response: {
        200: z.object({
          created: z.array(z.object({ key: z.string(), item_id: z.string(), title: z.string(), site_id: z.string().nullable() })),
          skipped: z.array(z.object({ key: z.string(), reason: z.string() })), ai: z.boolean(),
        }),
        400: ErrorBody, 402: ErrorBody, 403: ErrorBody, 404: ErrorBody,
      },
    },
  }, async (req) => {
    const { orgId } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    await ctx.gate(orgId);
    const siteIds = await visibleSites(actor, orgId);
    return svc().draftAnswers(orgId, { keys: req.body.keys, days: req.body.days, siteIds, by: actor.email, canWriteTo: (s) => canManageMembers(actor, orgId, s) });
  });
}
