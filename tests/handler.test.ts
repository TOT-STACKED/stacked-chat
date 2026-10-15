import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createModernHandler } from '../src/index.js';
import { testConfig } from './helpers.js';

// A tiny stand-in for the legacy server: hands matching URLs to the modern handler.
let server: http.Server;
let base = '';
beforeAll(async () => {
  const modern = createModernHandler({ config: testConfig });
  await modern.ready;
  server = http.createServer(async (req, res) => {
    if (modern.handles(req.url ?? '')) return modern.handle(req, res);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('legacy');
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('strangler front door', () => {
  it('claims only /healthz and /api/v1', async () => {
    const m = createModernHandler({ config: testConfig });
    expect(m.handles('/healthz')).toBe(true);
    expect(m.handles('/healthz?deep=true')).toBe(true);
    expect(m.handles('/api/v1/me')).toBe(true);
    for (const legacy of ['/', '/admin', '/chat', '/api', '/api/v2/x', '/health', '/venues/search?q=a']) {
      expect(m.handles(legacy), legacy).toBe(false);
    }
  });

  it('routes modern URLs to Fastify and everything else to legacy', async () => {
    expect((await fetch(base + '/healthz')).status).toBe(200);
    expect(await (await fetch(base + '/admin')).text()).toBe('legacy');
  });

  it('answers CORS preflight for API headers (Authorization, X-API-Key, Idempotency-Key)', async () => {
    const res = await fetch(base + '/api/v1/anything', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    const allow = res.headers.get('access-control-allow-headers') ?? '';
    for (const h of ['Authorization', 'X-API-Key', 'Idempotency-Key']) expect(allow).toContain(h);
  });
});
