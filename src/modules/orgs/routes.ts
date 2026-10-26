import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalId } from '../../lib/auth.js';
import { ApiHttpError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { inviteEmail, type Mailer, type SendResult } from '../../lib/email.js';
import { formatPhone, isPhoneKey, normalizePhone, phoneKey } from '../../lib/phone.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import type { SmsSender } from '../../lib/sms.js';
import type { IdempotencyStore } from '../../lib/idempotency.js';
import {
  ROLE_RANK, atLeast, bestRole, canAssignRole, canManageMembers, canReadMembers, roleScopeValid,
  type Principal, type UserPrincipal,
} from '../../lib/permissions.js';
import type { MemberRow, Repo } from '../../lib/repo.js';
import { assertOrgAccess, userOnly } from '../access.js';
import { ErrorBody, Id, MemberOut, RoleEnum, SECURITY, SiteOut } from '../schemas.js';

interface Ctx {
  repo?: Repo; idempotency: IdempotencyStore; mailer?: Mailer; /** texts invitations to people added by mobile number; null = switched off */ sms?: SmsSender | null; publicUrl: string;
  /** throws 402 when the organisation's billing makes it read-only */
  gate: (orgId: string) => Promise<void>;
  /** called after a site is added so billing can update the subscription */
  onSiteAdded?: (orgId: string) => void;
}

const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'site';

export async function orgRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const repo = (): Repo => ctx.repo!; // authenticate() has already guaranteed it exists
  const lastInvite = new Map<string, number>(); // per-member resend cooldown (per instance)
  // Every invitation text costs money and anyone can start a free trial, so texts are capped per person, per company and overall.
  const smsByActor = new RateLimiter(30, 3_600_000);
  const smsByOrg = new RateLimiter(100, 86_400_000);
  const smsAll = new RateLimiter(1000, 86_400_000);
  const smsAllowed = (orgId: string, actorId: string, count = 1) => {
    for (let i = 0; i < count; i++) if (!smsByActor.hit(actorId).allowed || !smsByOrg.hit(orgId).allowed || !smsAll.hit('all').allowed) return false;
    return true;
  };
  const smsLimited = () => new ApiHttpError(429, 'rate_limited', 'That is a lot of text invitations. Try again later, or ask Stacked support to raise the limit.');

  /** Attach each member's team ids (one query for the whole organisation). */
  async function withTeams(orgId: string, rows: MemberRow[]) {
    const links = await repo().listMemberTeams(orgId);
    const by = new Map<string, string[]>();
    for (const l of links) by.set(l.member_id, [...(by.get(l.member_id) ?? []), l.team_id]);
    return rows.map((m) => ({ ...m, team_ids: by.get(m.id) ?? [] }));
  }

  async function sendInvite(member: MemberRow, actor: UserPrincipal): Promise<SendResult> {
    if (isPhoneKey(member.email)) {
      // someone added by mobile number: the invitation is a text, and they sign in with that number
      if (!ctx.sms || !member.phone) return 'skipped';
      const org = await repo().getOrg(member.org_id);
      const first = (member.display_name ?? '').trim().split(/\s+/)[0];
      return ctx.sms.send(member.phone, `${first ? `Hi ${first}, ` : ''}${org?.name ?? 'your team'} has added you to Stacked Chat. Open ${ctx.publicUrl.replace(/\/$/, '')}/chat/ and sign in with this mobile number (${formatPhone(member.phone)}). We will text you a code.`);
    }
    if (!ctx.mailer) return 'skipped';
    const [org, site] = await Promise.all([repo().getOrg(member.org_id), member.site_id ? repo().getSite(member.site_id) : Promise.resolve(null)]);
    return ctx.mailer.send(inviteEmail({
      to: member.email, orgName: org?.name ?? 'your team', siteName: site?.name ?? null,
      inviter: actor.email, role: member.role, url: ctx.publicUrl.replace(/\/$/, '') + '/manage/',
    }));
  }

  // ---- the organisation itself --------------------------------------------------------------
  const OrgOut = z.object({ id: Id, name: z.string(), slug: z.string() });
  const CompanyName = z.string().trim().min(2).max(80).refine((v) => !/[<>]/.test(v), 'Names cannot contain < or >');

  r.get('/api/v1/orgs/:orgId', {
    preHandler: app.authenticate,
    schema: { tags: ['organisations'], summary: 'The organisation', security: SECURITY, params: z.object({ orgId: Id }), response: { 200: OrgOut, 404: ErrorBody } },
  }, async (req) => {
    const { orgId } = req.params;
    assertOrgAccess(req, orgId);
    const org = await repo().getOrg(orgId);
    if (!org) throw notFound('Organisation not found');
    return org;
  });

  r.patch('/api/v1/orgs/:orgId', {
    preHandler: app.authenticate,
    schema: {
      tags: ['organisations'], summary: 'Rename the organisation (owners and HQ admins)', security: SECURITY,
      params: z.object({ orgId: Id }), body: z.object({ name: CompanyName }),
      response: { 200: OrgOut, 400: ErrorBody, 402: ErrorBody, 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    await ctx.gate(orgId);
    if (!atLeast(bestRole(actor, orgId, null), 'hq_admin')) throw forbidden('Only organisation admins can change company details');
    return repo().renameOrg(orgId, req.body.name);
  });

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

  r.post('/api/v1/orgs/:orgId/sites', {
    preHandler: app.authenticate,
    schema: {
      tags: ['organisations'], summary: 'Add a site (venue) to the organisation', security: SECURITY,
      params: z.object({ orgId: Id }),
      body: z.object({ name: z.string().trim().min(2).max(80) }),
      response: { 201: SiteOut, 400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 409: ErrorBody, 422: ErrorBody },
    },
  }, async (req, reply) => {
    const { orgId } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    await ctx.gate(orgId);
    if (!atLeast(bestRole(actor, orgId, null), 'hq_admin')) throw forbidden('Only organisation admins can add sites');
    return ctx.idempotency.run(req, reply, principalId(actor), async () => {
      const base = slugify(req.body.name);
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const site = await repo().createSite({ org_id: orgId, name: req.body.name, slug: `${base}-${randomBytes(2).toString('hex')}` });
          ctx.onSiteAdded?.(orgId);
          return { status: 201, body: site };
        } catch (e) {
          if (!(e instanceof ApiHttpError && e.statusCode === 409)) throw e; // slug clash: try another suffix
        }
      }
      throw conflict('Could not create a unique site, please try again');
    });
  });

  r.patch('/api/v1/orgs/:orgId/sites/:siteId', {
    preHandler: app.authenticate,
    schema: {
      tags: ['organisations'], summary: 'Rename a site (owners and HQ admins)', security: SECURITY,
      params: z.object({ orgId: Id, siteId: Id }), body: z.object({ name: CompanyName }),
      response: { 200: SiteOut, 400: ErrorBody, 402: ErrorBody, 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId, siteId } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    await ctx.gate(orgId);
    if (!atLeast(bestRole(actor, orgId, null), 'hq_admin')) throw forbidden('Only organisation admins can rename sites');
    await assertSiteInOrg(repo(), orgId, siteId);
    return repo().renameSite(siteId, req.body.name);
  });

  // ---- members -----------------------------------------------------------------------------
  const visible = (p: Principal, orgId: string, m: MemberRow) =>
    p.kind === 'user' ? canReadMembers(p, orgId, m.site_id) : p.siteId === null || p.siteId === m.site_id;

  r.get('/api/v1/orgs/:orgId/members', {
    preHandler: app.authenticate,
    schema: {
      tags: ['organisations'], summary: 'List members you are allowed to see (with their teams)', security: SECURITY,
      params: z.object({ orgId: Id }),
      querystring: z.object({ site_id: Id.optional() }),
      response: { 200: z.object({ data: z.array(MemberOut) }), 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId } = req.params;
    const p = assertOrgAccess(req, orgId, 'members:read');
    const rows = await repo().listMembers(orgId, req.query.site_id);
    return { data: await withTeams(orgId, rows.filter((m) => visible(p, orgId, m))) };
  });

  /** A person is added by email (managers) or by mobile number (staff, who may not have a work email). A number needs a name. */
  const NewMemberBody = z.object({
    email: z.email().optional(),
    phone: z.string().trim().min(5).max(30).optional(),
    display_name: z.string().trim().min(1).max(120).optional(),
    role: RoleEnum,
    site_id: Id.nullable().optional(),
    team_ids: z.array(Id).max(20).optional(),
  }).refine((b) => !!b.email !== !!b.phone, { message: 'Give either an email address or a mobile number' })
    .refine((b) => !b.phone || !!b.display_name, { message: 'Give their name, so you can tell who is who' });

  r.post('/api/v1/orgs/:orgId/members', {
    preHandler: app.authenticate,
    schema: {
      tags: ['organisations'], summary: 'Invite or add a member by email or mobile number and email or text them (send an Idempotency-Key header to make retries safe)', security: SECURITY,
      params: z.object({ orgId: Id }), body: NewMemberBody,
      response: { 201: MemberOut, 400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 409: ErrorBody, 422: ErrorBody },
    },
  }, async (req, reply) => {
    const { orgId } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    await ctx.gate(orgId);
    const siteId = req.body.site_id ?? null;
    if (siteId) await assertSiteInOrg(repo(), orgId, siteId);
    const actorRole = bestRole(actor, orgId, siteId);
    if (!canManageMembers(actor, orgId, siteId) || !actorRole) throw forbidden('You cannot manage members here');
    if (!canAssignRole(actorRole, req.body.role)) throw forbidden(`You cannot grant the ${req.body.role} role`);
    if (!roleScopeValid(req.body.role, siteId)) throw badRequest(`The ${req.body.role} role ${siteId ? 'applies to the whole organisation, not a single site' : 'must be attached to a site'}`);
    const teamIds = [...new Set(req.body.team_ids ?? [])];
    await assertTeamsFit(repo(), orgId, siteId, teamIds);

    let email = req.body.email ?? ''; let phone: string | null = null;
    if (req.body.phone) {
      phone = normalizePhone(req.body.phone);
      if (!phone) throw badRequest('That does not look like a mobile number. Try 07700 900123');
      email = phoneKey(phone);
    }
    if (phone && !smsAllowed(orgId, principalId(actor))) throw smsLimited();
    return ctx.idempotency.run(req, reply, principalId(actor), async () => {
      const row = await repo().createMember({ org_id: orgId, site_id: siteId, email, display_name: req.body.display_name ?? null, phone, role: req.body.role, status: 'invited' });
      if (teamIds.length) await repo().setMemberTeams(row.id, teamIds);
      const invite = await sendInvite(row, actor);
      return { status: 201, body: { ...row, team_ids: teamIds, invite } };
    });
  });

  r.post('/api/v1/orgs/:orgId/members/:memberId/resend-invite', {
    preHandler: app.authenticate,
    schema: {
      tags: ['organisations'], summary: 'Send an invitation again, by email or text (once a minute at most)', security: SECURITY,
      params: z.object({ orgId: Id, memberId: Id }),
      response: { 200: z.object({ invite: z.enum(['sent', 'skipped', 'failed']) }), 400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 429: ErrorBody },
    },
  }, async (req) => {
    const { orgId, memberId } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    await ctx.gate(orgId);
    const target = await repo().getMember(orgId, memberId);
    if (!target) throw notFound('Member not found');
    if (!canManageMembers(actor, orgId, target.site_id)) throw forbidden('You cannot manage this member');
    if (target.status !== 'invited') throw badRequest('Only pending invitations can be re-sent');
    const last = lastInvite.get(memberId) ?? 0;
    if (Date.now() - last < 60_000) throw new ApiHttpError(429, 'rate_limited', 'That invitation was only just sent. Try again in a minute.');
    if (isPhoneKey(target.email) && !smsAllowed(orgId, principalId(actor))) throw smsLimited();
    lastInvite.set(memberId, Date.now());
    return { invite: await sendInvite(target, actor) };
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
    await ctx.gate(orgId);
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
    const updated = await repo().updateMember(memberId, { role: req.body.role, status: req.body.status });
    return (await withTeams(orgId, [updated]))[0]!;
  });

  r.put('/api/v1/orgs/:orgId/members/:memberId/teams', {
    preHandler: app.authenticate,
    schema: {
      tags: ['organisations'], summary: 'Set which teams a member belongs to (replaces the list)', security: SECURITY,
      params: z.object({ orgId: Id, memberId: Id }),
      body: z.object({ team_ids: z.array(Id).max(20) }),
      response: { 200: MemberOut, 400: ErrorBody, 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId, memberId } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    await ctx.gate(orgId);
    const target = await repo().getMember(orgId, memberId);
    if (!target) throw notFound('Member not found');
    const actorRole = bestRole(actor, orgId, target.site_id);
    if (!canManageMembers(actor, orgId, target.site_id) || !actorRole) throw forbidden('You cannot manage this member');
    if (actorRole !== 'owner' && ROLE_RANK[target.role] >= ROLE_RANK[actorRole]) throw forbidden('You cannot change a member of equal or higher rank');
    const teamIds = [...new Set(req.body.team_ids)];
    await assertTeamsFit(repo(), orgId, target.site_id, teamIds);
    await repo().setMemberTeams(memberId, teamIds);
    return { ...target, team_ids: teamIds };
  });
}

export async function assertSiteInOrg(repo: Repo, orgId: string, siteId: string) {
  const site = await repo.getSite(siteId);
  if (!site || site.org_id !== orgId) throw badRequest('That site does not belong to this organisation');
}

/** Every team must exist in this organisation and be organisation-wide or belong to the member's own site. */
export async function assertTeamsFit(repo: Repo, orgId: string, memberSiteId: string | null, teamIds: string[]) {
  for (const id of teamIds) {
    const t = await repo.getTeam(orgId, id);
    if (!t) throw badRequest('One of those teams does not exist in this organisation');
    if (t.site_id !== null && t.site_id !== memberSiteId) throw badRequest(`The team "${t.name}" belongs to a different site`);
  }
}
