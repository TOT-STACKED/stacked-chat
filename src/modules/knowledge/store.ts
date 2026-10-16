import type { Db } from '../../lib/supabase.js';

export type Kind = 'document' | 'video' | 'image';
export type Status = 'draft' | 'published';

export interface ItemRow {
  id: string; org_id: string; kind: Kind; title: string; status: Status; site_id: string | null; team_id: string | null;
  body: string | null; url: string | null; description: string | null;
  doc_filename: string | null; video_id: number | null; image_id: string | null;
  source: 'manager' | 'ai_draft' | 'imported'; source_question: string | null; created_by: string | null;
  created_at: string; updated_at: string; published_at: string | null;
}
export type NewItem = Omit<ItemRow, 'id' | 'created_at' | 'updated_at'>;

export interface WorkspaceVideo { id: number; url: string; title: string | null; description: string | null; created_at: string }
export interface WorkspaceImage { id: string; url: string; title: string | null; description: string | null; created_at: string }

/** Everything Knowledge needs from storage. Supabase in production, in-memory in tests. */
export interface KnowledgeStore {
  /** the organisation's content workspace id (what documents/videos/images are tagged with), or null if it has none yet */
  getWorkspace(orgId: string): Promise<{ workspace_id: string | null; slug: string } | null>;
  /** give the organisation (and all its venues) a workspace id so published content is visible to its chat */
  ensureWorkspace(orgId: string, slug: string): Promise<string>;

  listItems(orgId: string): Promise<ItemRow[]>;
  getItem(orgId: string, id: string): Promise<ItemRow | null>;
  insertItem(item: NewItem): Promise<ItemRow>;
  insertItems(items: NewItem[]): Promise<void>;
  updateItem(id: string, patch: Partial<Omit<ItemRow, 'id' | 'org_id' | 'created_at'>>): Promise<ItemRow>;
  deleteItem(id: string): Promise<void>;

  // legacy content the chat reads
  docNames(workspace: string): Promise<Array<{ filename: string; created_at: string | null }>>;
  docText(workspace: string, filename: string): Promise<{ text: string; file_url: string | null }>;
  writeDoc(workspace: string, filename: string, chunks: string[]): Promise<void>;
  deleteDoc(workspace: string, filename: string): Promise<void>;
  videos(workspace: string): Promise<WorkspaceVideo[]>;
  insertVideo(workspace: string, v: { url: string; title: string; type: string; thumbnail: string; yt_id: string | null; description: string }): Promise<number>;
  deleteVideo(workspace: string, id: number): Promise<void>;
  images(workspace: string): Promise<WorkspaceImage[]>;
  insertImage(workspace: string, i: { url: string; title: string; description: string }): Promise<string>;
  deleteImage(workspace: string, id: string): Promise<void>;
  /** the venues of an organisation (to validate audience targeting) */
  siteIds(orgId: string): Promise<string[]>;
  /** the organisation's teams (to validate a team audience) */
  teams(orgId: string): Promise<Array<{ id: string; name: string; site_id: string | null }>>;
  /** which organisation a venue belongs to */
  orgOfSite(siteId: string): Promise<string | null>;
}

const enc = encodeURIComponent;
const COLS = 'id,org_id,kind,title,status,site_id,team_id,body,url,description,doc_filename,video_id,image_id,source,source_question,created_by,created_at,updated_at,published_at';

export function createSupabaseKnowledgeStore(db: Db): KnowledgeStore {
  const ok = <T>(r: { status: number; data: T }, what: string): T => {
    if (r.status >= 300) throw new Error(`knowledge store: ${what} failed (${r.status})`);
    return r.data;
  };
  const rep = { Prefer: 'return=representation' };
  const first = <T>(rows: T[] | null) => (rows && rows[0]) ?? null;

  return {
    async getWorkspace(orgId) {
      return first(ok(await db.rest<Array<{ workspace_id: string | null; slug: string }>>(`/organisations?id=eq.${enc(orgId)}&select=workspace_id,slug&limit=1`), 'get workspace'));
    },
    async ensureWorkspace(orgId, slug) {
      const cur = await this.getWorkspace(orgId);
      if (cur?.workspace_id) return cur.workspace_id;
      // The legacy chat finds content through venues.workspace_id, so set it on every venue of the organisation
      // (the sync trigger then makes the organisation adopt it).
      ok(await db.rest(`/venues?org_id=eq.${enc(orgId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { workspace_id: slug } }), 'set workspace on venues');
      ok(await db.rest(`/organisations?id=eq.${enc(orgId)}&workspace_id=is.null`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { workspace_id: slug } }), 'set workspace on organisation');
      return slug;
    },

    async listItems(orgId) {
      return ok(await db.rest<ItemRow[]>(`/knowledge_items?org_id=eq.${enc(orgId)}&select=${COLS}&order=updated_at.desc&limit=5000`), 'list items') ?? [];
    },
    async getItem(orgId, id) {
      return first(ok(await db.rest<ItemRow[]>(`/knowledge_items?id=eq.${enc(id)}&org_id=eq.${enc(orgId)}&select=${COLS}&limit=1`), 'get item'));
    },
    async insertItem(item) {
      return first(ok(await db.rest<ItemRow[]>(`/knowledge_items?select=${COLS}`, { method: 'POST', headers: rep, body: item }), 'insert item'))!;
    },
    async insertItems(items) {
      if (!items.length) return;
      ok(await db.rest('/knowledge_items?on_conflict=id', { method: 'POST', headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' }, body: items }), 'insert items');
    },
    async updateItem(id, patch) {
      return first(ok(await db.rest<ItemRow[]>(`/knowledge_items?id=eq.${enc(id)}&select=${COLS}`, { method: 'PATCH', headers: rep, body: { ...patch, updated_at: new Date().toISOString() } }), 'update item'))!;
    },
    async deleteItem(id) {
      ok(await db.rest(`/knowledge_items?id=eq.${enc(id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }), 'delete item');
    },

    async docNames(ws) {
      const rows = ok(await db.rest<Array<{ filename: string; created_at: string | null }>>(`/documents?workspace_id=eq.${enc(ws)}&select=filename,created_at&limit=20000`), 'doc names') ?? [];
      const seen = new Map<string, string | null>();
      for (const r of rows) if (r.filename && (!seen.has(r.filename) || (r.created_at && (seen.get(r.filename) ?? '9') > r.created_at))) seen.set(r.filename, r.created_at);
      return [...seen].map(([filename, created_at]) => ({ filename, created_at }));
    },
    async docText(ws, filename) {
      const rows = ok(await db.rest<Array<{ content: string; chunk_index: number; file_url: string | null }>>(
        `/documents?workspace_id=eq.${enc(ws)}&filename=eq.${enc(filename)}&select=content,chunk_index,file_url&order=chunk_index.asc&limit=5000`), 'doc text') ?? [];
      return { text: rows.map((r) => r.content ?? '').join(''), file_url: rows.find((r) => r.file_url)?.file_url ?? null };
    },
    async writeDoc(ws, filename, chunks) {
      await this.deleteDoc(ws, filename);
      if (!chunks.length) return;
      ok(await db.rest('/documents', { method: 'POST', headers: { Prefer: 'return=minimal' },
        body: chunks.map((content, i) => ({ filename, content, chunk_index: i, workspace_id: ws })) }), 'write doc');
    },
    async deleteDoc(ws, filename) {
      ok(await db.rest(`/documents?workspace_id=eq.${enc(ws)}&filename=eq.${enc(filename)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }), 'delete doc');
    },
    async videos(ws) {
      return ok(await db.rest<WorkspaceVideo[]>(`/videos?tenant=eq.${enc(ws)}&select=id,url,title,description,created_at&limit=5000`), 'videos') ?? [];
    },
    async insertVideo(ws, v) {
      return first(ok(await db.rest<Array<{ id: number }>>('/videos?select=id', { method: 'POST', headers: rep, body: { ...v, tenant: ws } }), 'insert video'))!.id;
    },
    async deleteVideo(ws, id) {
      ok(await db.rest(`/videos?id=eq.${id}&tenant=eq.${enc(ws)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }), 'delete video');
    },
    async images(ws) {
      return ok(await db.rest<WorkspaceImage[]>(`/images?tenant=eq.${enc(ws)}&select=id,url,title,description,created_at&limit=5000`), 'images') ?? [];
    },
    async insertImage(ws, i) {
      return first(ok(await db.rest<Array<{ id: string }>>('/images?select=id', { method: 'POST', headers: rep, body: { ...i, tenant: ws } }), 'insert image'))!.id;
    },
    async deleteImage(ws, id) {
      ok(await db.rest(`/images?id=eq.${enc(id)}&tenant=eq.${enc(ws)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }), 'delete image');
    },
    async teams(orgId) {
      return ok(await db.rest<Array<{ id: string; name: string; site_id: string | null }>>(`/teams?org_id=eq.${enc(orgId)}&select=id,name,site_id&limit=5000`), 'teams') ?? [];
    },
    async orgOfSite(siteId) {
      return first(ok(await db.rest<Array<{ org_id: string | null }>>(`/venues?id=eq.${enc(siteId)}&select=org_id&limit=1`), 'org of site'))?.org_id ?? null;
    },
    async siteIds(orgId) {
      return (ok(await db.rest<Array<{ id: string }>>(`/venues?org_id=eq.${enc(orgId)}&select=id&limit=5000`), 'site ids') ?? []).map((r) => r.id);
    },
  };
}
