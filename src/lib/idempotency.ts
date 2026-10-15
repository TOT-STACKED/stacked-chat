import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiHttpError, badRequest } from './errors.js';

interface Entry { fingerprint: string; status: number; body: unknown; expiresAt: number }

/**
 * `Idempotency-Key` support for POST endpoints: a retried request with the same key and body
 * replays the original response instead of creating a duplicate. In memory, 24h, per instance.
 */
export class IdempotencyStore {
  private done = new Map<string, Entry>();
  private inflight = new Set<string>();
  constructor(private readonly ttlMs = 24 * 3600_000, private readonly now: () => number = Date.now) {}

  async run<T>(
    req: FastifyRequest, reply: FastifyReply, principalId: string,
    exec: () => Promise<{ status: number; body: T }>,
  ): Promise<T> {
    const raw = req.headers['idempotency-key'];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key) {
      const r = await exec();
      reply.status(r.status);
      return r.body;
    }
    if (key.length < 8 || key.length > 128) throw badRequest('Idempotency-Key must be 8-128 characters');
    const id = `${principalId}|${req.method}|${req.routeOptions.url}|${key}`;
    const fingerprint = createHash('sha256').update(JSON.stringify(req.body ?? null)).digest('hex');

    const hit = this.done.get(id);
    if (hit && hit.expiresAt > this.now()) {
      if (hit.fingerprint !== fingerprint) {
        throw new ApiHttpError(422, 'idempotency_key_reuse', 'This Idempotency-Key was already used with a different request body');
      }
      reply.header('Idempotent-Replayed', 'true').status(hit.status);
      return hit.body as T;
    }
    if (this.inflight.has(id)) throw new ApiHttpError(409, 'request_in_progress', 'A request with this Idempotency-Key is still being processed');

    this.inflight.add(id);
    try {
      const r = await exec();
      if (r.status >= 200 && r.status < 300) this.done.set(id, { fingerprint, status: r.status, body: r.body, expiresAt: this.now() + this.ttlMs });
      if (this.done.size > 10_000) for (const [k, v] of this.done) if (v.expiresAt <= this.now()) this.done.delete(k);
      reply.status(r.status);
      return r.body;
    } finally {
      this.inflight.delete(id);
    }
  }
}
