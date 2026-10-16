import { execSync, spawn, type ChildProcess } from 'node:child_process';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Guards the Stacked team admin page (client JS lives inside a template literal in server.js, so a
 * syntax error there silently kills every button and `node --check` can't see it) and the redirects from
 * the retired chat widget. Boots the real server.
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

describe('the old widget is gone; the Stacked team admin page still works', () => {
  it('/admin: 200 and every inline script is valid JavaScript', async () => {
    const res = await fetch(base + '/admin');
    expect(res.status).toBe(200);
    const scripts = inlineScripts(await res.text());
    expect(scripts.length).toBeGreaterThan(0);
    for (const code of scripts) expect(() => new vm.Script(code)).not.toThrow();
  });

  it('the old addresses send people to the new chat', async () => {
    for (const path of ['/', '/app', '/app/', '/?join=abc', '/app#triage']) {
      const res = await fetch(base + path, { redirect: 'manual' });
      expect(res.status, path).toBe(302);
      expect(res.headers.get('location'), path).toBe('/chat/');
    }
  });

  it('the old widget endpoints no longer exist', async () => {
    for (const [m, p] of [['POST', '/chat'], ['POST', '/history'], ['POST', '/save-conversation'], ['POST', '/save-ticket'], ['POST', '/save-nps'], ['POST', '/save-lead'],
      ['POST', '/venues'], ['GET', '/venues/search?q=a'], ['POST', '/venue-members'], ['POST', '/kb-upload'], ['POST', '/kb-video'], ['POST', '/kb-image'],
      ['POST', '/storage/sign-upload'], ['POST', '/admin-summary'], ['GET', '/cron/digest']] as const) {
      expect((await fetch(base + p, { method: m, redirect: 'manual' })).status, `${m} ${p}`).toBe(404);
    }
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

  it('the partner report page has been removed', async () => {
    expect((await fetch(base + '/report', { redirect: 'manual' })).status).toBe(404);
    expect((await fetch(base + '/report?vendor=x', { redirect: 'manual' })).status).toBe(404);
    const admin = await (await fetch(base + '/admin')).text();
    expect(admin).not.toContain('href="/report"');
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
      expect((await fetch(`http://127.0.0.1:${port}/admin`)).status).toBe(200);
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(404); // modern absent
    } finally { p.kill(); }
  });

  it('DISABLE_MODERN_API=1 switches the modern API off', async () => {
    const port = 4900 + Math.floor(Math.random() * 300);
    const p = await bootLegacy(process.cwd(), { DISABLE_MODERN_API: '1' }, port);
    try {
      expect((await fetch(`http://127.0.0.1:${port}/admin`)).status).toBe(200);
      expect((await fetch(`http://127.0.0.1:${port}/api/v1/openapi.json`)).status).toBe(404);
    } finally { p.kill(); }
  });
});
