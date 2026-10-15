import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { fakeDb, testConfig } from './helpers.js';

describe('GET /healthz', () => {
  it('returns ok without touching the database by default', async () => {
    const app = await buildApp(testConfig);
    const res = await app.inject('/healthz');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ status: 'ok', version: 'test', database: 'skipped' });
    expect(typeof body.uptime_seconds).toBe('number');
  });

  it('deep check reports database state', async () => {
    const ok = await buildApp(testConfig, { db: fakeDb(true) });
    expect((await ok.inject('/healthz?deep=true')).json().database).toBe('ok');
    const bad = await buildApp(testConfig, { db: fakeDb(false) });
    expect((await bad.inject('/healthz?deep=true')).json().database).toBe('error');
    const none = await buildApp(testConfig);
    expect((await none.inject('/healthz?deep=true')).json().database).toBe('not_configured');
  });
});

describe('API conventions', () => {
  it('unknown routes use the standard error envelope', async () => {
    const app = await buildApp(testConfig);
    const res = await app.inject('/api/v1/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'No such endpoint' } });
  });

  it('serves a generated OpenAPI 3.1 document', async () => {
    const app = await buildApp(testConfig);
    const res = await app.inject('/api/v1/openapi.json');
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths['/healthz']).toBeDefined();
    expect(doc.components.securitySchemes.apiKey).toBeDefined();
  });

  it('never writes credentials to the logs', async () => {
    const lines: string[] = [];
    const app = await buildApp({ ...testConfig, LOG_LEVEL: 'trace' }, { logStream: { write: (m) => void lines.push(m) } });
    await app.inject({ url: '/healthz', headers: { authorization: 'Bearer SECRET-TOKEN-123', 'x-api-key': 'sk_live_SECRETKEY', cookie: 'sa_admin=SECRETCOOKIE' } });
    const out = lines.join('');
    expect(out.length).toBeGreaterThan(0); // it did log the request...
    for (const secret of ['SECRET-TOKEN-123', 'sk_live_SECRETKEY', 'SECRETCOOKIE']) expect(out).not.toContain(secret);
  });
});
