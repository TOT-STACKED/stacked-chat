import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiHttpError, forbidden, notFound } from '../../lib/errors.js';
import { atLeast, bestRole, type UserPrincipal } from '../../lib/permissions.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import type { Repo } from '../../lib/repo.js';
import { userOnly } from '../access.js';
import { extractAsks, groupAsks } from '../insights/analyze.js';
import type { BrandingStore } from '../branding/store.js';
import type { InsightsStore } from '../insights/store.js';
import type { TechStackStore } from '../vendors/store.js';
import { ErrorBody, Id, SECURITY } from '../schemas.js';
import type { Help } from './help.js';
import type { Ops } from '../operations/service.js';
import type { Comms } from '../communicate/service.js';
import { FeedOut } from '../communicate/routes.js';
import type { Training } from '../training/service.js';
import { LearnerCourse, ListedOut, ResultOut } from '../training/routes.js';
import { RunOut, ChecklistOut } from '../operations/routes.js';
import { MAX_MESSAGE, type Chat, type Who } from './service.js';

interface Ctx {
  chat: Chat | null; repo?: Repo; branding: BrandingStore | null; insights: InsightsStore | null; techStack?: TechStackStore | null; help?: Help | null; ops?: Ops | null; comms?: Comms | null; training?: Training | null;
  perMinute?: number; now?: () => number;
}

const Branding = z.object({ bot_name: z.string().nullable(), welcome_heading: z.string().nullable(), welcome_message: z.string().nullable(), primary_color: z.string().nullable(), logo_url: z.string().nullable() });
const DEFAULT_SUGGESTIONS = ['Where do I find the opening checklist?', 'What is the holiday request process?', 'Who do I call about a delivery problem?'];

export async function chatRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const chat = (): Chat => { if (!ctx.chat) throw notFound('Chat is not available'); return ctx.chat; };
  const repo = (): Repo => ctx.repo!;
  const limiter = new RateLimiter(ctx.perMinute ?? 20, 60_000, ctx.now);
  const popular = new Map<string, { at: number; q: string[] }>(); // suggestions per site, refreshed every 10 minutes

  const nameOf = (email: string, display: string | null) => display?.trim() || (email.split('@')[0] ?? '').split(/[._-]/)[0]!.replace(/^./, (c) => c.toUpperCase());

  /** Every venue this person can chat at: their own venue(s), or all of them for company-wide people. */
  async function sitesFor(p: UserPrincipal) {
    const out: Array<{ org_id: string; org_name: string; site_id: string; site_name: string; slug: string }> = [];
    for (const orgId of new Set(p.memberships.map((m) => m.orgId))) {
      const orgWide = p.memberships.some((m) => m.orgId === orgId && m.siteId === null);
      const only = orgWide ? undefined : p.memberships.filter((m) => m.orgId === orgId && m.siteId).map((m) => m.siteId!);
      const org = await repo().getOrg(orgId);
      for (const s of await repo().listSites(orgId, only)) out.push({ org_id: orgId, org_name: org?.name ?? 'Your company', site_id: s.id, site_name: s.name, slug: s.slug });
    }
    return out;
  }

  async function whoAsks(p: UserPrincipal, siteId: string): Promise<Who> {
    const site = await repo().getSite(siteId);
    if (!site || bestRole(p, site.org_id, siteId) === null) throw forbidden('You do not have access to that venue');
    const [org, members, links, branding, techStack] = await Promise.all([repo().getOrg(site.org_id), repo().listMembers(site.org_id), repo().listMemberTeams(site.org_id), ctx.branding?.list(site.org_id).catch(() => []), ctx.techStack?.get(siteId).catch(() => null)]);
    const mine = members.filter((m) => m.email.toLowerCase() === p.email.toLowerCase() && m.status === 'active');
    const ids = new Set(mine.map((m) => m.id));
    // managers: which venues they look after, so they can ask how their team is getting on
    const orgWide = atLeast(bestRole(p, site.org_id, null), 'hq_admin');
    const managed = orgWide || p.memberships.some((m) => m.orgId === site.org_id && atLeast(m.role, 'site_manager'))
      ? (await repo().listSites(site.org_id)).filter((s) => orgWide || atLeast(bestRole(p, site.org_id, s.id), 'site_manager')).map((s) => s.id) : [];
    return {
      ...(managed.length || orgWide ? { manages: { all: orgWide, siteIds: managed } } : {}),
      email: p.email, name: nameOf(p.email, mine.find((m) => m.display_name)?.display_name ?? null), orgId: site.org_id, orgName: org?.name ?? 'your company',
      siteId, siteName: site.name, teamIds: links.filter((l) => ids.has(l.member_id)).map((l) => l.team_id),
      botName: (branding ?? []).find((b) => b.id === siteId)?.bot_name ?? null, techStack: techStack ?? null,
    };
  }

  async function suggestionsFor(siteId: string): Promise<string[]> {
    const hit = popular.get(siteId); const t = (ctx.now ?? Date.now)();
    if (hit && t - hit.at < 600_000) return hit.q;
    let q: string[] = [];
    try {
      if (ctx.insights) {
        const convs = await ctx.insights.conversations([siteId], new Date(t - 30 * 86_400_000).toISOString());
        q = groupAsks(extractAsks(convs).filter((a) => !a.unanswered)).filter((g) => g.count >= 2).slice(0, 4).map((g) => g.question);
      }
    } catch { /* fall back to the defaults */ }
    q = q.length ? q : DEFAULT_SUGGESTIONS;
    popular.set(siteId, { at: t, q }); return q;
  }

  r.get('/api/v1/chat/context', {
    preHandler: app.authenticate,
    schema: {
      tags: ['chat'], summary: 'Who you are and which venues you can chat at, with how each chat looks', security: SECURITY,
      response: { 200: z.object({ user: z.object({ email: z.string(), name: z.string().nullable().optional() }), sites: z.array(z.object({ org_id: Id, org_name: z.string(), site_id: Id, site_name: z.string(), slug: z.string(), branding: Branding, suggestions: z.array(z.string()) })) }), 403: ErrorBody },
    },
  }, async (req) => {
    const p = userOnly(req);
    const sites = await sitesFor(p);
    const branding = new Map<string, Awaited<ReturnType<BrandingStore['list']>>>();
    const out = [];
    for (const s of sites) {
      if (!branding.has(s.org_id)) branding.set(s.org_id, await ctx.branding?.list(s.org_id).catch(() => []) ?? []);
      const b = branding.get(s.org_id)!.find((x) => x.id === s.site_id);
      out.push({ ...s, branding: { bot_name: b?.bot_name ?? null, welcome_heading: b?.welcome_heading ?? null, welcome_message: b?.welcome_message ?? null, primary_color: b?.primary_color ?? null, logo_url: b?.logo_url ?? null }, suggestions: await suggestionsFor(s.site_id) });
    }
    const me = sites[0] ? (await repo().listMembers(sites[0].org_id)).find((m) => m.email.toLowerCase() === p.email.toLowerCase() && m.display_name) : null;
    return { user: { email: p.email, name: me?.display_name ?? null }, sites: out };
  });

  const Media = z.object({ id: Id, title: z.string(), url: z.string() });
  r.post('/api/v1/chat', {
    preHandler: app.authenticate,
    schema: {
      tags: ['chat'], summary: 'Ask a question. Answers come only from knowledge you are allowed to see.', security: SECURITY,
      body: z.object({ site_id: Id, message: z.string().min(1).max(MAX_MESSAGE + 500), conversation_id: z.number().int().positive().optional(), shown_media: z.array(z.string().max(64)).max(60).optional() }),
      response: {
        200: z.object({ reply: z.string(), conversation_id: z.number(), unanswered: z.boolean(), sources: z.array(z.object({ id: Id, title: z.string() })), videos: z.array(Media.extend({ type: z.string() })), images: z.array(Media), support: z.object({ vendor: z.string(), url: z.string() }).nullable(), nps: z.object({ vendor: z.string(), forced: z.boolean() }).nullable(), sensitive: z.object({ topic: z.string(), label: z.string(), mode: z.enum(['confirm', 'manager']) }).nullable() }),
        400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 429: ErrorBody, 503: ErrorBody,
      },
    },
  }, async (req, reply) => {
    const p = userOnly(req);
    const rl = limiter.hit(p.userId);
    if (!rl.allowed) { reply.header('Retry-After', String(rl.retryAfterSeconds)); throw new ApiHttpError(429, 'rate_limited', 'You are asking very quickly. Give it a few seconds.'); }
    const who = await whoAsks(p, req.body.site_id);
    return chat().ask(who, { message: req.body.message, conversation_id: req.body.conversation_id, shown_media: req.body.shown_media });
  });

  r.post('/api/v1/chat/nps', {
    preHandler: app.authenticate,
    schema: {
      tags: ['chat'], summary: 'Rate a hospitality technology vendor (0 to 10) after chatting about it', security: SECURITY,
      body: z.object({ site_id: Id, vendor: z.string().min(1).max(80), score: z.number().int().min(0).max(10), comment: z.string().max(600).nullable().optional() }),
      response: { 200: z.object({ ok: z.literal(true) }), 400: ErrorBody, 403: ErrorBody, 429: ErrorBody, 503: ErrorBody },
    },
  }, async (req, reply) => {
    const p = userOnly(req);
    const rl = limiter.hit('nps:' + p.userId);
    if (!rl.allowed) { reply.header('Retry-After', String(rl.retryAfterSeconds)); throw new ApiHttpError(429, 'rate_limited', 'You are doing that very quickly. Give it a few seconds.'); }
    const who = await whoAsks(p, req.body.site_id);
    await chat().rate(who, { vendor: req.body.vendor, score: req.body.score, comment: req.body.comment ?? null });
    return { ok: true as const };
  });

  // ---- checklists: what staff tick off at their venue today ---------------------------------------------------
  const opsSvc = () => { if (!ctx.ops) throw notFound('Checklists are not available'); return ctx.ops; };
  const tickLimiter = new RateLimiter(120, 60_000, ctx.now);
  async function siteAccess(p: UserPrincipal, siteId: string) {
    const site = await repo().getSite(siteId);
    if (!site || bestRole(p, site.org_id, siteId) === null) throw forbidden('You do not have access to that venue');
    return { orgId: site.org_id, siteId, email: p.email };
  }
  const Today = z.object({ checklist: ChecklistOut, run: RunOut });
  const todayOut = (t: z.infer<typeof Today>) => ({ checklist: t.checklist, run: t.run });

  r.get('/api/v1/chat/checklists', {
    preHandler: app.authenticate,
    schema: { tags: ['chat'], summary: "Today's checklists for a venue, with what has been ticked", security: SECURITY, querystring: z.object({ site_id: Id }), response: { 200: z.object({ data: z.array(Today) }), 403: ErrorBody, 404: ErrorBody } },
  }, async (req) => {
    const who = await siteAccess(userOnly(req), req.query.site_id);
    return { data: (await opsSvc().today(who.orgId, who.siteId)).map(todayOut) };
  });

  r.post('/api/v1/chat/checklists/:id/tick', {
    preHandler: app.authenticate,
    schema: {
      tags: ['chat'], summary: 'Tick or untick one item on a checklist for today', security: SECURITY, params: z.object({ id: Id }),
      body: z.object({ site_id: Id, item_id: z.string().min(1).max(40), done: z.boolean() }),
      response: { 200: Today, 400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 429: ErrorBody },
    },
  }, async (req, reply) => {
    const p = userOnly(req);
    const rl = tickLimiter.hit('tick:' + p.userId);
    if (!rl.allowed) { reply.header('Retry-After', String(rl.retryAfterSeconds)); throw new ApiHttpError(429, 'rate_limited', 'Slow down a moment.'); }
    return todayOut(await opsSvc().tick(await siteAccess(p, req.body.site_id), req.params.id, req.body.item_id, req.body.done));
  });

  r.post('/api/v1/chat/checklists/:id/complete', {
    preHandler: app.authenticate,
    schema: {
      tags: ['chat'], summary: 'Mark a checklist done for today (add a note if some items were skipped)', security: SECURITY, params: z.object({ id: Id }),
      body: z.object({ site_id: Id, note: z.string().max(600).nullable().optional() }),
      response: { 200: Today, 400: ErrorBody, 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => todayOut(await opsSvc().complete(await siteAccess(userOnly(req), req.body.site_id), req.params.id, req.body.note ?? null)));

  // ---- updates from managers --------------------------------------------------------------------------------
  const commsSvc = () => { if (!ctx.comms) throw notFound('Updates are not available'); return ctx.comms; };
  r.get('/api/v1/chat/updates', {
    preHandler: app.authenticate,
    schema: { tags: ['chat'], summary: 'Updates sent to you and your venue, newest first', security: SECURITY, querystring: z.object({ site_id: Id }), response: { 200: z.object({ data: z.array(FeedOut), unread: z.number() }), 403: ErrorBody, 404: ErrorBody } },
  }, async (req) => {
    const who = await whoAsks(userOnly(req), req.query.site_id);
    const data = await commsSvc().feed({ orgId: who.orgId, siteId: who.siteId, email: who.email, teamIds: who.teamIds });
    return { data, unread: data.filter((d) => !d.read_at || (d.requires_ack && !d.acked_at)).length };
  });

  r.post('/api/v1/chat/updates/:id/read', {
    preHandler: app.authenticate,
    schema: { tags: ['chat'], summary: 'Note that you opened an update, or confirm you have read it', security: SECURITY, params: z.object({ id: Id }), body: z.object({ site_id: Id, ack: z.boolean().optional() }),
      response: { 200: z.object({ ok: z.literal(true) }), 400: ErrorBody, 403: ErrorBody, 404: ErrorBody } },
  }, async (req) => {
    const who = await whoAsks(userOnly(req), req.body.site_id);
    await commsSvc().markRead({ orgId: who.orgId, siteId: who.siteId, email: who.email, teamIds: who.teamIds }, req.params.id, req.body.ack === true);
    return { ok: true as const };
  });

  // ---- training: courses for you, and signing them off -------------------------------------------------------------
  const trainingSvc = () => { if (!ctx.training) throw notFound('Training is not available'); return ctx.training; };
  const learner = (who: Who) => ({ orgId: who.orgId, siteId: who.siteId, email: who.email, teamIds: who.teamIds });
  r.get('/api/v1/chat/training', {
    preHandler: app.authenticate,
    schema: { tags: ['chat'], summary: 'Courses for you and your venue, with what you have done', security: SECURITY, querystring: z.object({ site_id: Id }), response: { 200: z.object({ data: z.array(ListedOut), todo: z.number() }), 403: ErrorBody, 404: ErrorBody } },
  }, async (req) => {
    const data = await trainingSvc().listFor(learner(await whoAsks(userOnly(req), req.query.site_id)));
    return { data, todo: data.filter((c) => c.status !== 'done').length };
  });
  r.get('/api/v1/chat/training/:id', {
    preHandler: app.authenticate,
    schema: { tags: ['chat'], summary: 'One course: its lessons and quiz questions (never the answers)', security: SECURITY, params: z.object({ id: Id }), querystring: z.object({ site_id: Id }), response: { 200: LearnerCourse, 403: ErrorBody, 404: ErrorBody } },
  }, async (req) => trainingSvc().courseFor(learner(await whoAsks(userOnly(req), req.query.site_id)), req.params.id));
  r.post('/api/v1/chat/training/:id/complete', {
    preHandler: app.authenticate,
    schema: { tags: ['chat'], summary: 'Hand in the quiz (or confirm you have read a course with no quiz). Passing records your sign-off.', security: SECURITY, params: z.object({ id: Id }),
      body: z.object({ site_id: Id, answers: z.array(z.number().int().min(0).max(3)).max(40).optional(), confirm: z.boolean().optional() }),
      response: { 200: ResultOut, 400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 429: ErrorBody } },
  }, async (req, reply) => {
    const p = userOnly(req);
    const rl = tickLimiter.hit('train:' + p.userId);
    if (!rl.allowed) { reply.header('Retry-After', String(rl.retryAfterSeconds)); throw new ApiHttpError(429, 'rate_limited', 'Slow down a moment.'); }
    return trainingSvc().submit(learner(await whoAsks(p, req.body.site_id)), req.params.id, { answers: req.body.answers, confirm: req.body.confirm });
  });

  r.post('/api/v1/chat/help', {
    preHandler: app.authenticate,
    schema: {
      tags: ['chat'], summary: 'Ask a person: send the latest question to your manager (email) or to Stacked support (Slack)', security: SECURITY,
      body: z.object({ site_id: Id, conversation_id: z.number().int().positive(), target: z.enum(['manager', 'stacked']).default('manager'), note: z.string().max(600).nullable().optional() }),
      response: { 200: z.object({ target: z.enum(['manager', 'stacked']), logged: z.boolean(), notified: z.array(z.string()) }), 400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 429: ErrorBody, 503: ErrorBody },
    },
  }, async (req) => {
    const p = userOnly(req);
    if (!ctx.help) throw new ApiHttpError(503, 'help_unavailable', 'Asking a person is not switched on yet');
    const who = await whoAsks(p, req.body.site_id);
    return ctx.help.ask(who, { target: req.body.target, conversation_id: req.body.conversation_id, note: req.body.note ?? null });
  });

  r.get('/api/v1/chat/conversations', {
    preHandler: app.authenticate,
    schema: {
      tags: ['chat'], summary: 'Your recent conversations at a venue', security: SECURITY,
      querystring: z.object({ site_id: Id }),
      response: { 200: z.object({ data: z.array(z.object({ id: z.number(), title: z.string(), updated_at: z.string(), messages: z.number() })) }), 403: ErrorBody },
    },
  }, async (req) => {
    const p = userOnly(req);
    const site = await repo().getSite(req.query.site_id);
    if (!site || bestRole(p, site.org_id, site.id) === null) throw forbidden('You do not have access to that venue');
    return { data: await chat().list(p.email, site.id) };
  });

  r.get('/api/v1/chat/conversations/:id', {
    preHandler: app.authenticate,
    schema: {
      tags: ['chat'], summary: 'One of your conversations', security: SECURITY,
      params: z.object({ id: z.coerce.number().int().positive() }), querystring: z.object({ site_id: Id }),
      response: { 200: z.object({ id: z.number(), messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })) }), 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => {
    const p = userOnly(req);
    const site = await repo().getSite(req.query.site_id);
    if (!site || bestRole(p, site.org_id, site.id) === null) throw forbidden('You do not have access to that venue');
    return chat().open(p.email, site.id, req.params.id);
  });
}
