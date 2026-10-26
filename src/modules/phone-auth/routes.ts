import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiHttpError } from '../../lib/errors.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import { ErrorBody } from '../schemas.js';
import type { PhoneAuth } from './service.js';

interface Ctx { phoneAuth: PhoneAuth | null; now?: () => number }

const Session = z.object({ access_token: z.string(), expires_at: z.number(), phone: z.string() });

export async function phoneAuthRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const hour = 3_600_000;
  const startByIp = new RateLimiter(20, hour, ctx.now);   // texts cost money: a script cannot ask for more than this from one place
  const startAll = new RateLimiter(600, hour, ctx.now);   // and a circuit breaker for the whole service
  const verifyByIp = new RateLimiter(60, hour, ctx.now);
  const pa = (): PhoneAuth => { if (!ctx.phoneAuth) throw new ApiHttpError(503, 'phone_signin_unavailable', 'Signing in by mobile number is not switched on yet'); return ctx.phoneAuth; };

  // Public on purpose: this is how staff sign in. It only ever texts a number a manager has added, and answers the same either way.
  r.post('/api/v1/auth/phone/start', {
    schema: { tags: ['auth'], summary: 'Text a sign-in code to a mobile number a manager has added', body: z.object({ phone: z.string().min(5).max(30) }), response: { 200: z.object({ ok: z.literal(true) }), 400: ErrorBody, 429: ErrorBody, 502: ErrorBody, 503: ErrorBody } },
  }, async (req, reply) => {
    const ip = startByIp.hit(req.ip);
    if (!ip.allowed || !startAll.hit('all').allowed) { reply.header('Retry-After', String(ip.retryAfterSeconds)); throw new ApiHttpError(429, 'rate_limited', 'Too many requests. Try again in a little while.'); }
    await pa().start(req.body.phone);
    return { ok: true as const };
  });

  r.post('/api/v1/auth/phone/verify', {
    schema: { tags: ['auth'], summary: 'Check the code from the text and sign in', body: z.object({ phone: z.string().min(5).max(30), code: z.string().min(4).max(12) }), response: { 200: Session, 400: ErrorBody, 401: ErrorBody, 429: ErrorBody, 503: ErrorBody } },
  }, async (req, reply) => {
    const ip = verifyByIp.hit(req.ip);
    if (!ip.allowed) { reply.header('Retry-After', String(ip.retryAfterSeconds)); throw new ApiHttpError(429, 'rate_limited', 'Too many attempts. Try again in a little while.'); }
    return pa().verify(req.body.phone, req.body.code);
  });

  r.post('/api/v1/auth/phone/refresh', {
    schema: { tags: ['auth'], summary: 'Swap a signed-in phone session for a fresh one', response: { 200: Session, 401: ErrorBody, 503: ErrorBody } },
  }, async (req) => {
    const bearer = typeof req.headers.authorization === 'string' ? /^Bearer\s+(\S+)$/i.exec(req.headers.authorization)?.[1] : undefined;
    const s = bearer ? await pa().refresh(bearer) : null;
    if (!s) throw new ApiHttpError(401, 'unauthorized', 'Please sign in again');
    return s;
  });
}
