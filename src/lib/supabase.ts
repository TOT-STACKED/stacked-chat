/**
 * Minimal Supabase REST client (fetch only, no SDK). Server-side, service-role.
 * Kept behind an interface (`Db`) so modules and tests never depend on Supabase directly.
 */
export interface DbResult<T = unknown> {
  status: number;
  data: T;
}

export interface Db {
  /** Is the database reachable with the configured key? */
  ping(): Promise<boolean>;
  rest<T = unknown>(path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<DbResult<T>>;
}

export function createSupabaseDb(opts: { url: string; serviceKey: string; fetchImpl?: typeof fetch }): Db {
  const base = opts.url.replace(/\/$/, '');
  const f = opts.fetchImpl ?? fetch;
  async function rest<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<DbResult<T>> {
    const res = await f(base + '/rest/v1' + path, {
      method: init.method ?? 'GET',
      headers: {
        apikey: opts.serviceKey,
        Authorization: 'Bearer ' + opts.serviceKey,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data: data as T };
  }
  return {
    rest,
    async ping() {
      try {
        const r = await rest('/venues?select=id&limit=1');
        return r.status >= 200 && r.status < 300;
      } catch {
        return false;
      }
    },
  };
}
