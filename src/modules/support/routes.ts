import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notFound } from '../../lib/errors.js';
import { userOnly } from '../access.js';
import { ErrorBody, Id, SECURITY } from '../schemas.js';
import { KINDS, type Support } from './service.js';

export async function supportRoutes(app: FastifyInstance, ctx: { support: Support | null }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.post('/api/v1/support', {
    preHandler: app.authenticate,
    schema: {
      tags: ['support'], summary: 'Send a message to Stacked support. It reaches the team straight away and they reply by email.', security: SECURITY,
      body: z.object({ message: z.string().min(1).max(3000), kind: z.enum(KINDS).optional(), org_id: Id.nullable().optional(), site_id: Id.nullable().optional(),
        page: z.string().max(200).nullable().optional(), source: z.enum(['manage', 'chat']).optional(), device: z.string().max(400).nullable().optional() }),
      response: { 200: z.object({ sent: z.literal(true), emailed: z.boolean(), ticket: z.boolean(), slack: z.boolean() }), 400: ErrorBody, 401: ErrorBody, 403: ErrorBody, 429: ErrorBody, 503: ErrorBody },
    },
  }, async (req) => {
    const p = userOnly(req);
    if (!ctx.support) throw notFound('Support is not available');
    const out = await ctx.support.send(p, req.body);
    return { sent: true as const, emailed: out.emailed, ticket: out.ticket, slack: out.slack };
  });
}
