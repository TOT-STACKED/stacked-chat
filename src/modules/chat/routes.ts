import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiHttpError, forbidden, notFound } from '../../lib/errors.js';
import { bestRole, type UserPrincipal } from '../../lib/permissions.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import type { Repo } from '../../lib/repo.js';
import { userOnly } from '../access.js';
import { extractAsks, groupAsks } from '../insights/analyze.js';
import type { BrandingStore } from '../branding/store.js';
import type { InsightsStore } from '../insights/store.js';
import type { TechStackStore } from '../vendors/store.js';
import { ErrorBody, Id, SECURITY } from '../schemas.js';
import { MAX_MESSAGE, type Chat, type Who } from './service.js';

interface Ctx {
  chat: Chat | null; repo?: Repo; branding: BrandingStore | null; insights: InsightsStore | null; techStack?: TechStackStore | null;
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
    return {
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
      response: { 200: z.object({ user: z.object({ email: z.string() }), sites: z.array(z.object({ org_id: Id, org_name: z.string(), site_id: Id, site_name: z.string(), slug: z.string(), branding: Branding, suggestions: z.array(z.string()) })) }), 403: ErrorBody },
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
    return { user: { email: p.email }, sites: out };
  });

  const Media = z.object({ id: Id, title: z.string(), url: z.string() });
  r.post('/api/v1/chat', {
    preHandler: app.authenticate,
    schema: {
      tags: ['chat'], summary: 'Ask a question. Answers come only from knowledge you are allowed to see.', security: SECURITY,
      body: z.object({ site_id: Id, message: z.string().min(1).max(MAX_MESSAGE + 500), conversation_id: z.number().int().positive().optional() }),
      response: {
        200: z.object({ reply: z.string(), conversation_id: z.number(), unanswered: z.boolean(), sources: z.array(z.object({ id: Id, title: z.string() })), videos: z.array(Media.extend({ type: z.string() })), images: z.array(Media), support: z.object({ vendor: z.string(), url: z.string() }).nullable(), nps: z.object({ vendor: z.string(), forced: z.boolean() }).nullable() }),
        400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 429: ErrorBody, 503: ErrorBody,
      },
    },
  }, async (req, reply) => {
    const p = userOnly(req);
    const rl = limiter.hit(p.userId);
    if (!rl.allowed) { reply.header('Retry-After', String(rl.retryAfterSeconds)); throw new ApiHttpError(429, 'rate_limited', 'You are asking very quickly. Give it a few seconds.'); }
    const who = await whoAsks(p, req.body.site_id);
    return chat().ask(who, { message: req.body.message, conversation_id: req.body.conversation_id });
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
