import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { forbidden, notFound } from '../../lib/errors.js';
import { atLeast, bestRole, canManageMembers, type Principal } from '../../lib/permissions.js';
import { assertOrgAccess, userOnly } from '../access.js';
import { ErrorBody, Id, SECURITY } from '../schemas.js';
import type { Knowledge } from './service.js';
import { knowledgeView } from './service.js';
import type { ItemRow } from './store.js';

interface Ctx { knowledge: Knowledge | null; gate: (orgId: string) => Promise<void> }

const Title = z.string().trim().min(1).max(120);
const Status = z.enum(['draft', 'published']);
const ItemOut = z.object({
  id: Id, org_id: Id, kind: z.enum(['document', 'video', 'image']), title: z.string(), status: Status, site_id: Id.nullable(),
  url: z.string().nullable(), description: z.string().nullable(), source: z.enum(['manager', 'ai_draft', 'imported']), created_by: z.string().nullable(),
  created_at: z.string(), updated_at: z.string(), published_at: z.string().nullable(), chars: z.number().nullable(),
});
const ItemDetail = ItemOut.extend({ body: z.string().nullable() });

export async function knowledgeRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const kb = (): Knowledge => { if (!ctx.knowledge) throw notFound('Knowledge is not available'); return ctx.knowledge; };

  /** May this person manage knowledge for this audience (null = the whole company)? Same rule as managing people. */
  const canWrite = (p: Principal, orgId: string, siteId: string | null) => p.kind === 'user' && canManageMembers(p, orgId, siteId);
  /** Who can SEE an item: managers of its audience (drafts included); API keys see published items for their scope. */
  const canSee = (p: Principal, orgId: string, i: ItemRow) => {
    if (p.kind === 'api_key') return i.status === 'published' && (p.siteId === null || i.site_id === null || i.site_id === p.siteId);
    const managerAnywhere = p.memberships.some((m) => m.orgId === orgId && atLeast(m.role, 'site_manager'));
    return i.site_id === null ? managerAnywhere : atLeast(bestRole(p, orgId, i.site_id), 'site_manager');
  };

  r.get('/api/v1/orgs/:orgId/knowledge', {
    preHandler: app.authenticate,
    schema: {
      tags: ['knowledge'], summary: 'List knowledge items you can see (documents, videos, images)', security: SECURITY,
      params: z.object({ orgId: Id }), response: { 200: z.object({ data: z.array(ItemOut) }), 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId } = req.params;
    const p = assertOrgAccess(req, orgId, 'kb:read');
    return { data: (await kb().list(orgId)).filter((i) => canSee(p, orgId, i)).map(knowledgeView) };
  });

  r.get('/api/v1/orgs/:orgId/knowledge/:id', {
    preHandler: app.authenticate,
    schema: {
      tags: ['knowledge'], summary: 'One knowledge item, with its text', security: SECURITY,
      params: z.object({ orgId: Id, id: Id }), response: { 200: ItemDetail, 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId, id } = req.params;
    const p = assertOrgAccess(req, orgId, 'kb:read');
    await kb().list(orgId); // adopts anything new first, so a just-added old item can be opened
    const item = await kb().get(orgId, id);
    if (!item || !canSee(p, orgId, item)) throw notFound('Knowledge item not found');
    return { ...knowledgeView(item), body: item.body };
  });

  const Create = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('document'), title: Title, body: z.string().max(200_000), site_id: Id.nullable().optional(), status: Status.default('draft') }),
    z.object({ kind: z.literal('video'), title: Title, url: z.string().trim().url().max(2000), site_id: Id.nullable().optional(), status: Status.default('draft') }),
  ]);
  r.post('/api/v1/orgs/:orgId/knowledge', {
    preHandler: app.authenticate,
    schema: {
      tags: ['knowledge'], summary: 'Add a document (text) or a video (link). Drafts are never used by the chat until published.', security: SECURITY,
      params: z.object({ orgId: Id }), body: Create,
      response: { 201: ItemDetail, 400: ErrorBody, 402: ErrorBody, 403: ErrorBody, 404: ErrorBody, 409: ErrorBody },
    },
  }, async (req, reply) => {
    const { orgId } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    await ctx.gate(orgId);
    const b = req.body; const siteId = b.site_id ?? null;
    if (!canWrite(actor, orgId, siteId)) throw forbidden(siteId ? 'You cannot add knowledge for this site' : 'Only company admins can add knowledge for the whole company');
    const item = b.kind === 'document'
      ? await kb().createDocument(orgId, { title: b.title, body: b.body, site_id: siteId, status: b.status, by: actor.email })
      : await kb().createVideo(orgId, { title: b.title, url: b.url, site_id: siteId, status: b.status, by: actor.email });
    reply.status(201);
    return { ...knowledgeView(item), body: item.body };
  });

  r.patch('/api/v1/orgs/:orgId/knowledge/:id', {
    preHandler: app.authenticate,
    schema: {
      tags: ['knowledge'], summary: 'Edit, retarget (company or one site), publish or unpublish', security: SECURITY,
      params: z.object({ orgId: Id, id: Id }),
      body: z.object({ title: Title.optional(), body: z.string().max(200_000).optional(), url: z.string().trim().url().max(2000).optional(), description: z.string().max(500).nullable().optional(), site_id: Id.nullable().optional(), status: Status.optional() })
        .refine((b) => Object.keys(b).length > 0, 'Nothing to change'),
      response: { 200: ItemDetail, 400: ErrorBody, 402: ErrorBody, 403: ErrorBody, 404: ErrorBody, 409: ErrorBody },
    },
  }, async (req) => {
    const { orgId, id } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    await ctx.gate(orgId);
    const item = await kb().get(orgId, id);
    if (!item || !canSee(actor, orgId, item)) throw notFound('Knowledge item not found');
    if (!canWrite(actor, orgId, item.site_id)) throw forbidden('You cannot change this item');
    if (req.body.site_id !== undefined && !canWrite(actor, orgId, req.body.site_id)) throw forbidden('You cannot move this item there');
    const updated = await kb().update(orgId, id, req.body);
    return { ...knowledgeView(updated), body: updated.body };
  });

  r.delete('/api/v1/orgs/:orgId/knowledge/:id', {
    preHandler: app.authenticate,
    schema: {
      tags: ['knowledge'], summary: 'Delete a knowledge item (and take it out of the chat)', security: SECURITY,
      params: z.object({ orgId: Id, id: Id }),
      response: { 200: z.object({ deleted: z.literal(true) }), 402: ErrorBody, 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId, id } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    await ctx.gate(orgId);
    const item = await kb().get(orgId, id);
    if (!item || !canSee(actor, orgId, item)) throw notFound('Knowledge item not found');
    if (!canWrite(actor, orgId, item.site_id)) throw forbidden('You cannot delete this item');
    await kb().remove(orgId, id);
    return { deleted: true as const };
  });
}
