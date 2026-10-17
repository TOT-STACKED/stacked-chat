import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiHttpError, notFound } from '../../lib/errors.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import { ErrorBody } from '../schemas.js';
import type { Signup } from './service.js';

interface Ctx { signup: Signup | null; now?: () => number; perIpPerHour?: number; perEmailPerHour?: number; allPerHour?: number }

/** Below this a person cannot have filled the form in: it is a script. */
export const MIN_FILL_MS = 800;

const plain = (max: number) => z.string().trim().min(2).max(max)
  .refine((v) => !/[<>]/.test(v), 'Please use plain text, without < or >')
  .refine((v) => !/https?:\/\/|www\./i.test(v), 'Please enter a name, not a web address');

export async function signupRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const hour = 3_600_000;
  const byIp = new RateLimiter(ctx.perIpPerHour ?? 5, hour, ctx.now);
  const byEmail = new RateLimiter(ctx.perEmailPerHour ?? 3, hour, ctx.now);
  const overall = new RateLimiter(ctx.allPerHour ?? 100, hour, ctx.now); // a circuit breaker if something floods the form

  // Public on purpose: this is how a new owner starts. Everything it can do is limited to "create one trial for this email".
  r.post('/api/v1/signup', {
    schema: {
      tags: ['signup'], summary: 'Start a 30-day free trial: creates the company, its first venue and the owner, and emails a sign-in link',
      body: z.object({
        company_name: plain(80), venue_name: plain(80).nullable().optional(), owner_name: plain(60),
        owner_email: z.string().trim().toLowerCase().email().max(200),
        /** a hidden field people never fill in: bots do */ website: z.string().max(300).optional(),
        /** how long the form was open, in milliseconds */ elapsed_ms: z.number().int().min(0).max(86_400_000),
      }),
      response: { 200: z.object({ ok: z.literal(true) }), 400: ErrorBody, 404: ErrorBody, 429: ErrorBody },
    },
  }, async (req, reply) => {
    if (!ctx.signup) throw notFound('Sign-up is not available');
    const b = req.body;
    const limited = [byIp.hit(`ip:${req.ip}`), byEmail.hit(`e:${b.owner_email}`), overall.hit('all')].find((x) => !x.allowed);
    if (limited) { reply.header('Retry-After', String(limited.retryAfterSeconds)); throw new ApiHttpError(429, 'rate_limited', 'Too many sign-ups from here just now. Please try again in a little while, or email us.'); }
    // A script gets the same answer a person does, and nothing is created.
    if ((b.website && b.website.trim()) || b.elapsed_ms < MIN_FILL_MS) return { ok: true as const };
    await ctx.signup.start({ company_name: b.company_name, venue_name: b.venue_name, owner_name: b.owner_name, owner_email: b.owner_email });
    return { ok: true as const }; // the same whether it was new or the address already had an account: nothing about who is a customer is revealed
  });
}
