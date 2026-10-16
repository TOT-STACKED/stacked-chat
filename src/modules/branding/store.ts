import type { Db } from '../../lib/supabase.js';
import type { BrandingPatchT } from './validate.js';

export interface SiteBranding {
  id: string; name: string; bot_name: string | null; welcome_heading: string | null; welcome_message: string | null;
  primary_color: string | null; logo_url: string | null;
}
export interface BrandingStore {
  list(orgId: string): Promise<SiteBranding[]>;
  update(siteId: string, patch: BrandingPatchT): Promise<SiteBranding>;
}

const COLS = 'id,name,bot_name,welcome_heading,welcome_message,primary_color,logo_url';
const enc = encodeURIComponent;

export function createSupabaseBrandingStore(db: Db): BrandingStore {
  const ok = <T>(r: { status: number; data: T }, what: string): T => { if (r.status >= 300) throw new Error(`branding store: ${what} failed (${r.status})`); return r.data; };
  return {
    async list(orgId) {
      return ok(await db.rest<SiteBranding[]>(`/venues?org_id=eq.${enc(orgId)}&select=${COLS}&order=name.asc&limit=5000`), 'list') ?? [];
    },
    async update(siteId, patch) {
      const rows = ok(await db.rest<SiteBranding[]>(`/venues?id=eq.${enc(siteId)}&select=${COLS}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: patch }), 'update');
      return rows[0]!;
    },
  };
}
