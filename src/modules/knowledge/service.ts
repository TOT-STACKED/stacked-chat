import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { chunkText } from './chunk.js';
import type { ItemRow, KnowledgeStore, NewItem, Status } from './store.js';
import { describeVideoUrl, isHttpUrl } from './video.js';

const MAX_BODY = 600_000; // characters in one document (a long handbook is about 300,000)

export interface KnowledgeDeps {
  store: KnowledgeStore;
  now?: () => Date;
  log?: { warn(o: object, m?: string): void };
}

export type ItemView = Omit<ItemRow, 'body' | 'doc_filename' | 'video_id' | 'image_id'> & { chars: number | null };
const view = (i: ItemRow): ItemView => {
  const { body, doc_filename: _d, video_id: _v, image_id: _i, ...rest } = i;
  return { ...rest, chars: i.kind === 'document' ? (body ?? '').length : null };
};

export function createKnowledge(deps: KnowledgeDeps) {
  const { store } = deps;
  const now = () => (deps.now ?? (() => new Date()))().toISOString();

  async function workspaceOf(orgId: string, create: boolean): Promise<string | null> {
    const o = await store.getWorkspace(orgId);
    if (!o) throw notFound('Organisation not found');
    if (o.workspace_id) return o.workspace_id;
    return create ? store.ensureWorkspace(orgId, o.slug) : null;
  }

  // ---- adopt what is already there --------------------------------------------------------------
  /**
   * Content added through the old admin drawer lives only in documents/videos/images. Bring it into the
   * catalogue (published, company-wide) the first time it is seen, and drop catalogue entries whose
   * content was removed elsewhere. Safe to run on every list.
   */
  async function adopt(orgId: string, ws: string, existing: ItemRow[]): Promise<boolean> {
    const have = (f: (i: ItemRow) => unknown) => new Set(existing.filter((i) => i.status === 'published').map(f).filter(Boolean));
    const docKnown = have((i) => i.doc_filename); const vidKnown = have((i) => i.video_id); const imgKnown = have((i) => i.image_id);
    const [docs, vids, imgs] = await Promise.all([store.docNames(ws), store.videos(ws), store.images(ws)]);
    const base = { org_id: orgId, status: 'published' as Status, site_id: null, team_id: null, source: 'imported' as const, created_by: null, published_at: now() };
    const fresh: NewItem[] = [];

    for (const d of docs.filter((x) => !docKnown.has(x.filename))) {
      const { text } = await store.docText(ws, d.filename);
      fresh.push({ ...base, source_question: null, kind: 'document', title: d.filename, body: text, url: null, description: null, doc_filename: d.filename, video_id: null, image_id: null });
    }
    for (const v of vids.filter((x) => !vidKnown.has(x.id))) {
      fresh.push({ ...base, source_question: null, kind: 'video', title: v.title || 'Untitled video', body: null, url: v.url, description: v.description || null, doc_filename: null, video_id: v.id, image_id: null });
    }
    for (const i of imgs.filter((x) => !imgKnown.has(x.id))) {
      fresh.push({ ...base, source_question: null, kind: 'image', title: i.title || 'Untitled image', body: null, url: i.url, description: i.description || null, doc_filename: null, video_id: null, image_id: i.id });
    }
    await store.insertItems(fresh.map((f) => ({ ...f })));

    // published entries whose content has since been removed (e.g. from the old drawer) no longer exist
    const names = new Set(docs.map((d) => d.filename)); const vIds = new Set(vids.map((v) => v.id)); const iIds = new Set(imgs.map((i) => i.id));
    const gone = existing.filter((i) => i.status === 'published' && (
      (i.kind === 'document' && i.doc_filename && !names.has(i.doc_filename)) ||
      (i.kind === 'video' && i.video_id != null && !vIds.has(i.video_id)) ||
      (i.kind === 'image' && i.image_id && !iIds.has(i.image_id))));
    for (const g of gone) await store.deleteItem(g.id);
    return fresh.length > 0 || gone.length > 0;
  }

  async function list(orgId: string): Promise<ItemRow[]> {
    let items = await store.listItems(orgId);
    const ws = await workspaceOf(orgId, false);
    if (ws) {
      try { if (await adopt(orgId, ws, items)) items = await store.listItems(orgId); }
      catch (e) { deps.log?.warn({ orgId, err: String((e as Error).message) }, 'knowledge: adopt failed, showing what we have'); }
    }
    return items;
  }

  // ---- publish / unpublish: the only code that touches what the chat reads --------------------------
  async function publishToChat(item: ItemRow, ws: string): Promise<Partial<ItemRow>> {
    if (item.kind === 'document') {
      const name = item.doc_filename ?? item.title;
      await store.writeDoc(ws, name, chunkText(item.body ?? ''));
      return { doc_filename: name };
    }
    if (item.kind === 'video') {
      const info = describeVideoUrl(item.url ?? '');
      const id = await store.insertVideo(ws, { url: item.url ?? '', title: item.title, type: info.type, thumbnail: info.thumbnail, yt_id: info.yt_id, description: item.description ?? '' });
      return { video_id: id };
    }
    const id = await store.insertImage(ws, { url: item.url ?? '', title: item.title, description: item.description ?? '' });
    return { image_id: id };
  }
  async function removeFromChat(item: ItemRow, ws: string): Promise<void> {
    if (item.kind === 'document' && item.doc_filename) await store.deleteDoc(ws, item.doc_filename);
    else if (item.kind === 'video' && item.video_id != null) await store.deleteVideo(ws, item.video_id);
    else if (item.kind === 'image' && item.image_id) await store.deleteImage(ws, item.image_id);
  }
  const noChatRefs = { doc_filename: null, video_id: null, image_id: null };

  async function assertSite(orgId: string, siteId: string | null | undefined) {
    if (siteId && !(await store.siteIds(orgId)).includes(siteId)) throw badRequest('That site is not part of this organisation');
  }
  async function assertFreeTitle(orgId: string, title: string, exceptId?: string) {
    const clash = (await store.listItems(orgId)).find((i) => i.kind === 'document' && i.id !== exceptId && (i.doc_filename ?? i.title).toLowerCase() === title.toLowerCase());
    if (clash) throw conflict('There is already a document with that title. Choose another.');
  }

  /**
   * Turn an audience request into the stored form. A team audience takes its site from the team
   * (so "Kitchen at North" is aimed at North's kitchen); a company-wide team has no site.
   */
  async function resolveAudience(orgId: string, a: { site_id?: string | null; team_id?: string | null }): Promise<{ site_id: string | null; team_id: string | null }> {
    if (a.team_id) {
      const t = (await store.teams(orgId)).find((x) => x.id === a.team_id);
      if (!t) throw badRequest('That team is not part of this organisation');
      return { site_id: t.site_id, team_id: t.id };
    }
    return { site_id: a.site_id ?? null, team_id: null };
  }

  // ---- create -------------------------------------------------------------------------------------------
  async function createDocument(orgId: string, o: { title: string; body: string; site_id: string | null; team_id?: string | null; status: Status; by: string; source?: ItemRow['source']; source_question?: string | null }): Promise<ItemRow> {
    if (o.body.length > MAX_BODY) throw badRequest(`That document is too long (the limit is ${MAX_BODY.toLocaleString('en-GB')} characters)`);
    await assertSite(orgId, o.site_id); await assertFreeTitle(orgId, o.title);
    const aud = await resolveAudience(orgId, { site_id: o.site_id, team_id: o.team_id ?? null });
    let item = await store.insertItem({ org_id: orgId, kind: 'document', title: o.title, status: 'draft', site_id: aud.site_id, team_id: aud.team_id, body: o.body, url: null, description: null, ...noChatRefs, source: o.source ?? 'manager', source_question: o.source_question ?? null, created_by: o.by, published_at: null });
    if (o.status === 'published') item = await setStatus(orgId, item, 'published');
    return item;
  }
  async function createVideo(orgId: string, o: { title: string; url: string; description?: string | null; site_id: string | null; team_id?: string | null; status: Status; by: string }): Promise<ItemRow> {
    if (!isHttpUrl(o.url)) throw badRequest('Enter a web link that starts with https://');
    await assertSite(orgId, o.site_id);
    const aud = await resolveAudience(orgId, { site_id: o.site_id, team_id: o.team_id ?? null });
    let item = await store.insertItem({ org_id: orgId, kind: 'video', title: o.title, status: 'draft', site_id: aud.site_id, team_id: aud.team_id, body: null, url: o.url, description: o.description ?? null, ...noChatRefs, source: 'manager', source_question: null, created_by: o.by, published_at: null });
    if (o.status === 'published') item = await setStatus(orgId, item, 'published');
    return item;
  }

  async function createImage(orgId: string, o: { title: string; url: string; description?: string | null; site_id: string | null; team_id?: string | null; status: Status; by: string }): Promise<ItemRow> {
    await assertSite(orgId, o.site_id);
    const aud = await resolveAudience(orgId, { site_id: o.site_id, team_id: o.team_id ?? null });
    let item = await store.insertItem({ org_id: orgId, kind: 'image', title: o.title, status: 'draft', site_id: aud.site_id, team_id: aud.team_id, body: null, url: o.url, description: o.description ?? null, ...noChatRefs, source: 'manager', source_question: null, created_by: o.by, published_at: null });
    if (o.status === 'published') item = await setStatus(orgId, item, 'published');
    return item;
  }

  async function setStatus(orgId: string, item: ItemRow, status: Status): Promise<ItemRow> {
    if (item.status === status) return item;
    const ws = await workspaceOf(orgId, true);
    if (status === 'published') {
      const refs = await publishToChat(item, ws!);
      return store.updateItem(item.id, { ...refs, status, published_at: now() });
    }
    await removeFromChat(item, ws!);
    // keep the text/url on the catalogue entry so it can be published again
    return store.updateItem(item.id, { status, published_at: null, ...noChatRefs });
  }

  // ---- change -------------------------------------------------------------------------------------------
  async function update(orgId: string, id: string, patch: { title?: string; body?: string; url?: string; description?: string | null; site_id?: string | null; team_id?: string | null; status?: Status }): Promise<ItemRow> {
    let item = await store.getItem(orgId, id);
    if (!item) throw notFound('Knowledge item not found');
    if (patch.site_id !== undefined) await assertSite(orgId, patch.site_id);
    if (patch.team_id !== undefined || patch.site_id !== undefined) {
      // audience fields are sent together: a team wins (and brings its site); otherwise it is the company or one site
      const aud = await resolveAudience(orgId, { site_id: patch.site_id ?? null, team_id: patch.team_id ?? null });
      patch = { ...patch, site_id: aud.site_id, team_id: aud.team_id };
    }
    if (patch.body !== undefined && item.kind !== 'document') throw badRequest('Only documents have text');
    if (patch.body !== undefined && patch.body.length > MAX_BODY) throw badRequest(`That document is too long (the limit is ${MAX_BODY.toLocaleString('en-GB')} characters)`);
    if (patch.url !== undefined && item.kind === 'image') throw badRequest('A picture cannot be pointed somewhere else. Upload the new picture instead.');
    if (patch.url !== undefined && (item.kind === 'document' || !/^https:\/\//i.test(patch.url) || !isHttpUrl(patch.url))) throw badRequest('Enter a web link that starts with https://');
    if (patch.title !== undefined && item.kind === 'document' && patch.title !== item.title) await assertFreeTitle(orgId, patch.title, item.id);

    const wasPublished = item.status === 'published';
    const contentChanged = patch.title !== undefined || patch.body !== undefined || patch.url !== undefined || patch.description !== undefined;
    const target: Status = patch.status ?? item.status;
    const ws = (wasPublished || target === 'published') ? await workspaceOf(orgId, true) : null;

    // 1. take the old published copy out of the chat if it is going away or being replaced
    if (wasPublished && (target === 'draft' || contentChanged)) {
      await removeFromChat(item, ws!);
      item = { ...item, ...noChatRefs };
    }
    // 2. save the new details
    const { status: _s, ...details } = patch;
    item = await store.updateItem(item.id, { ...details, ...(wasPublished ? noChatRefs : {}), ...(target === 'draft' ? { status: 'draft' as Status, published_at: null } : {}) });
    // 3. put the new copy in the chat if it should be live
    if (target === 'published') {
      const refs = await publishToChat(item, ws!);
      item = await store.updateItem(item.id, { ...refs, status: 'published', published_at: wasPublished ? item.published_at ?? now() : now() });
    }
    return item;
  }

  async function remove(orgId: string, id: string): Promise<void> {
    const item = await store.getItem(orgId, id);
    if (!item) throw notFound('Knowledge item not found');
    if (item.status === 'published') await removeFromChat(item, (await workspaceOf(orgId, false)) ?? '');
    await store.deleteItem(item.id);
  }

  /**
   * For the chat: what must NOT be shown to this venue because it is published for a different site.
   * Returns document names and video/image ids (as the chat knows them).
   */
  async function excludedFor(siteId: string): Promise<{ docs: string[]; videos: number[]; images: string[] }> {
    const none = { docs: [], videos: [], images: [] };
    const orgId = await store.orgOfSite(siteId);
    if (!orgId) return none;
    const others = (await store.listItems(orgId)).filter((i) => i.status === 'published' && ((i.site_id !== null && i.site_id !== siteId) || i.team_id !== null)); // the old chat cannot tell who is asking, so team-only items stay hidden from it
    return {
      docs: others.map((i) => i.doc_filename).filter((x): x is string => !!x),
      videos: others.map((i) => i.video_id).filter((x): x is number => x != null),
      images: others.map((i) => i.image_id).filter((x): x is string => !!x),
    };
  }

  return { excludedFor, resolveAudience, list, get: (orgId: string, id: string) => store.getItem(orgId, id), createDocument, createVideo, createImage, update, remove, view };
}

export type Knowledge = ReturnType<typeof createKnowledge>;
export { view as knowledgeView };
