import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiHttpError, unauthorized } from './errors.js';
import { extractApiKey, hashKey, KEY_PREFIX } from './keys.js';
import type { KeyPrincipal, Principal, UserPrincipal } from './permissions.js';
import { RateLimiter } from './rate-limit.js';
import type { Repo } from './repo.js';

export interface VerifiedUser { userId: string; email: string }
/** Resolves a session token to a verified user (or null). */
export type TokenVerifier = (token: string) => Promise<VerifiedUser | null>;

declare module 'fastify' {
  interface FastifyRequest { principal?: Principal }
  interface FastifyInstance { authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void> }
}

/**
 * Verifies a Supabase session token by asking Supabase Auth who it belongs to.
 * Works with any signing scheme (no secrets needed here). Results are cached briefly.
 */
export function createSupabaseTokenVerifier(opts: { url: string; anonKey: string; fetchImpl?: typeof fetch; ttlMs?: number; now?: () => number }): TokenVerifier {
  const f = opts.fetchImpl ?? fetch;
  const ttl = opts.ttlMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { user: VerifiedUser | null; exp: number }>();
  return async (token) => {
    const ck = createHash('sha256').update(token).digest('hex'); // don't keep raw tokens as map keys
    const hit = cache.get(ck);
    if (hit && hit.exp > now()) return hit.user;
    let user: VerifiedUser | null = null;
    try {
      const res = await f(opts.url.replace(/\/$/, '') + '/auth/v1/user', { headers: { apikey: opts.anonKey, Authorization: 'Bearer ' + token } });
      if (res.ok) {
        const j = (await res.json()) as { id?: string; email?: string; email_confirmed_at?: string | null };
        // Only an email the person has actually proven (via the emailed code) counts.
        if (j.id && j.email && j.email_confirmed_at) user = { userId: j.id, email: j.email.toLowerCase() };
      }
    } catch { user = null; }
    cache.set(ck, { user, exp: now() + (user ? ttl : 10_000) });
    if (cache.size > 5000) for (const [k, v] of cache) if (v.exp <= now()) cache.delete(k);
    return user;
  };
}

export interface AuthContext {
  repo?: Repo;
  verifyToken: TokenVerifier;
  userLimiter: RateLimiter;
  keyLimiter: RateLimiter;
  failLimiter: RateLimiter;
}

/** Adds `app.authenticate` (preHandler) which sets `req.principal` from a Bearer session token or an API key. */
export function registerAuth(app: FastifyInstance, ctx: AuthContext) {
  app.decorateRequest('principal', undefined);
  const linked = new Set<string>();

  async function authenticate(req: FastifyRequest, reply: FastifyReply) {
    if (!ctx.repo) throw new ApiHttpError(503, 'not_configured', 'Identity is not configured on this server');
    const repo = ctx.repo;

    const fail = (e: ApiHttpError) => {
      if (!ctx.failLimiter.hit(req.ip).allowed) {
        throw new ApiHttpError(429, 'rate_limited', 'Too many failed attempts. Slow down.');
      }
      return e;
    };

    let principal: Principal | null = null;
    const apiKey = extractApiKey(req.headers);
    const auth = req.headers['authorization'];
    const bearer = typeof auth === 'string' ? /^Bearer\s+(\S+)$/i.exec(auth)?.[1] : undefined;

    if (apiKey) {
      const row = await repo.findApiKeyByHash(hashKey(apiKey));
      const expired = row?.expires_at ? new Date(row.expires_at).getTime() < Date.now() : false;
      // Same response for unknown / revoked / expired: never reveal which.
      if (!row || row.revoked_at || expired) throw fail(unauthorized('Invalid API key'));
      const kp: KeyPrincipal = { kind: 'api_key', keyId: row.id, orgId: row.org_id, siteId: row.site_id, scopes: row.scopes };
      principal = kp;
      void repo.touchApiKey(row.id).catch(() => {});
    } else if (bearer && !bearer.startsWith(KEY_PREFIX)) {
      const user = await ctx.verifyToken(bearer);
      if (!user) throw fail(unauthorized('Invalid or expired session'));
      if (!linked.has(user.userId)) {
        await repo.linkUser(user.email, user.userId).catch(() => {});
        linked.add(user.userId);
      }
      const up: UserPrincipal = { kind: 'user', userId: user.userId, email: user.email, memberships: await repo.membershipsForUser(user.userId, user.email) };
      principal = up;
    }
    if (!principal) throw fail(unauthorized());

    const id = principal.kind === 'user' ? `u:${principal.userId}` : `k:${principal.keyId}`;
    const rl = (principal.kind === 'user' ? ctx.userLimiter : ctx.keyLimiter).hit(id);
    reply.header('X-RateLimit-Limit', String(rl.limit)).header('X-RateLimit-Remaining', String(rl.remaining));
    if (!rl.allowed) {
      reply.header('Retry-After', String(rl.retryAfterSeconds));
      throw new ApiHttpError(429, 'rate_limited', 'Rate limit exceeded');
    }
    req.principal = principal;
  }

  app.decorate('authenticate', authenticate);
}

export const principalId = (p: Principal) => (p.kind === 'user' ? `u:${p.userId}` : `k:${p.keyId}`);
