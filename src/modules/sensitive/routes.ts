import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { forbidden, notFound } from '../../lib/errors.js';
import { atLeast, bestRole } from '../../lib/permissions.js';
import { assertOrgAccess, userOnly } from '../access.js';
import { ErrorBody, Id, SECURITY } from '../schemas.js';
import type { SensitiveSettings } from './store.js';
import { TOPIC_IDS } from './topics.js';

interface Ctx { settings: SensitiveSettings | null; gate: (orgId: string) => Promise<void> }

const TopicOut = z.object({ id: z.enum(TOPIC_IDS as [string, ...string[]]), label: z.string(), mode: z.enum(['confirm', 'manager']), summary: z.string(), enabled: z.boolean() });

export async function sensitiveRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const settings = () => { if (!ctx.settings) throw notFound('Sensitive topics are not available'); return ctx.settings; };
  const needAdmin = (req: Parameters<typeof userOnly>[0], orgId: string) => {
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    if (!atLeast(bestRole(actor, orgId, null), 'hq_admin')) throw forbidden('Only organisation admins can change sensitive topics');
  };

  r.get('/api/v1/orgs/:orgId/sensitive-topics', {
    preHandler: app.authenticate,
    schema: {
      tags: ['settings'], summary: 'Topics the chat does not handle alone (allergens: confirm with a manager; HR, incidents, legal: sent to a manager), and whether each is on', security: SECURITY,
      params: z.object({ orgId: Id }), response: { 200: z.object({ data: z.array(TopicOut) }), 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId } = req.params;
    needAdmin(req, orgId);
    return { data: await settings().list(orgId) };
  });

  r.put('/api/v1/orgs/:orgId/sensitive-topics/:topic', {
    preHandler: app.authenticate,
    schema: {
      tags: ['settings'], summary: 'Switch one sensitive topic on or off', security: SECURITY,
      params: z.object({ orgId: Id, topic: z.enum(TOPIC_IDS as [string, ...string[]]) }), body: z.object({ enabled: z.boolean() }),
      response: { 200: z.object({ data: z.array(TopicOut) }), 400: ErrorBody, 402: ErrorBody, 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId, topic } = req.params;
    needAdmin(req, orgId);
    await ctx.gate(orgId);
    await settings().set(orgId, topic as (typeof TOPIC_IDS)[number], req.body.enabled);
    return { data: await settings().list(orgId) };
  });
}
