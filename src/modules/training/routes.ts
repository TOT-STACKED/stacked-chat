import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { forbidden, notFound } from '../../lib/errors.js';
import { atLeast, bestRole, canManageMembers, type Principal } from '../../lib/permissions.js';
import { assertOrgAccess, userOnly } from '../access.js';
import { UNITS, type AiBudget } from '../../lib/ai-budget.js';
import { ErrorBody, Id, SECURITY } from '../schemas.js';
import { ApiHttpError } from '../../lib/errors.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import type { Knowledge } from '../knowledge/service.js';
import { MAX_SOURCE_CHARS, tooShort, type CourseDrafter } from './drafter.js';
import type { Training } from './service.js';
import type { CourseRow } from './store.js';

interface Ctx { aiBudget?: AiBudget | null; training: Training | null; gate: (orgId: string) => Promise<void>; knowledge?: Knowledge | null; drafter?: CourseDrafter | null }

const Stats = z.object({ recipients: z.number(), done: z.number(), renew: z.number(), todo: z.number() });
const Lesson = z.object({ id: z.string(), title: z.string(), body: z.string(), url: z.string().nullable() });
const Question = z.object({ id: z.string(), q: z.string(), options: z.array(z.string()), answer: z.number() });
export const CourseOut = z.object({
  id: Id, org_id: Id, site_id: Id.nullable(), team_id: Id.nullable(), title: z.string(), description: z.string().nullable(), lessons: z.array(Lesson), quiz: z.array(Question),
  pass_percent: z.number(), renew_months: z.number().nullable(), active: z.boolean(), created_by: z.string().nullable(), created_at: z.string(), updated_at: z.string(),
});
const Status = z.enum(['todo', 'done', 'renew']);
export const ListedOut = z.object({ id: Id, title: z.string(), description: z.string().nullable(), lessons: z.number(), questions: z.number(), pass_percent: z.number(), renew_months: z.number().nullable(), status: Status, completed_at: z.string().nullable(), expires_at: z.string().nullable(), score: z.number().nullable() });
export const LearnerCourse = z.object({ id: Id, title: z.string(), description: z.string().nullable(), pass_percent: z.number(), renew_months: z.number().nullable(), lessons: z.array(Lesson), quiz: z.array(z.object({ id: z.string(), q: z.string(), options: z.array(z.string()) })) });
export const ResultOut = z.object({ passed: z.boolean(), score: z.number().nullable(), correct: z.number(), total: z.number(), wrong: z.array(z.string()), completed_at: z.string().nullable() });

const LessonIn = z.object({ id: z.string().max(40).optional(), title: z.string().max(200), body: z.string().max(6000), url: z.string().max(600).nullable().optional() });
const QuestionIn = z.object({ id: z.string().max(40).optional(), q: z.string().max(400), options: z.array(z.string().max(300)).min(2).max(4), answer: z.number().int().min(0).max(3) });
const Title = z.string().trim().min(1).max(120);

export async function trainingRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tr = (): Training => { if (!ctx.training) throw notFound('Training is not available'); return ctx.training; };
  const canWrite = (p: Principal, orgId: string, siteId: string | null) => p.kind === 'user' && canManageMembers(p, orgId, siteId);
  const canSee = (p: Principal, orgId: string, siteId: string | null) => {
    if (p.kind !== 'user') return false;
    return siteId === null ? p.memberships.some((m) => m.orgId === orgId && atLeast(m.role, 'site_manager')) : atLeast(bestRole(p, orgId, siteId), 'site_manager');
  };
  const view = (c: CourseRow) => ({ ...c, created_at: c.created_at, updated_at: c.updated_at });

  r.get('/api/v1/orgs/:orgId/training', {
    preHandler: app.authenticate,
    schema: { tags: ['training'], summary: 'Courses you can manage, with how many people are done, due a refresher or still to do', security: SECURITY, params: z.object({ orgId: Id }),
      response: { 200: z.object({ data: z.array(CourseOut.extend({ stats: Stats })) }), 403: ErrorBody, 404: ErrorBody } },
  }, async (req) => {
    const { orgId } = req.params; const p = userOnly(req); assertOrgAccess(req, orgId);
    return { data: (await tr().list(orgId, (c) => canSee(p, orgId, c.site_id))).map((x) => ({ ...view(x.course), stats: x.stats })) };
  });

  r.post('/api/v1/orgs/:orgId/training', {
    preHandler: app.authenticate,
    schema: {
      tags: ['training'], summary: 'Write a course for the company, a venue or a team', security: SECURITY, params: z.object({ orgId: Id }),
      body: z.object({ title: Title, description: z.string().max(700).nullable().optional(), site_id: Id.nullable().optional(), team_id: Id.nullable().optional(),
        lessons: z.array(LessonIn).min(1).max(30), quiz: z.array(QuestionIn).max(30).optional(), pass_percent: z.number().int().min(50).max(100).optional(), renew_months: z.number().int().min(1).max(60).nullable().optional() }),
      response: { 201: CourseOut, 400: ErrorBody, 402: ErrorBody, 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req, reply) => {
    const { orgId } = req.params; const p = userOnly(req); assertOrgAccess(req, orgId); await ctx.gate(orgId);
    const aud = await tr().audienceFor(orgId, { site_id: req.body.site_id ?? null, team_id: req.body.team_id ?? null });
    if (!canWrite(p, orgId, aud.site_id)) throw forbidden(aud.site_id ? 'You cannot add training for this venue' : 'Only company admins can add training for the whole company');
    reply.status(201); return view(await tr().create(orgId, { ...req.body, by: p.email }));
  });

  r.patch('/api/v1/orgs/:orgId/training/:id', {
    preHandler: app.authenticate,
    schema: {
      tags: ['training'], summary: 'Change a course. Earlier sign-offs stay.', security: SECURITY, params: z.object({ orgId: Id, id: Id }),
      body: z.object({ title: Title.optional(), description: z.string().max(700).nullable().optional(), lessons: z.array(LessonIn).min(1).max(30).optional(), quiz: z.array(QuestionIn).max(30).optional(),
        pass_percent: z.number().int().min(50).max(100).optional(), renew_months: z.number().int().min(1).max(60).nullable().optional(), active: z.boolean().optional() }),
      response: { 200: CourseOut, 400: ErrorBody, 402: ErrorBody, 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId, id } = req.params; const p = userOnly(req); assertOrgAccess(req, orgId); await ctx.gate(orgId);
    const cur = await tr().get(orgId, id);
    if (!cur || !canSee(p, orgId, cur.site_id)) throw notFound('Course not found');
    if (!canWrite(p, orgId, cur.site_id)) throw forbidden('You cannot change this course');
    return view(await tr().update(orgId, id, req.body));
  });

  r.delete('/api/v1/orgs/:orgId/training/:id', {
    preHandler: app.authenticate,
    schema: { tags: ['training'], summary: 'Delete a course and its sign-offs', security: SECURITY, params: z.object({ orgId: Id, id: Id }), response: { 200: z.object({ ok: z.literal(true) }), 403: ErrorBody, 404: ErrorBody } },
  }, async (req) => {
    const { orgId, id } = req.params; const p = userOnly(req); assertOrgAccess(req, orgId);
    const cur = await tr().get(orgId, id);
    if (!cur || !canSee(p, orgId, cur.site_id)) throw notFound('Course not found');
    if (!canWrite(p, orgId, cur.site_id)) throw forbidden('You cannot delete this course');
    await tr().remove(orgId, id);
    return { ok: true as const };
  });

  // Draft a course from one of the company's own documents. Nothing is saved: the manager reads it, changes it and saves it.
  const draftLimiter = new RateLimiter(10, 3_600_000);
  r.post('/api/v1/orgs/:orgId/training/draft', {
    preHandler: app.authenticate,
    schema: {
      tags: ['training'], summary: 'Draft a course from a document in Knowledge (lessons and a quiz). Nothing is saved.', security: SECURITY, params: z.object({ orgId: Id }), body: z.object({ knowledge_id: Id }),
      response: { 200: z.object({ title: z.string(), description: z.string(), lessons: z.array(z.object({ title: z.string(), body: z.string() })), quiz: z.array(z.object({ q: z.string(), options: z.array(z.string()), answer: z.number() })), source: z.object({ title: z.string(), truncated: z.boolean() }) }), 400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 429: ErrorBody, 502: ErrorBody, 503: ErrorBody },
    },
  }, async (req, reply) => {
    const { orgId } = req.params; const p = userOnly(req); assertOrgAccess(req, orgId);
    if (!ctx.drafter || !ctx.knowledge) throw new ApiHttpError(503, 'drafting_unavailable', 'Drafting a course is not switched on yet');
    const rl = draftLimiter.hit(p.userId);
    if (!rl.allowed) { reply.header('Retry-After', String(rl.retryAfterSeconds)); throw new ApiHttpError(429, 'rate_limited', 'You have drafted a few courses this hour. Try again shortly.'); }
    const item = await ctx.knowledge.get(orgId, req.body.knowledge_id);
    if (!item || item.kind !== 'document' || !canSee(p, orgId, item.site_id)) throw notFound('Document not found');
    const text = (item.body ?? '').trim();
    if (text.length < 200) throw tooShort();
    await ctx.aiBudget?.spend(orgId, UNITS.draft);
    const d = await ctx.drafter.draft({ title: item.title, text });
    if (!d || !d.lessons.length) throw new ApiHttpError(502, 'draft_failed', 'We could not draft a course from that just now. Please try again.');
    return { ...d, title: d.title || item.title, source: { title: item.title, truncated: text.length > MAX_SOURCE_CHARS } };
  });

  r.get('/api/v1/orgs/:orgId/training/:id/progress', {
    preHandler: app.authenticate,
    schema: { tags: ['training'], summary: 'Who has done a course, who is due a refresher and who has not started', security: SECURITY, params: z.object({ orgId: Id, id: Id }),
      response: { 200: z.object({ course: CourseOut, stats: Stats, people: z.array(z.object({ email: z.string(), name: z.string(), status: Status, completed_at: z.string().nullable(), expires_at: z.string().nullable(), score: z.number().nullable() })) }), 403: ErrorBody, 404: ErrorBody } },
  }, async (req) => {
    const { orgId, id } = req.params; const p = userOnly(req); assertOrgAccess(req, orgId);
    const d = await tr().progress(orgId, id);
    if (!d || !canSee(p, orgId, d.course.site_id)) throw notFound('Course not found');
    return { course: view(d.course), stats: d.stats, people: d.people };
  });
}
