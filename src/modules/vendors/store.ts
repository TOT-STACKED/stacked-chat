import type { Db } from '../../lib/supabase.js';

export type TechStack = Record<string, string>;
/** What a venue has recorded about its own systems (venues.tech_stack), so the assistant never asks what it already knows. */
export interface TechStackStore {
  get(siteId: string): Promise<TechStack | null>;
  list(orgId: string): Promise<Array<{ id: string; name: string; stack: TechStack }>>;
  set(siteId: string, stack: TechStack): Promise<TechStack>;
}

const enc = encodeURIComponent;
export function createSupabaseTechStackStore(db: Db): TechStackStore {
  const ok = <T>(r: { status: number; data: T }, what: string): T => { if (r.status >= 300) throw new Error(`tech stack store: ${what} failed (${r.status})`); return r.data; };
  const clean = (v: unknown): TechStack => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'string')) as TechStack : {});
  return {
    async get(siteId) {
      const rows = ok(await db.rest<Array<{ tech_stack: unknown }>>(`/venues?id=eq.${enc(siteId)}&select=tech_stack&limit=1`), 'get');
      return rows[0] ? clean(rows[0].tech_stack) : null;
    },
    async list(orgId) {
      return (ok(await db.rest<Array<{ id: string; name: string; tech_stack: unknown }>>(`/venues?org_id=eq.${enc(orgId)}&select=id,name,tech_stack&order=name.asc&limit=5000`), 'list') ?? []).map((v) => ({ id: v.id, name: v.name, stack: clean(v.tech_stack) }));
    },
    async set(siteId, stack) {
      const rows = ok(await db.rest<Array<{ tech_stack: unknown }>>(`/venues?id=eq.${enc(siteId)}&select=tech_stack`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { tech_stack: stack } }), 'set');
      return clean(rows[0]?.tech_stack);
    },
  };
}
