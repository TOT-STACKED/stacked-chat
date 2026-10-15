import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalId } from '../../lib/auth.js';
import { forbidden, notFound } from '../../lib/errors.js';
import type { IdempotencyStore } from '../../lib/idempotency.js';
import { API_SCOPES, displayPrefix, generateKey, hashKey } from '../../lib/keys.js';
import { canManageApiKeys } from '../../lib/permissions.js';
import type { ApiKeyRow, Repo } from '../../lib/repo.js';
import { assertOrgAccess, userOnly } from '../access.js';
import { assertSiteInOrg } from '../orgs/routes.js';
import { ApiKeyOut, ErrorBody, Id, SECURITY } from '../schemas.js';

interface Ctx { repo?: Repo; idempotency: IdempotencyStore }

const toOut = (k: ApiKeyRow) => ({
  id: k.id, org_id: k.org_id, site_id: k.site_id, name: k.name, scopes: k.scopes, key_prefix: k.key_prefix,
  created_at: k.created_at, last_used_at: k.last_used_at, expires_at: k.expires_at, revoked: !!k.revoked_at,
});

export async function apiKeyRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const repo = (): Repo => ctx.repo!;

  r.get('/api/v1/orgs/:orgId/api-keys', {
    preHandler: app.authenticate,
    schema: {
      tags: ['api keys'], summary: 'List API keys (the secret itself is never returned again)', security: SECURITY,
      params: z.object({ orgId: Id }),
      response: { 200: z.object({ data: z.array(ApiKeyOut) }), 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId } = req.params;
    const p = userOnly(req);
    assertOrgAccess(req, orgId);
    if (!canManageApiKeys(p, orgId)) throw forbidden('Only organisation admins can manage API keys');
    return { data: (await repo().listApiKeys(orgId)).map(toOut) };
  });

  r.post('/api/v1/orgs/:orgId/api-keys', {
    preHandler: app.authenticate,
    schema: {
      tags: ['api keys'], summary: 'Create an API key. The key is shown ONCE in this response.', security: SECURITY,
      params: z.object({ orgId: Id }),
      body: z.object({
        name: z.string().trim().min(1).max(80),
        scopes: z.array(z.enum(API_SCOPES)).min(1),
        site_id: Id.nullable().optional(),
        expires_in_days: z.number().int().min(1).max(730).optional(),
      }),
      response: { 201: z.object({ key: z.string(), api_key: ApiKeyOut }), 400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 422: ErrorBody },
    },
  }, async (req, reply) => {
    const { orgId } = req.params;
    const p = userOnly(req);
    assertOrgAccess(req, orgId);
    if (!canManageApiKeys(p, orgId)) throw forbidden('Only organisation admins can manage API keys');
    const siteId = req.body.site_id ?? null;
    if (siteId) await assertSiteInOrg(repo(), orgId, siteId);

    return ctx.idempotency.run(req, reply, principalId(p), async () => {
      const key = generateKey();
      const row = await repo().insertApiKey({
        org_id: orgId, site_id: siteId, name: req.body.name, scopes: [...new Set(req.body.scopes)],
        key_prefix: displayPrefix(key), key_hash: hashKey(key), created_by: p.userId,
        expires_at: req.body.expires_in_days ? new Date(Date.now() + req.body.expires_in_days * 86_400_000).toISOString() : null,
      });
      return { status: 201, body: { key, api_key: toOut(row) } };
    });
  });

  r.delete('/api/v1/orgs/:orgId/api-keys/:keyId', {
    preHandler: app.authenticate,
    schema: {
      tags: ['api keys'], summary: 'Revoke an API key (immediate)', security: SECURITY,
      params: z.object({ orgId: Id, keyId: Id }),
      response: { 200: z.object({ revoked: z.literal(true) }), 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId, keyId } = req.params;
    const p = userOnly(req);
    assertOrgAccess(req, orgId);
    if (!canManageApiKeys(p, orgId)) throw forbidden('Only organisation admins can manage API keys');
    if (!(await repo().revokeApiKey(orgId, keyId))) throw notFound('API key not found (or already revoked)');
    return { revoked: true as const };
  });
}
