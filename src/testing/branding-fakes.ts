import type { BrandingStore, SiteBranding } from '../modules/branding/store.js';

/** In-memory branding store for the local preview. */
export class FakeBrandingStore implements BrandingStore {
  rows = new Map<string, SiteBranding>();
  constructor(private sites: () => Array<{ id: string; org_id: string; name: string }>) {}
  private get(id: string, name: string): SiteBranding { return this.rows.get(id) ?? { id, name, bot_name: null, welcome_heading: null, welcome_message: null, primary_color: null, logo_url: null }; }
  async list(orgId: string) { return this.sites().filter((s) => s.org_id === orgId).map((s) => this.get(s.id, s.name)); }
  async update(id: string, patch: Partial<SiteBranding>) { const s = this.sites().find((x) => x.id === id)!; const next = { ...this.get(id, s.name), ...patch }; this.rows.set(id, next); return next; }
}
