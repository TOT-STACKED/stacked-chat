/**
 * Private file storage (Supabase Storage, bucket `stacked-videos`).
 *
 * - Reads: stored URLs keep their historical "public" form, and are turned into short-lived
 *   SIGNED urls at the moment they are handed to a browser. Non-bucket URLs (YouTube...) pass through.
 * - Writes: the browser never gets a storage key. The server picks the object path, checks the file
 *   type/size rules, and mints a one-time signed upload URL.
 */
export type FileKind = 'video' | 'image' | 'doc';

export const KIND_RULES: Record<FileKind, { maxBytes: number; types: RegExp[] }> = {
  video: { maxBytes: 50 * 1024 * 1024, types: [/^video\/(mp4|quicktime|webm|x-m4v|mpeg)$/] },
  image: { maxBytes: 10 * 1024 * 1024, types: [/^image\/(png|jpe?g|gif|webp|heic|heif|avif)$/] },
  doc: {
    maxBytes: 25 * 1024 * 1024,
    types: [
      /^application\/pdf$/, /^application\/msword$/, /^application\/vnd\.ms-(excel|powerpoint)$/,
      /^application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)$/,
      /^text\/(plain|csv|markdown)$/, /^application\/octet-stream$/,
    ],
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class StorageRuleError extends Error {}

/** Object path for a new upload. The CLIENT never chooses it. `venue/…`, `images/venue/…`, `docs/venue/…`. */
export function buildPath(kind: FileKind, venueId: string, filename: string, now = Date.now()): string {
  if (!UUID.test(venueId)) throw new StorageRuleError('Invalid venue');
  const safe = String(filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(-100) || 'file';
  const prefix = kind === 'video' ? `${venueId}/` : kind === 'image' ? `images/${venueId}/` : `docs/${venueId}/`;
  return `${prefix}${now}-${safe}`;
}

/** Enforce the per-kind content-type allow-list and size cap. */
export function checkUpload(kind: FileKind, contentType: string, size: number): void {
  const rule = KIND_RULES[kind];
  if (!rule) throw new StorageRuleError('Unknown file kind');
  const ct = String(contentType || '').toLowerCase().split(';')[0]!.trim();
  if (!rule.types.some((r) => r.test(ct))) throw new StorageRuleError(`That file type is not allowed for ${kind} uploads`);
  if (!Number.isFinite(size) || size <= 0) throw new StorageRuleError('Empty file');
  if (size > rule.maxBytes) throw new StorageRuleError(`File is over the ${Math.round(rule.maxBytes / 1048576)}MB limit`);
}

export interface StorageOptions {
  supabaseUrl: string;
  serviceKey: string;
  bucket?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface SignedUpload { path: string; uploadUrl: string; url: string }

export function createStorage(opts: StorageOptions) {
  const base = opts.supabaseUrl.replace(/\/$/, '');
  const bucket = opts.bucket ?? 'stacked-videos';
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const publicPrefix = `${base}/storage/v1/object/public/${bucket}/`;
  const headers = { apikey: opts.serviceKey, Authorization: 'Bearer ' + opts.serviceKey, 'Content-Type': 'application/json' };
  const cache = new Map<string, { url: string; exp: number }>();

  /** Object path inside our bucket for a stored URL, or null if the URL is not one of ours. */
  function pathFromUrl(url: unknown): string | null {
    if (typeof url !== 'string' || !url.startsWith(publicPrefix)) return null;
    let p: string;
    try { p = decodeURIComponent(url.slice(publicPrefix.length).split('?')[0] ?? ''); } catch { return null; }
    if (!p || p.split('/').some((seg) => seg === '..' || seg === '')) return null;
    return p;
  }
  const canonicalUrl = (path: string) => publicPrefix + path.split('/').map(encodeURIComponent).join('/');

  /**
   * Sign many stored URLs at once (one batch call for the uncached ones). Order is preserved.
   * Anything that isn't ours, or fails to sign, comes back unchanged.
   */
  async function signUrls(urls: Array<string | null | undefined>, ttlSeconds = 6 * 3600): Promise<Array<string | null>> {
    const t = now();
    const out: Array<string | null> = urls.map((u) => (typeof u === 'string' ? u : null));
    const need = new Map<string, number[]>(); // path -> indexes
    urls.forEach((u, i) => {
      const p = pathFromUrl(u);
      if (!p) return;
      const hit = cache.get(p);
      if (hit && hit.exp > t) { out[i] = hit.url; return; }
      need.set(p, [...(need.get(p) ?? []), i]);
    });
    if (!need.size) return out;
    try {
      const res = await f(`${base}/storage/v1/object/sign/${bucket}`, {
        method: 'POST', headers, body: JSON.stringify({ expiresIn: ttlSeconds, paths: [...need.keys()] }),
      });
      if (!res.ok) return out;
      const rows = (await res.json()) as Array<{ path?: string; signedURL?: string | null; error?: unknown }>;
      for (const r of rows) {
        if (!r.path || !r.signedURL || r.error) continue;
        const full = r.signedURL.startsWith('http') ? r.signedURL : base + '/storage/v1' + (r.signedURL.startsWith('/') ? '' : '/') + r.signedURL;
        cache.set(r.path, { url: full, exp: t + (ttlSeconds * 1000) / 2 }); // reuse for half its life
        for (const i of need.get(r.path) ?? []) out[i] = full;
      }
    } catch { /* leave the originals */ }
    return out;
  }

  /** One-time signed upload URL for a server-chosen path. */
  async function createUpload(path: string): Promise<SignedUpload> {
    const res = await f(`${base}/storage/v1/object/upload/sign/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers, body: '{}' }); // Supabase rejects a JSON content-type with an empty body
    if (!res.ok) throw new Error('Could not create upload URL');
    const j = (await res.json()) as { url?: string };
    if (!j.url) throw new Error('Could not create upload URL');
    return { path, uploadUrl: base + '/storage/v1' + (j.url.startsWith('/') ? '' : '/') + j.url, url: canonicalUrl(path) };
  }

  /** Store bytes at a server-chosen path (service key; never overwrites). Returns the canonical stored URL. */
  async function uploadObject(path: string, data: Uint8Array, contentType: string): Promise<string> {
    const res = await f(`${base}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST', headers: { apikey: opts.serviceKey, Authorization: 'Bearer ' + opts.serviceKey, 'Content-Type': contentType, 'x-upsert': 'false' }, body: data as unknown as BodyInit,
    });
    if (!res.ok) throw new Error(`Could not store the file (${res.status})`);
    return canonicalUrl(path);
  }

  /**
   * Tenant check for URLs a venue admin registers: a URL in our bucket must sit inside THAT venue's
   * own folders, so one venue can never register (and so read) another venue's files.
   */
  function ownsUrl(url: unknown, venueId: string): boolean {
    if (typeof url !== 'string' || !url.startsWith(publicPrefix)) return true; // not in our bucket (e.g. YouTube)
    const p = pathFromUrl(url);
    if (!p || !UUID.test(venueId)) return false;
    return [`${venueId}/`, `images/${venueId}/`, `docs/${venueId}/`].some((pre) => p.startsWith(pre));
  }

  return { pathFromUrl, canonicalUrl, signUrls, createUpload, uploadObject, ownsUrl, bucket };
}

export type Storage = ReturnType<typeof createStorage>;
