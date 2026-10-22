import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { forbidden, notFound } from '../../lib/errors.js';
import { atLeast, bestRole, canManageMembers, type Principal } from '../../lib/permissions.js';
import { assertOrgAccess, userOnly } from '../access.js';
import { ErrorBody, Id, SECURITY } from '../schemas.js';
import { MAX_BODY, MAX_TITLE, type Comms } from './service.js';
import type { AnnouncementRow } from './store.js';

interface Ctx { comms: Comms | null; gate: (orgId: string) => Promise<void> }

const Stats = z.object({ recipients: z.number(), read: z.number(), acked: z.number() });
export const AnnouncementOut = z.object({
  id: Id, org_id: Id, site_id: Id.nullable(), team_id: Id.nullable(), title: z.string(), body: z.string(), requires_ack: z.boolean(),
  created_by: z.string().nullable(), created_at: z.string(), updated_at: z.string(),
});
export const FeedOut = z.object({
  id: Id, title: z.string(), body: z.string(), requires_ack: z.boolean(), created_by: z.string().nullable(), created_at: z.string(),
  audience: z.object({ site_id: Id.nullable(), team_id: Id.nullable() }), read_at: z.string().nullable(), acked_at: z.string().nullable(),
});
const view = (a: AnnouncementRow) => ({ id: a.id, org_id: a.org_id, site_id: a.site_id, team_id: a.team_id, title: a.title, body: a.body, requires_ack: a.requires_ack, created_by: a.created_by, created_at: a.created_at, updated_at: a.updated_at });
const Title = z.string().trim().min(1).max(MAX_TITLE);
const Body = z.string().trim().min(1).max(MAX_BODY + 200);

export async function communicateRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const comms = (): Comms => { if (!ctx.comms) throw notFound('Communicate is not available'); return ctx.comms; };
  const canWrite = (p: Principal, orgId: string, siteId: string | null) => p.kind === 'user' && canManageMembers(p, orgId, siteId);
  /** A company-wide update is visible to any manager in the company; a venue's (or venue team's) to that venue's managers. */
  const canSee = (p: Principal, orgId: string, siteId: string | null) => {
    if (p.kind !== 'user') return false;
    return siteId === null ? p.memberships.some((m) => m.orgId === orgId && atLeast(m.role, 'site_manager')) : atLeast(bestRole(p, orgId, siteId), 'site_manager');
  };
  const byName = (p: Principal) => (p.kind === 'user' ? p.email : 'a manager');

  r.get('/api/v1/orgs/:orgId/announcements', {
    preHandler: app.authenticate,
    schema: { tags: ['communicate'], summary: 'Updates you can see, newest first, with how many people have read each', security: SECURITY, params: z.object({ orgId: Id }),
      response: { 200: z.object({ data: z.array(AnnouncementOut.extend({ stats: Stats })) }), 403: ErrorBody, 404: ErrorBody } },
  }, async (req) => {
    const { orgId } = req.params; const p = userOnly(req); assertOrgAccess(req, orgId);
    const rows = await comms().list(orgId, (a) => canSee(p, orgId, a.site_id));
    return { data: rows.map((x) => ({ ...view(x.item), stats: x.stats })) };
  });

  r.post('/api/v1/orgs/:orgId/announcements', {
    preHandler: app.authenticate,
    schema: {
      tags: ['communicate'], summary: 'Send an update to the company, a venue or a team', security: SECURITY, params: z.object({ orgId: Id }),
      body: z.object({ title: Title, body: Body, site_id: Id.nullable().optional(), team_id: Id.nullable().optional(), requires_ack: z.boolean().optional(), email: z.boolean().optional() }),
      response: { 201: AnnouncementOut.extend({ emailed: z.number() }), 400: ErrorBody, 402: ErrorBody, 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req, reply) => {
    const { orgId } = req.params; const p = userOnly(req); assertOrgAccess(req, orgId); await ctx.gate(orgId);
    const aud = await comms().audienceFor(orgId, { site_id: req.body.site_id ?? null, team_id: req.body.team_id ?? null });
    if (!canWrite(p, orgId, aud.site_id)) throw forbidden(aud.site_id ? 'You cannot send updates to this venue' : 'Only company admins can send updates to the whole company');
    const out = await comms().create(orgId, { ...req.body, by: p.email, byName: byName(p) });
    reply.status(201); return { ...view(out.item), emailed: out.emailed };
  });

  r.patch('/api/v1/orgs/:orgId/announcements/:id', {
    preHandler: app.authenticate,
    schema: { tags: ['communicate'], summary: 'Correct the wording of an update', security: SECURITY, params: z.object({ orgId: Id, id: Id }),
      body: z.object({ title: Title.optional(), body: Body.optional(), requires_ack: z.boolean().optional() }), response: { 200: AnnouncementOut, 400: ErrorBody, 402: ErrorBody, 403: ErrorBody, 404: ErrorBody } },
  }, async (req) => {
    const { orgId, id } = req.params; const p = userOnly(req); assertOrgAccess(req, orgId); await ctx.gate(orgId);
    const cur = await comms().get(orgId, id);
    if (!cur || !canSee(p, orgId, cur.site_id)) throw notFound('Update not found');
    if (!canWrite(p, orgId, cur.site_id)) throw forbidden('You cannot change this update');
    return view(await comms().update(orgId, id, req.body));
  });

  r.delete('/api/v1/orgs/:orgId/announcements/:id', {
    preHandler: app.authenticate,
    schema: { tags: ['communicate'], summary: 'Take an update down', security: SECURITY, params: z.object({ orgId: Id, id: Id }), response: { 200: z.object({ ok: z.literal(true) }), 403: ErrorBody, 404: ErrorBody } },
  }, async (req) => {
    const { orgId, id } = req.params; const p = userOnly(req); assertOrgAccess(req, orgId);
    const cur = await comms().get(orgId, id);
    if (!cur || !canSee(p, orgId, cur.site_id)) throw notFound('Update not found');
    if (!canWrite(p, orgId, cur.site_id)) throw forbidden('You cannot take this update down');
    await comms().remove(orgId, id);
    return { ok: true as const };
  });

  r.get('/api/v1/orgs/:orgId/announcements/:id/readers', {
    preHandler: app.authenticate,
    schema: { tags: ['communicate'], summary: 'Who has read an update, and who has not', security: SECURITY, params: z.object({ orgId: Id, id: Id }),
      response: { 200: z.object({ item: AnnouncementOut, stats: Stats, people: z.array(z.object({ email: z.string(), name: z.string(), read_at: z.string().nullable(), acked_at: z.string().nullable() })) }), 403: ErrorBody, 404: ErrorBody } },
  }, async (req) => {
    const { orgId, id } = req.params; const p = userOnly(req); assertOrgAccess(req, orgId);
    const d = await comms().readers(orgId, id);
    if (!d || !canSee(p, orgId, d.item.site_id)) throw notFound('Update not found');
    return { item: view(d.item), stats: d.stats, people: d.people };
  });
}
