import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { IdempotencyStore } from '../../lib/idempotency.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import {
  ROLE_RANK, bestRole, canAssignRole, canManageMembers, canReadMembers, roleScopeValid,
  type Principal, type UserPrincipal,
} from '../../lib/permissions.js';
import { principalId } from '../../lib/auth.js';
import type { MemberRow, Repo } from '../../lib/repo.js';
import { asKey, assertOrgAccess, principalOf, userOnly } from '../access.js';
import { ErrorBody, Id, MemberOut, RoleEnum, SECURITY, SiteOut } from '../schemas.js';

interface Ctx { repo?: Repo; idempotency: IdempotencyStore }

export async function orgRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const repo = (): Repo => ctx.repo!; // authenticate() has already guaranteed it exists

  // ---- sites -------------------------------------------------------------------------------
  r.get('/api/v1/orgs/:orgId/sites', {
    preHandler: app.authenticate,
    schema: {
      tags: ['organisations'], summary: 'List the sites (venues) you can see in an organisation', security: SECURITY,
      params: z.object({ orgId: Id }),
      response: { 200: z.object({ data: z.array(SiteOut) }), 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId } = req.params;
    const p = assertOrgAccess(req, orgId, 'sites:read');
    let only: string[] | undefined;
    if (p.kind === 'user') {
      // Organisation-wide members see every site; site-level members only their own.
      if (bestRole(p, orgId, null) === null) only = p.memberships.filter((m) => m.orgId === orgId && m.siteId).map((m) => m.siteId!);
    } else if (p.siteId) only = [p.siteId];
    return { data: await repo().listSites(orgId, only) };
  });

  // ---- members -----------------------------------------------------------------------------
  const visible = (p: Principal, orgId: string, m: MemberRow) =>
    p.kind === 'user' ? canReadMembers(p, orgId, m.site_id) : p.siteId === null || p.siteId === m.site_id;

  r.get('/api/v1/orgs/:orgId/members', {
    preHandler: app.authenticate,
    schema: {
      tags: ['organisations'], summary: 'List members you are allowed to see', security: SECURITY,
      params: z.object({ orgId: Id }),
      querystring: z.object({ site_id: Id.optional() }),
      response: { 200: z.object({ data: z.array(MemberOut) }), 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId } = req.params;
    const p = assertOrgAccess(req, orgId, 'members:read');
    const rows = await repo().listMembers(orgId, req.query.site_id);
    return { data: rows.filter((m) => visible(p, orgId, m)) };
  });

  const NewMemberBody = z.object({
    email: z.email(),
    display_name: z.string().trim().min(1).max(120).optional(),
    role: RoleEnum,
    site_id: Id.nullable().optional(),
  });

  r.post('/api/v1/orgs/:orgId/members', {
    preHandler: app.authenticate,
    schema: {
      tags: ['organisations'], summary: 'Invite or add a member (send an Idempotency-Key header to make retries safe)', security: SECURITY,
      params: z.object({ orgId: Id }), body: NewMemberBody,
      response: { 201: MemberOut, 400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 409: ErrorBody, 422: ErrorBody },
    },
  }, async (req, reply) => {
    const { orgId } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    const siteId = req.body.site_id ?? null;
    if (siteId) await assertSiteInOrg(repo(), orgId, siteId);
    const actorRole = bestRole(actor, orgId, siteId);
    if (!canManageMembers(actor, orgId, siteId) || !actorRole) throw forbidden('You cannot manage members here');
    if (!canAssignRole(actorRole, req.body.role)) throw forbidden(`You cannot grant the ${req.body.role} role`);
    if (!roleScopeValid(req.body.role, siteId)) throw badRequest(`The ${req.body.role} role ${siteId ? 'applies to the whole organisation, not a single site' : 'must be attached to a site'}`);

    return ctx.idempotency.run(req, reply, principalId(actor), async () => {
      const row = await repo().createMember({ org_id: orgId, site_id: siteId, email: req.body.email, display_name: req.body.display_name ?? null, role: req.body.role, status: 'invited' });
      return { status: 201, body: row };
    });
  });

  r.patch('/api/v1/orgs/:orgId/members/:memberId', {
    preHandler: app.authenticate,
    schema: {
      tags: ['organisations'], summary: "Change a member's role or disable them", security: SECURITY,
      params: z.object({ orgId: Id, memberId: Id }),
      body: z.object({ role: RoleEnum.optional(), status: z.enum(['active', 'disabled']).optional() }).refine((b) => b.role || b.status, { message: 'Provide role and/or status' }),
      response: { 200: MemberOut, 400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 409: ErrorBody },
    },
  }, async (req) => {
    const { orgId, memberId } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    const target = await repo().getMember(orgId, memberId);
    if (!target) throw notFound('Member not found');
    const actorRole = bestRole(actor, orgId, target.site_id);
    if (!canManageMembers(actor, orgId, target.site_id) || !actorRole) throw forbidden('You cannot manage this member');
    // You cannot touch someone of equal or higher rank (owners excepted).
    if (actorRole !== 'owner' && ROLE_RANK[target.role] >= ROLE_RANK[actorRole]) throw forbidden('You cannot change a member of equal or higher rank');
    if (req.body.role) {
      if (!canAssignRole(actorRole, req.body.role)) throw forbidden(`You cannot grant the ${req.body.role} role`);
      if (!roleScopeValid(req.body.role, target.site_id)) throw badRequest(`The ${req.body.role} role cannot be used at this scope`);
    }
    const losingOwner = target.role === 'owner' && target.status === 'active' &&
      ((req.body.role && req.body.role !== 'owner') || req.body.status === 'disabled');
    if (losingOwner && (await repo().countActiveOwners(orgId)) <= 1) throw conflict("You can't remove the organisation's last owner");
    return repo().updateMember(memberId, { role: req.body.role, status: req.body.status });
  });
}

export async function assertSiteInOrg(repo: Repo, orgId: string, siteId: string) {
  const site = await repo.getSite(siteId);
  if (!site || site.org_id !== orgId) throw badRequest('That site does not belong to this organisation');
}

export type { UserPrincipal };
export { asKey, principalOf };
