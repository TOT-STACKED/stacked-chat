import { execSync, spawn, type ChildProcess } from 'node:child_process';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Guards the live widget. All client JS lives inside template literals in server.js, so a
 * syntax error there silently kills every button (and `node --check server.js` can't see it).
 * Boot the real server, fetch each page, and parse every inline <script>.
 */
let proc: ChildProcess;
let base = '';
const PORT = 4100 + Math.floor(Math.random() * 400);

beforeAll(async () => {
  execSync('npx tsc -p tsconfig.build.json', { stdio: 'inherit' });
  proc = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: String(PORT), STACKED_ADMIN_PASSWORD: 'test-admin-pw', CRON_SECRET: 'test-cron-secret', LOG_LEVEL: 'silent' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  base = `http://127.0.0.1:${PORT}`;
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(base + '/health')).ok) break; } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('server did not start');
    await new Promise((r) => setTimeout(r, 200));
  }
});
afterAll(() => { proc?.kill(); });

function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '');
}

describe('legacy pages still render and their client JS parses', () => {
  for (const path of ['/', '/admin', '/app']) {
    it(`${path}: 200 and every inline script is valid JavaScript`, async () => {
      const res = await fetch(base + path);
      expect(res.status).toBe(200);
      const html = await res.text();
      const scripts = inlineScripts(html);
      expect(scripts.length).toBeGreaterThan(0);
      for (const code of scripts) expect(() => new vm.Script(code)).not.toThrow();
    });
  }

  it('the chat page no longer reads the database directly', async () => {
    const html = await (await fetch(base + '/')).text();
    expect(html).not.toContain('/rest/v1/');
  });

  it('the chat page no longer uploads to storage with the public key (uploads go via the server)', async () => {
    const html = await (await fetch(base + '/')).text();
    expect(html).not.toContain('/storage/v1/object/stacked-videos/');
    expect(html).not.toContain('/storage/v1/object/public/');
    expect(html).toContain('/storage/sign-upload');
  });

  it('the signed-upload endpoint refuses anonymous callers', async () => {
    const res = await fetch(base + '/storage/sign-upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ venue_id: 'x', kind: 'doc', filename: 'a.pdf', content_type: 'application/pdf', size: 10 }) });
    expect([401, 503]).toContain(res.status); // 503 here: no service key in the test environment
    expect((await res.json()).ok).toBe(false);
  });
});

describe('legacy behaviour preserved alongside the modern API', () => {
  it('legacy /health and modern /healthz both answer', async () => {
    expect(await (await fetch(base + '/health')).json()).toEqual({ status: 'ok' });
    expect((await (await fetch(base + '/healthz')).json()).status).toBe('ok');
  });

  it('modern OpenAPI is reachable through the legacy server', async () => {
    const doc = await (await fetch(base + '/api/v1/openapi.json')).json();
    expect(doc.openapi).toBe('3.1.0');
  });

  it('admin-only endpoints reject anonymous callers', async () => {
    for (const [m, p] of [['GET', '/venues/all'], ['GET', '/videos'], ['POST', '/scrape'], ['DELETE', '/documents?filename=x'], ['GET', '/admin/status']] as const) {
      expect((await fetch(base + p, { method: m })).status, `${m} ${p}`).toBe(401);
    }
  });

  it('the old public debug endpoint is gone', async () => {
    expect((await fetch(base + '/debug/env-check')).status).toBe(404);
  });
});

// ---- fail-safe: the legacy server must never depend on the modern API -------------------
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function bootLegacy(cwd: string, extraEnv: Record<string, string>, port: number): Promise<ChildProcess> {
  const p = spawn('node', [join(cwd, 'server.js')], {
    cwd,
    env: { ...process.env, PORT: String(port), STACKED_ADMIN_PASSWORD: 'x-admin', CRON_SECRET: 'x-cron', LOG_LEVEL: 'silent', ...extraEnv },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return p; } catch { /* not up yet */ }
    if (Date.now() > deadline) { p.kill(); throw new Error('server did not start'); }
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('fail-safe: legacy keeps working if the modern API cannot load', () => {
  it('boots and serves pages when dist/ is missing entirely', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sc-nodist-'));
    copyFileSync('server.js', join(dir, 'server.js'));
    const port = 4600 + Math.floor(Math.random() * 300);
    const p = await bootLegacy(dir, {}, port);
    try {
      expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(404); // modern absent
    } finally { p.kill(); }
  });

  it('DISABLE_MODERN_API=1 switches the modern API off', async () => {
    const port = 4900 + Math.floor(Math.random() * 300);
    const p = await bootLegacy(process.cwd(), { DISABLE_MODERN_API: '1' }, port);
    try {
      expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);
      expect((await fetch(`http://127.0.0.1:${port}/api/v1/openapi.json`)).status).toBe(404);
    } finally { p.kill(); }
  });
});
