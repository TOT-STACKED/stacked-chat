import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalOf } from '../access.js';
import { Id, RoleEnum, SECURITY } from '../schemas.js';

const Me = z.union([
  z.object({
    kind: z.literal('user'),
    user: z.object({ id: Id, email: z.string() }),
    memberships: z.array(z.object({
      member_id: Id, role: RoleEnum,
      organisation: z.object({ id: Id, name: z.string().nullable() }),
      site: z.object({ id: Id, name: z.string().nullable() }).nullable(),
    })),
  }),
  z.object({
    kind: z.literal('api_key'),
    api_key: z.object({ id: Id, organisation_id: Id, site_id: Id.nullable(), scopes: z.array(z.string()) }),
  }),
]);

export async function meRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get('/api/v1/me', {
    preHandler: app.authenticate,
    schema: { tags: ['identity'], summary: 'Who am I? (session or API key)', security: SECURITY, response: { 200: Me } },
  }, async (req) => {
    const p = principalOf(req);
    if (p.kind === 'api_key') {
      return { kind: 'api_key' as const, api_key: { id: p.keyId, organisation_id: p.orgId, site_id: p.siteId, scopes: p.scopes } };
    }
    return {
      kind: 'user' as const,
      user: { id: p.userId, email: p.email },
      memberships: p.memberships.map((m) => ({
        member_id: m.memberId, role: m.role,
        organisation: { id: m.orgId, name: m.orgName ?? null },
        site: m.siteId ? { id: m.siteId, name: m.siteName ?? null } : null,
      })),
    };
  });
}
