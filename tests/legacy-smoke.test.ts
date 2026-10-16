import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * server.js is now a tiny front door: it hands addresses to the compiled app, answers /health for the host,
 * and redirects the retired addresses. Boot the real thing and check exactly that.
 */
let proc: ChildProcess;
let base = '';
const PORT = 4100 + Math.floor(Math.random() * 400);

async function boot(cwd: string, extraEnv: Record<string, string>, port: number): Promise<ChildProcess> {
  const p = spawn('node', [join(cwd, 'server.js')], { cwd, env: { ...process.env, PORT: String(port), LOG_LEVEL: 'silent', ...extraEnv }, stdio: 'ignore' });
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return p; } catch { /* not up yet */ }
    if (Date.now() > deadline) { p.kill(); throw new Error('server did not start'); }
    await new Promise((r) => setTimeout(r, 200));
  }
}

beforeAll(async () => { execSync('npx tsc -p tsconfig.build.json', { stdio: 'inherit' }); proc = await boot(process.cwd(), {}, PORT); base = `http://127.0.0.1:${PORT}`; });
afterAll(() => { proc?.kill(); });

describe('the front door', () => {
  it('answers /health for the host and /healthz from the app', async () => {
    expect(await (await fetch(base + '/health')).json()).toEqual({ status: 'ok' });
    expect((await (await fetch(base + '/healthz')).json()).status).toBe('ok');
  });
  it('serves the apps and the API through it', async () => {
    for (const p of ['/chat/', '/manage/', '/console/']) expect((await fetch(base + p)).status, p).toBe(200);
    expect((await (await fetch(base + '/api/v1/openapi.json')).json()).openapi).toBe('3.1.0');
  });
  it('sends the retired addresses to their replacements', async () => {
    for (const p of ['/', '/app', '/app/', '/?join=abc', '/app#triage']) {
      const res = await fetch(base + p, { redirect: 'manual' });
      expect([res.status, res.headers.get('location')], p).toEqual([302, '/chat/']);
    }
    for (const p of ['/admin', '/admin/']) {
      const res = await fetch(base + p, { redirect: 'manual' });
      expect([res.status, res.headers.get('location')], p).toEqual([302, '/console/']);
    }
  });
  it('the old admin and widget endpoints no longer exist', async () => {
    for (const [m, p] of [['POST', '/admin-login'], ['GET', '/admin/status'], ['GET', '/analytics'], ['GET', '/venues/all'], ['GET', '/videos'], ['POST', '/videos/add'], ['POST', '/upload'],
      ['DELETE', '/documents?filename=x'], ['POST', '/scrape'], ['GET', '/youtube/search?q=a'], ['POST', '/youtube/import'], ['POST', '/venue/x/branding'], ['POST', '/ticket/1/close'],
      ['POST', '/history'], ['POST', '/save-conversation'], ['POST', '/venues'], ['POST', '/kb-upload'], ['GET', '/cron/digest'], ['GET', '/report'], ['GET', '/debug/env-check']] as const) {
      expect((await fetch(base + p, { method: m, redirect: 'manual' })).status, `${m} ${p}`).toBe(404);
    }
  });
});

describe('fail-safe: the host health check never depends on the app loading', () => {
  it('boots and answers /health when dist/ is missing entirely', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sc-nodist-'));
    copyFileSync('server.js', join(dir, 'server.js'));
    const port = 4600 + Math.floor(Math.random() * 300);
    const p = await boot(dir, {}, port);
    try {
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(404); // the app is absent
      expect((await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' })).status).toBe(302);
    } finally { p.kill(); }
  });
  it('DISABLE_MODERN_API=1 switches the app off but keeps /health', async () => {
    const port = 4900 + Math.floor(Math.random() * 300);
    const p = await boot(process.cwd(), { DISABLE_MODERN_API: '1' }, port);
    try {
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
      expect((await fetch(`http://127.0.0.1:${port}/api/v1/openapi.json`)).status).toBe(404);
    } finally { p.kill(); }
  });
});
