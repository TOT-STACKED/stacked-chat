import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { bestRole, canManageMembers, type Principal } from '../../lib/permissions.js';
import type { Repo, TeamRow } from '../../lib/repo.js';
import { assertOrgAccess, userOnly } from '../access.js';
import { assertSiteInOrg } from '../orgs/routes.js';
import { ErrorBody, Id, SECURITY, TeamOut, NO_LINKS, noLinks } from '../schemas.js';

interface Ctx { repo?: Repo; gate: (orgId: string) => Promise<void> }

const Name = z.string().trim().min(1).max(60).refine(noLinks, NO_LINKS);

export async function teamRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const repo = (): Repo => ctx.repo!;

  /** Which teams may this caller see? Organisation-wide ones, plus teams at sites they belong to. */
  const visible = (p: Principal, orgId: string, t: TeamRow) => {
    if (p.kind === 'api_key') return p.siteId === null || t.site_id === null || t.site_id === p.siteId;
    return t.site_id === null || bestRole(p, orgId, t.site_id) !== null;
  };
  const dup = (all: TeamRow[], name: string, siteId: string | null, exceptId?: string) =>
    all.some((t) => t.id !== exceptId && t.site_id === siteId && t.name.toLowerCase() === name.toLowerCase());

  r.get('/api/v1/orgs/:orgId/teams', {
    preHandler: app.authenticate,
    schema: {
      tags: ['teams'], summary: 'List teams you can see (organisation-wide and per site)', security: SECURITY,
      params: z.object({ orgId: Id }),
      response: { 200: z.object({ data: z.array(TeamOut) }), 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId } = req.params;
    const p = assertOrgAccess(req, orgId, 'teams:read');
    return { data: (await repo().listTeams(orgId)).filter((t) => visible(p, orgId, t)) };
  });

  r.post('/api/v1/orgs/:orgId/teams', {
    preHandler: app.authenticate,
    schema: {
      tags: ['teams'], summary: 'Create a team (for the whole organisation, or one site)', security: SECURITY,
      params: z.object({ orgId: Id }),
      body: z.object({ name: Name, site_id: Id.nullable().optional() }),
      response: { 201: TeamOut, 400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 409: ErrorBody },
    },
  }, async (req, reply) => {
    const { orgId } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    await ctx.gate(orgId);
    const siteId = req.body.site_id ?? null;
    if (siteId) await assertSiteInOrg(repo(), orgId, siteId);
    if (!canManageMembers(actor, orgId, siteId)) throw forbidden('You cannot create teams here');
    if (dup(await repo().listTeams(orgId), req.body.name, siteId)) throw conflict('There is already a team with that name here');
    reply.status(201);
    return repo().createTeam({ org_id: orgId, site_id: siteId, name: req.body.name });
  });

  r.patch('/api/v1/orgs/:orgId/teams/:teamId', {
    preHandler: app.authenticate,
    schema: {
      tags: ['teams'], summary: 'Rename a team', security: SECURITY,
      params: z.object({ orgId: Id, teamId: Id }), body: z.object({ name: Name }),
      response: { 200: TeamOut, 403: ErrorBody, 404: ErrorBody, 409: ErrorBody },
    },
  }, async (req) => {
    const { orgId, teamId } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    await ctx.gate(orgId);
    const team = await repo().getTeam(orgId, teamId);
    if (!team) throw notFound('Team not found');
    if (!canManageMembers(actor, orgId, team.site_id)) throw forbidden('You cannot manage this team');
    if (dup(await repo().listTeams(orgId), req.body.name, team.site_id, team.id)) throw conflict('There is already a team with that name here');
    return repo().renameTeam(teamId, req.body.name);
  });

  r.delete('/api/v1/orgs/:orgId/teams/:teamId', {
    preHandler: app.authenticate,
    schema: {
      tags: ['teams'], summary: 'Delete a team (its members stay, they just leave the team)', security: SECURITY,
      params: z.object({ orgId: Id, teamId: Id }),
      response: { 200: z.object({ deleted: z.literal(true) }), 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId, teamId } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    await ctx.gate(orgId);
    const team = await repo().getTeam(orgId, teamId);
    if (!team) throw notFound('Team not found');
    if (!canManageMembers(actor, orgId, team.site_id)) throw forbidden('You cannot manage this team');
    await repo().deleteTeam(orgId, teamId);
    return { deleted: true as const };
  });
}
