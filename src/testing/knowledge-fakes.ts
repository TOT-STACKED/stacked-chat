import { randomUUID } from 'node:crypto';
import type { ItemRow, KnowledgeStore, NewItem, WorkspaceImage, WorkspaceVideo } from '../modules/knowledge/store.js';

/** In-memory knowledge store: the catalogue plus the legacy tables the chat reads. */
export class FakeKnowledgeStore implements KnowledgeStore {
  items: ItemRow[] = [];
  orgs = new Map<string, { workspace_id: string | null; slug: string }>();
  sites: Array<{ id: string; org_id: string }> = [];
  docs: Array<{ workspace_id: string; filename: string; content: string; chunk_index: number; file_url: string | null; created_at: string }> = [];
  vids: Array<WorkspaceVideo & { tenant: string; type?: string }> = [];
  imgs: Array<WorkspaceImage & { tenant: string }> = [];
  private seq = 1;

  addOrg(orgId: string, slug: string, workspace: string | null = null) { this.orgs.set(orgId, { workspace_id: workspace, slug }); }
  addSite(orgId: string) { const s = { id: randomUUID(), org_id: orgId }; this.sites.push(s); return s; }
  /** legacy content, as the old admin drawer would have left it */
  addLegacyDoc(ws: string, filename: string, text: string) {
    for (let i = 0, n = 0; i < text.length || n === 0; i += 1200, n++) this.docs.push({ workspace_id: ws, filename, content: text.slice(i, i + 1200), chunk_index: n, file_url: null, created_at: new Date().toISOString() });
  }
  addLegacyVideo(ws: string, url: string, title: string) { const v = { id: this.seq++, url, title, description: '', created_at: new Date().toISOString(), tenant: ws }; this.vids.push(v); return v; }
  addLegacyImage(ws: string, url: string, title: string) { const i = { id: randomUUID(), url, title, description: '', created_at: new Date().toISOString(), tenant: ws }; this.imgs.push(i); return i; }

  async getWorkspace(orgId: string) { return this.orgs.get(orgId) ?? null; }
  async ensureWorkspace(orgId: string, slug: string) { const o = this.orgs.get(orgId)!; o.workspace_id ??= slug; return o.workspace_id; }
  async listItems(orgId: string) { return structuredClone(this.items.filter((i) => i.org_id === orgId)); }
  async getItem(orgId: string, id: string) { return structuredClone(this.items.find((i) => i.id === id && i.org_id === orgId) ?? null); }
  async insertItem(n: NewItem) {
    const dup = this.items.find((i) => i.org_id === n.org_id && ((n.doc_filename && i.doc_filename === n.doc_filename) || (n.video_id != null && i.video_id === n.video_id) || (n.image_id && i.image_id === n.image_id)));
    if (dup) throw new Error('duplicate');
    const row: ItemRow = { ...n, id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    this.items.push(row); return structuredClone(row);
  }
  async insertItems(items: NewItem[]) { for (const n of items) await this.insertItem(n).catch(() => undefined); }
  async updateItem(id: string, patch: Partial<ItemRow>) {
    const i = this.items.find((x) => x.id === id)!; Object.assign(i, patch, { updated_at: new Date().toISOString() }); return structuredClone(i);
  }
  async deleteItem(id: string) { this.items = this.items.filter((i) => i.id !== id); }

  async docNames(ws: string) {
    const m = new Map<string, string>(); for (const d of this.docs.filter((x) => x.workspace_id === ws)) m.set(d.filename, d.created_at);
    return [...m].map(([filename, created_at]) => ({ filename, created_at }));
  }
  async docText(ws: string, filename: string) {
    const rows = this.docs.filter((d) => d.workspace_id === ws && d.filename === filename).sort((a, b) => a.chunk_index - b.chunk_index);
    return { text: rows.map((r) => r.content).join(''), file_url: rows[0]?.file_url ?? null };
  }
  async writeDoc(ws: string, filename: string, chunks: string[]) {
    await this.deleteDoc(ws, filename);
    chunks.forEach((content, chunk_index) => this.docs.push({ workspace_id: ws, filename, content, chunk_index, file_url: null, created_at: new Date().toISOString() }));
  }
  async deleteDoc(ws: string, filename: string) { this.docs = this.docs.filter((d) => !(d.workspace_id === ws && d.filename === filename)); }
  async videos(ws: string) { return this.vids.filter((v) => v.tenant === ws); }
  async insertVideo(ws: string, v: { url: string; title: string; type: string; description: string }) {
    const row = { id: this.seq++, url: v.url, title: v.title, description: v.description, created_at: new Date().toISOString(), tenant: ws, type: v.type }; this.vids.push(row); return row.id;
  }
  async deleteVideo(ws: string, id: number) { this.vids = this.vids.filter((v) => !(v.tenant === ws && v.id === id)); }
  async images(ws: string) { return this.imgs.filter((i) => i.tenant === ws); }
  async insertImage(ws: string, i: { url: string; title: string; description: string }) {
    const row = { id: randomUUID(), ...i, created_at: new Date().toISOString(), tenant: ws }; this.imgs.push(row); return row.id;
  }
  async deleteImage(ws: string, id: string) { this.imgs = this.imgs.filter((i) => !(i.tenant === ws && i.id === id)); }
  async siteIds(orgId: string) { return this.sites.filter((s) => s.org_id === orgId).map((s) => s.id); }
  async orgOfSite(siteId: string) { return this.sites.find((s) => s.id === siteId)?.org_id ?? null; }
}
