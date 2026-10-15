/** Fixed-window limiter, in memory (per instance). Fine for one service; move to Redis if we scale out. */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly limit: number, private readonly windowMs = 60_000, private readonly now: () => number = Date.now) {}

  hit(key: string): { allowed: boolean; limit: number; remaining: number; retryAfterSeconds: number } {
    const t = this.now();
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
    let rec = this.hits.get(key);
    if (!rec || rec.resetAt <= t) rec = { count: 0, resetAt: t + this.windowMs };
    rec.count++;
    this.hits.set(key, rec);
    return {
      allowed: rec.count <= this.limit,
      limit: this.limit,
      remaining: Math.max(0, this.limit - rec.count),
      retryAfterSeconds: Math.max(1, Math.ceil((rec.resetAt - t) / 1000)),
    };
  }
}
