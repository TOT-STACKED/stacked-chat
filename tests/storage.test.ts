import { describe, expect, it } from 'vitest';
import { StorageRuleError, buildPath, checkUpload, createStorage } from '../src/lib/storage.js';

const V1 = '79009a0b-0b77-47d1-82a1-69aa0610f74d';
const V2 = '11111111-2222-4333-8444-555555555555';
const SUPA = 'https://x.supabase.co';
const pub = (p: string) => `${SUPA}/storage/v1/object/public/stacked-videos/${p}`;

function fakeFetch(handler: (url: string, init: RequestInit) => { ok: boolean; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return { ok: r.ok, json: async () => r.body } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const mk = (impl: typeof fetch, now = () => 1_000_000) => createStorage({ supabaseUrl: SUPA, serviceKey: 'SVC', fetchImpl: impl, now });

describe('buildPath (the server, never the browser, chooses where a file goes)', () => {
  it('puts each kind in its own venue folder with a timestamp', () => {
    expect(buildPath('video', V1, 'a.mp4', 5)).toBe(`${V1}/5-a.mp4`);
    expect(buildPath('image', V1, 'a.png', 5)).toBe(`images/${V1}/5-a.png`);
    expect(buildPath('doc', V1, 'a.pdf', 5)).toBe(`docs/${V1}/5-a.pdf`);
  });
  it('sanitises hostile file names (no traversal, no odd characters)', () => {
    const p = buildPath('doc', V1, '../../etc/pass wd?.pdf', 5);
    expect(p).toBe(`docs/${V1}/5-_.._etc_pass_wd_.pdf`); // flattened into ONE harmless file name
    expect(p.split('/')).toHaveLength(3);                  // docs / <venue> / <file>: no extra folders
    expect(p.startsWith(`docs/${V1}/`)).toBe(true);
    expect(p.split('/').includes('..')).toBe(false);
    expect(buildPath('doc', V1, '', 5)).toBe(`docs/${V1}/5-file`);
  });
  it('rejects anything that is not a real venue id', () => {
    for (const bad of ['', '../x', 'abc', `${V1}/../${V2}`]) expect(() => buildPath('video', bad, 'a.mp4')).toThrow(StorageRuleError);
  });
});

describe('checkUpload (type allow-list and size caps)', () => {
  it('accepts normal files', () => {
    expect(() => checkUpload('video', 'video/mp4', 1000)).not.toThrow();
    expect(() => checkUpload('image', 'image/jpeg', 1000)).not.toThrow();
    expect(() => checkUpload('doc', 'application/pdf; charset=binary', 1000)).not.toThrow();
  });
  it('rejects dangerous or mismatched types (SVG/HTML/scripts, a video sent as an image)', () => {
    for (const [k, t] of [['image', 'image/svg+xml'], ['doc', 'text/html'], ['doc', 'application/javascript'], ['image', 'video/mp4'], ['video', 'application/pdf'], ['doc', '']] as const) {
      expect(() => checkUpload(k, t, 1000), `${k} ${t}`).toThrow(StorageRuleError);
    }
  });
  it('enforces size caps and rejects empty files', () => {
    expect(() => checkUpload('video', 'video/mp4', 51 * 1024 * 1024)).toThrow(/50MB/);
    expect(() => checkUpload('image', 'image/png', 11 * 1024 * 1024)).toThrow(/10MB/);
    expect(() => checkUpload('doc', 'application/pdf', 0)).toThrow(/Empty/);
    expect(() => checkUpload('doc', 'application/pdf', Number.NaN)).toThrow(StorageRuleError);
  });
});

describe('pathFromUrl / ownsUrl (tenant isolation)', () => {
  const s = mk(fakeFetch(() => ({ ok: true })).impl);
  it('extracts the object path from our URLs only', () => {
    expect(s.pathFromUrl(pub(`images/${V1}/1-a.png`))).toBe(`images/${V1}/1-a.png`);
    expect(s.pathFromUrl('https://youtu.be/abc')).toBeNull();
    expect(s.pathFromUrl(null)).toBeNull();
    expect(s.pathFromUrl(pub('a/../b'))).toBeNull();
    expect(s.pathFromUrl(pub('a//b'))).toBeNull();
    expect(s.pathFromUrl(pub('a%2F..%2Fb'))).toBeNull();
  });
  it("a venue can only register files inside its own folders", () => {
    expect(s.ownsUrl(pub(`${V1}/1-v.mp4`), V1)).toBe(true);
    expect(s.ownsUrl(pub(`images/${V1}/1-a.png`), V1)).toBe(true);
    expect(s.ownsUrl(pub(`docs/${V1}/1-a.pdf`), V1)).toBe(true);
    expect(s.ownsUrl(pub(`images/${V2}/1-a.png`), V1)).toBe(false); // another venue's file
    expect(s.ownsUrl(pub(`images/${V1}/../${V2}/x.png`), V1)).toBe(false);
    expect(s.ownsUrl(pub('secret/other.txt'), V1)).toBe(false);
    expect(s.ownsUrl('https://youtu.be/dQw4w9WgXcQ', V1)).toBe(true); // external links are fine
  });
});

describe('signUrls', () => {
  const ok = (path: string) => ({ path, signedURL: `/object/sign/stacked-videos/${path}?token=T-${path}`, error: null });

  it('signs our URLs in ONE batch call, preserves order, and passes others through', async () => {
    const { impl, calls } = fakeFetch((_u, init) => ({ ok: true, body: JSON.parse(init.body as string).paths.map(ok) }));
    const out = await mk(impl).signUrls([pub('a.png'), 'https://youtu.be/x', null, pub('b.png'), undefined], 3600);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${SUPA}/storage/v1/object/sign/stacked-videos`);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ expiresIn: 3600, paths: ['a.png', 'b.png'] });
    expect(out).toEqual([`${SUPA}/storage/v1/object/sign/stacked-videos/a.png?token=T-a.png`, 'https://youtu.be/x', null, `${SUPA}/storage/v1/object/sign/stacked-videos/b.png?token=T-b.png`, null]);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer SVC');
  });

  it('caches signed URLs (no second call) until half their life is gone', async () => {
    let t = 1_000_000;
    const { impl, calls } = fakeFetch((_u, init) => ({ ok: true, body: JSON.parse(init.body as string).paths.map(ok) }));
    const s = mk(impl, () => t);
    await s.signUrls([pub('a.png')], 3600);
    await s.signUrls([pub('a.png')], 3600);
    expect(calls).toHaveLength(1);
    t += 1_900_000; // > half of 3600s
    await s.signUrls([pub('a.png')], 3600);
    expect(calls).toHaveLength(2);
  });

  it('never throws: a failed or partial signing leaves the original URL', async () => {
    const down = fakeFetch(() => ({ ok: false }));
    expect(await mk(down.impl).signUrls([pub('a.png')])).toEqual([pub('a.png')]);
    const boom = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
    expect(await mk(boom).signUrls([pub('a.png')])).toEqual([pub('a.png')]);
    const partial = fakeFetch(() => ({ ok: true, body: [ok('a.png'), { path: 'b.png', signedURL: null, error: 'not found' }] }));
    const out = await mk(partial.impl).signUrls([pub('a.png'), pub('b.png')]);
    expect(out[0]).toContain('token=T-a.png');
    expect(out[1]).toBe(pub('b.png'));
  });
});

describe('createUpload', () => {
  it('returns a one-time upload URL plus the canonical URL to store', async () => {
    const { impl, calls } = fakeFetch(() => ({ ok: true, body: { url: `/object/upload/sign/stacked-videos/docs/${V1}/1-a.pdf?token=TKN`, token: 'TKN' } }));
    const u = await mk(impl).createUpload(`docs/${V1}/1-a.pdf`);
    expect(calls[0]!.url).toBe(`${SUPA}/storage/v1/object/upload/sign/stacked-videos/docs/${V1}/1-a.pdf`);
    expect(calls[0]!.init.method).toBe('POST');
    // regression: a JSON content-type with NO body is rejected by Supabase Storage (400)
    expect((calls[0]!.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(calls[0]!.init.body).toBe('{}');
    expect(u.uploadUrl).toBe(`${SUPA}/storage/v1/object/upload/sign/stacked-videos/docs/${V1}/1-a.pdf?token=TKN`);
    expect(u.url).toBe(pub(`docs/${V1}/1-a.pdf`));
  });
  it('fails loudly when Supabase refuses', async () => {
    await expect(mk(fakeFetch(() => ({ ok: false })).impl).createUpload('x/y.txt')).rejects.toThrow(/upload URL/);
  });
});
