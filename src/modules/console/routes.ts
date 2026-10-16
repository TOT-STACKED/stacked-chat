import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { forbidden, notFound } from '../../lib/errors.js';
import { userOnly } from '../access.js';
import { ErrorBody, Id, SECURITY } from '../schemas.js';
import type { ConsoleService } from './service.js';

interface Ctx { console: ConsoleService | null; staff: Set<string> }

/** Stacked staff are people whose verified email is on the STACKED_STAFF_EMAILS list. Empty list = Console off. */
export const parseStaff = (raw: string | undefined) => new Set((raw ?? '').split(/[,\s;]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)));

export async function consoleRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const svc = (): ConsoleService => { if (!ctx.console) throw notFound('Console is not available'); return ctx.console; };
  /** Anyone else gets the same "not allowed" whether the Console is off or they are not on the list. */
  const staffOnly = (req: Parameters<typeof userOnly>[0]) => {
    const p = userOnly(req);
    if (!ctx.staff.has(p.email.toLowerCase())) throw forbidden('This area is for Stacked staff');
    return p;
  };
  const Days = z.coerce.number().int().default(30);
  const loose = z.looseObject({});

  r.get('/api/v1/console/me', {
    preHandler: app.authenticate,
    schema: { tags: ['console'], summary: 'Are you Stacked staff?', security: SECURITY, response: { 200: z.object({ staff: z.literal(true), email: z.string() }), 403: ErrorBody } },
  }, async (req) => ({ staff: true as const, email: staffOnly(req).email }));

  const list = (path: string, summary: string, run: (q: { days: number }) => Promise<unknown>) => r.get(path, {
    preHandler: app.authenticate,
    schema: { tags: ['console'], summary, security: SECURITY, querystring: z.object({ days: Days }), response: { 200: loose, 400: ErrorBody, 403: ErrorBody, 404: ErrorBody } },
  }, async (req) => { staffOnly(req); return run(req.query as { days: number }) as Promise<Record<string, unknown>>; });

  list('/api/v1/console/overview', 'Customers, billing health, usage and what needs attention', (q) => svc().overview(q.days));
  list('/api/v1/console/customers', 'Every customer with billing state, usage and flags', (q) => svc().customers(q.days));
  list('/api/v1/console/vendors', 'Vendor intelligence: mentions, problems and NPS per technology partner', (q) => svc().vendors(q.days));
  list('/api/v1/console/gaps', 'Questions the AI could not answer across all customers', (q) => svc().gaps(q.days));

  r.get('/api/v1/console/customers/:orgId', {
    preHandler: app.authenticate,
    schema: { tags: ['console'], summary: 'One customer in detail', security: SECURITY, params: z.object({ orgId: Id }), querystring: z.object({ days: Days }), response: { 200: loose, 400: ErrorBody, 403: ErrorBody, 404: ErrorBody } },
  }, async (req) => { staffOnly(req); return (await svc().customer(req.params.orgId, req.query.days)) as Record<string, unknown>; });
}
