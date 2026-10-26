import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiHttpError, forbidden, notFound, unauthorized } from '../../lib/errors.js';
import { safeEqualStr } from '../billing/util.js';
import { atLeast, bestRole, canManageMembers, type Principal } from '../../lib/permissions.js';
import type { Repo } from '../../lib/repo.js';
import { assertOrgAccess, userOnly } from '../access.js';
import { ErrorBody, Id, SECURITY } from '../schemas.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import type { Knowledge } from '../knowledge/service.js';
import { MAX_SOURCE_CHARS, type ChecklistDrafter } from './drafter.js';
import { KINDS, MAX_ITEM_CHARS, MAX_ITEMS, type Ops } from './service.js';
import type { ChecklistRow } from './store.js';

interface Ctx { ops: Ops | null; repo?: Repo; gate: (orgId: string) => Promise<void>; reminders?: (() => Promise<{ checked: number; sent: number }>) | null; cronSecret?: string; knowledge?: Knowledge | null; drafter?: ChecklistDrafter | null }

export const ChecklistOut = z.object({
  id: Id, org_id: Id, site_id: Id.nullable(), title: z.string(), kind: z.enum(['opening', 'closing', 'custom']),
  items: z.array(z.object({ id: z.string(), text: z.string() })), active: z.boolean(), due_time: z.string().nullable(), remind_days: z.array(z.number()), created_at: z.string(), updated_at: z.string(),
});
export const RunOut = z.object({
  done: z.number(), total: z.number(), started: z.boolean(), ticks: z.record(z.string(), z.object({ by: z.string(), at: z.string() })),
  completed_at: z.string().nullable(), completed_by: z.string().nullable(), note: z.string().nullable(),
});
const Title = z.string().trim().min(1).max(120);
const Items = z.array(z.string().max(MAX_ITEM_CHARS + 50)).min(1).max(MAX_ITEMS);
const Kind = z.enum(KINDS as [string, ...string[]]);
const DueTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a time like 09:30').nullable();
const Days = z.array(z.number().int().min(0).max(6)).min(1).max(7);
const view = (l: ChecklistRow) => ({ id: l.id, org_id: l.org_id, site_id: l.site_id, title: l.title, kind: l.kind, items: l.items, active: l.active, due_time: l.due_time, remind_days: l.remind_days, created_at: l.created_at, updated_at: l.updated_at });

export async function operationsRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const ops = (): Ops => { if (!ctx.ops) throw notFound('Operations is not available'); return ctx.ops; };
  const canWrite = (p: Principal, orgId: string, siteId: string | null) => p.kind === 'user' && canManageMembers(p, orgId, siteId);
  /** Who can SEE a list: managers of its audience. A company-wide list is visible to any manager in the company. */
  const canSee = (p: Principal, orgId: string, siteId: string | null) => {
    if (p.kind !== 'user') return false;
    return siteId === null ? p.memberships.some((m) => m.orgId === orgId && atLeast(m.role, 'site_manager')) : atLeast(bestRole(p, orgId, siteId), 'site_manager');
  };
  const managed = async (p: Principal, orgId: string) => (await ctx.repo!.listSites(orgId)).filter((s) => p.kind === 'user' && atLeast(bestRole(p, orgId, s.id), 'site_manager'));

  r.get('/api/v1/orgs/:orgId/checklists', {
    preHandler: app.authenticate,
    schema: { tags: ['operations'], summary: 'Checklists you can manage', security: SECURITY, params: z.object({ orgId: Id }), response: { 200: z.object({ data: z.array(ChecklistOut) }), 403: ErrorBody, 404: ErrorBody } },
  }, async (req) => {
    const { orgId } = req.params; const p = userOnly(req); assertOrgAccess(req, orgId);
    return { data: (await ops().list(orgId)).filter((l) => canSee(p, orgId, l.site_id)).map(view) };
  });

  r.post('/api/v1/orgs/:orgId/checklists', {
    preHandler: app.authenticate,
    schema: {
      tags: ['operations'], summary: 'Write a checklist for the whole company or one venue', security: SECURITY, params: z.object({ orgId: Id }),
      body: z.object({ title: Title, kind: Kind.default('custom'), site_id: Id.nullable().optional(), items: Items, due_time: DueTime.optional(), remind_days: Days.optional() }),
      response: { 201: ChecklistOut, 400: ErrorBody, 402: ErrorBody, 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req, reply) => {
    const { orgId } = req.params; const p = userOnly(req); assertOrgAccess(req, orgId); await ctx.gate(orgId);
    const siteId = req.body.site_id ?? null;
    if (!canWrite(p, orgId, siteId)) throw forbidden(siteId ? 'You cannot add checklists for this venue' : 'Only company admins can add checklists for the whole company');
    const l = await ops().create(orgId, { title: req.body.title, kind: req.body.kind as 'opening' | 'closing' | 'custom', site_id: siteId, items: req.body.items, due_time: req.body.due_time, remind_days: req.body.remind_days, by: p.email });
    reply.status(201); return view(l);
  });

  r.patch('/api/v1/orgs/:orgId/checklists/:id', {
    preHandler: app.authenticate,
    schema: {
      tags: ['operations'], summary: 'Change a checklist: wording, items, venue or switch it on or off', security: SECURITY, params: z.object({ orgId: Id, id: Id }),
      body: z.object({ title: Title.optional(), kind: Kind.optional(), site_id: Id.nullable().optional(), items: Items.optional(), active: z.boolean().optional(), due_time: DueTime.optional(), remind_days: Days.optional() }),
      response: { 200: ChecklistOut, 400: ErrorBody, 402: ErrorBody, 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId, id } = req.params; const p = userOnly(req); assertOrgAccess(req, orgId); await ctx.gate(orgId);
    const cur = await ops().get(orgId, id);
    if (!cur || !canSee(p, orgId, cur.site_id)) throw notFound('Checklist not found');
    if (!canWrite(p, orgId, cur.site_id) || (req.body.site_id !== undefined && !canWrite(p, orgId, req.body.site_id))) throw forbidden('You cannot change this checklist');
    return view(await ops().update(orgId, id, { ...req.body, kind: req.body.kind as 'opening' | 'closing' | 'custom' | undefined }));
  });

  r.delete('/api/v1/orgs/:orgId/checklists/:id', {
    preHandler: app.authenticate,
    schema: { tags: ['operations'], summary: 'Delete a checklist and its history', security: SECURITY, params: z.object({ orgId: Id, id: Id }), response: { 200: z.object({ ok: z.literal(true) }), 403: ErrorBody, 404: ErrorBody } },
  }, async (req) => {
    const { orgId, id } = req.params; const p = userOnly(req); assertOrgAccess(req, orgId);
    const cur = await ops().get(orgId, id);
    if (!cur || !canSee(p, orgId, cur.site_id)) throw notFound('Checklist not found');
    if (!canWrite(p, orgId, cur.site_id)) throw forbidden('You cannot delete this checklist');
    await ops().remove(orgId, id);
    return { ok: true as const };
  });

  // Draft a checklist from a short description (and optionally one of the company's documents). Nothing is saved: the manager reads it, changes it and saves it.
  const draftLimiter = new RateLimiter(20, 3_600_000);
  r.post('/api/v1/orgs/:orgId/checklists/draft', {
    preHandler: app.authenticate,
    schema: {
      tags: ['operations'], summary: 'Draft a checklist with AI from a description. Nothing is saved.', security: SECURITY, params: z.object({ orgId: Id }),
      body: z.object({ brief: z.string().trim().min(5).max(800), kind: Kind.default('custom'), site_id: Id.nullable().optional(), knowledge_id: Id.optional() }),
      response: { 200: z.object({ title: z.string(), items: z.array(z.string()), source: z.object({ title: z.string(), truncated: z.boolean() }).nullable() }), 400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 429: ErrorBody, 502: ErrorBody, 503: ErrorBody },
    },
  }, async (req, reply) => {
    const { orgId } = req.params; const p = userOnly(req); assertOrgAccess(req, orgId);
    if (!ctx.drafter) throw new ApiHttpError(503, 'drafting_unavailable', 'Drafting a checklist is not switched on yet');
    if (!canSee(p, orgId, null)) throw forbidden('Only managers can draft checklists');
    const rl = draftLimiter.hit(p.userId);
    if (!rl.allowed) { reply.header('Retry-After', String(rl.retryAfterSeconds)); throw new ApiHttpError(429, 'rate_limited', 'You have drafted a lot of checklists this hour. Try again shortly.'); }
    let source: { title: string; text: string } | null = null; let truncated = false;
    if (req.body.knowledge_id) {
      const item = ctx.knowledge ? await ctx.knowledge.get(orgId, req.body.knowledge_id) : null;
      if (!item || item.kind !== 'document' || !canSee(p, orgId, item.site_id)) throw notFound('Document not found');
      const text = (item.body ?? '').trim(); truncated = text.length > MAX_SOURCE_CHARS;
      if (text) source = { title: item.title, text };
    }
    const venue = req.body.site_id ? (await ctx.repo!.listSites(orgId)).find((s) => s.id === req.body.site_id)?.name ?? null : null;
    const d = await ctx.drafter.draft({ brief: req.body.brief, kind: req.body.kind as 'opening' | 'closing' | 'custom', venue, source });
    if (!d || !d.items.length) throw new ApiHttpError(502, 'draft_failed', 'We could not draft a checklist just now. Please try again.');
    return { title: d.title, items: d.items, source: source ? { title: source.title, truncated } : null };
  });

  // Called by a scheduler with the shared CRON_SECRET (the server also runs this itself every few minutes).
  r.post('/api/v1/internal/operations/remind', { schema: { hide: true } }, async (req) => {
    const given = req.headers['x-cron-secret'];
    if (!ctx.cronSecret || typeof given !== 'string' || !safeEqualStr(given, ctx.cronSecret)) throw unauthorized('Bad cron secret');
    if (!ctx.reminders) throw notFound('Reminders are not switched on');
    return ctx.reminders();
  });

  r.get('/api/v1/orgs/:orgId/checklists/board', {
    preHandler: app.authenticate,
    schema: {
      tags: ['operations'], summary: 'Today at each venue you run, and the last few days', security: SECURITY, params: z.object({ orgId: Id }), querystring: z.object({ days: z.coerce.number().int().min(1).max(31).default(7) }),
      response: { 200: z.object({
        sites: z.array(z.object({ id: Id, name: z.string() })),
        today: z.array(z.object({ checklist: ChecklistOut, site_id: Id, run: RunOut })),
        recent: z.array(z.object({ date: z.string(), site_id: Id, checklist: ChecklistOut, run: RunOut })),
      }), 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId } = req.params; const p = userOnly(req); assertOrgAccess(req, orgId);
    const sites = await managed(p, orgId); const ids = sites.map((s) => s.id);
    const lists = (await ops().list(orgId)).filter((l) => canSee(p, orgId, l.site_id));
    const today = await ops().board(orgId, ids, lists);
    const recent = (await ops().recent(orgId, ids, req.query.days)).filter((x) => lists.some((l) => l.id === x.checklist.id));
    return {
      sites: sites.map((s) => ({ id: s.id, name: s.name })),
      today: today.map((t) => ({ ...t, checklist: view(t.checklist) })),
      recent: recent.map((t) => ({ ...t, checklist: view(t.checklist) })),
    };
  });
}
