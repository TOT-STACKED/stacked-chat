import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiHttpError, badRequest, forbidden, notFound } from '../../lib/errors.js';
import { atLeast, bestRole, canManageMembers, type Principal } from '../../lib/permissions.js';
import { assertOrgAccess, userOnly } from '../access.js';
import { UNITS, type AiBudget } from '../../lib/ai-budget.js';
import { ErrorBody, Id, SECURITY } from '../schemas.js';
import { MAX_UPLOAD_BYTES, extractText, titleFromFilename } from './extract.js';
import { MAX_IMAGE_BYTES, imageFileName, imageTitle, sniffImage } from './image.js';
import { MAX_READABLE_BYTES, type PictureReader } from './vision.js';
import { buildPath } from '../../lib/storage.js';
import type { Knowledge } from './service.js';
import { knowledgeView } from './service.js';
import type { ItemRow } from './store.js';

/** Private file storage for pictures, and the model that reads writing off them. Either can be absent (the buttons then say so). */
export interface FileStore { /** the path of a file in OUR storage, or null for any other address */ pathFromUrl?(url: unknown): string | null; signUrls(urls: Array<string | null | undefined>, ttlSeconds?: number): Promise<Array<string | null>>; uploadObject?(path: string, data: Uint8Array, contentType: string): Promise<string> }
interface Ctx { aiBudget?: AiBudget | null; knowledge: Knowledge | null; gate: (orgId: string) => Promise<void>; files?: FileStore | null; reader?: PictureReader | null }

const Title = z.string().trim().min(1).max(120);
const Status = z.enum(['draft', 'published']);
const ItemOut = z.object({
  id: Id, org_id: Id, kind: z.enum(['document', 'video', 'image']), title: z.string(), status: Status, site_id: Id.nullable(),
  team_id: Id.nullable(), url: z.string().nullable(), description: z.string().nullable(), source: z.enum(['manager', 'ai_draft', 'imported']), created_by: z.string().nullable(),
  created_at: z.string(), updated_at: z.string(), published_at: z.string().nullable(), chars: z.number().nullable(),
});
const ItemDetail = ItemOut.extend({ body: z.string().nullable(), preview_url: z.string().nullable().optional() });

export async function knowledgeRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const kb = (): Knowledge => { if (!ctx.knowledge) throw notFound('Knowledge is not available'); return ctx.knowledge; };

  /** A short-lived link a browser can show a stored picture from (the bucket is private). */
  const previewUrl = async (i: ItemRow): Promise<string | null> => {
    if (i.kind !== 'image' || !i.url) return null;
    const [u] = ctx.files ? await ctx.files.signUrls([i.url]).catch(() => [i.url]) : [i.url];
    return u ?? null;
  };

  /** May this person manage knowledge for this audience (null = the whole company)? Same rule as managing people. */
  const canWrite = (p: Principal, orgId: string, siteId: string | null) => p.kind === 'user' && canManageMembers(p, orgId, siteId);
  /** Who can SEE an item: managers of its audience (drafts included); API keys see published items for their scope. */
  const canSee = (p: Principal, orgId: string, i: ItemRow) => {
    if (p.kind === 'api_key') return i.status === 'published' && (p.siteId === null || i.site_id === null || i.site_id === p.siteId);
    const managerAnywhere = p.memberships.some((m) => m.orgId === orgId && atLeast(m.role, 'site_manager'));
    return i.site_id === null ? managerAnywhere : atLeast(bestRole(p, orgId, i.site_id), 'site_manager');
  };

  r.get('/api/v1/orgs/:orgId/knowledge', {
    preHandler: app.authenticate,
    schema: {
      tags: ['knowledge'], summary: 'List knowledge items you can see (documents, videos, images)', security: SECURITY,
      params: z.object({ orgId: Id }), response: { 200: z.object({ data: z.array(ItemOut) }), 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId } = req.params;
    const p = assertOrgAccess(req, orgId, 'kb:read');
    return { data: (await kb().list(orgId)).filter((i) => canSee(p, orgId, i)).map(knowledgeView) };
  });

  r.get('/api/v1/orgs/:orgId/knowledge/:id', {
    preHandler: app.authenticate,
    schema: {
      tags: ['knowledge'], summary: 'One knowledge item, with its text', security: SECURITY,
      params: z.object({ orgId: Id, id: Id }), response: { 200: ItemDetail, 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId, id } = req.params;
    const p = assertOrgAccess(req, orgId, 'kb:read');
    await kb().list(orgId); // adopts anything new first, so a just-added old item can be opened
    const item = await kb().get(orgId, id);
    if (!item || !canSee(p, orgId, item)) throw notFound('Knowledge item not found');
    return { ...knowledgeView(item), body: item.body, preview_url: await previewUrl(item) };
  });

  const Create = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('document'), title: Title, body: z.string().max(600_000), site_id: Id.nullable().optional(), team_id: Id.nullable().optional(), status: Status.default('draft') }),
    z.object({ kind: z.literal('video'), title: Title, url: z.string().trim().url().max(2000), description: z.string().trim().max(500).nullable().optional(), site_id: Id.nullable().optional(), team_id: Id.nullable().optional(), status: Status.default('draft') }),
  ]);
  r.post('/api/v1/orgs/:orgId/knowledge', {
    preHandler: app.authenticate,
    schema: {
      tags: ['knowledge'], summary: 'Add a document (text) or a video (link). Drafts are never used by the chat until published.', security: SECURITY,
      params: z.object({ orgId: Id }), body: Create,
      response: { 201: ItemDetail, 400: ErrorBody, 402: ErrorBody, 403: ErrorBody, 404: ErrorBody, 409: ErrorBody },
    },
  }, async (req, reply) => {
    const { orgId } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    await ctx.gate(orgId);
    const b = req.body;
    const aud = await kb().resolveAudience(orgId, { site_id: b.site_id ?? null, team_id: b.team_id ?? null });
    const siteId = aud.site_id;
    if (!canWrite(actor, orgId, siteId)) throw forbidden(siteId ? 'You cannot add knowledge for this site' : 'Only company admins can add knowledge for the whole company');
    const item = b.kind === 'document'
      ? await kb().createDocument(orgId, { title: b.title, body: b.body, site_id: b.site_id ?? null, team_id: b.team_id ?? null, status: b.status, by: actor.email })
      : await kb().createVideo(orgId, { title: b.title, url: b.url, description: b.description || null, site_id: b.site_id ?? null, team_id: b.team_id ?? null, status: b.status, by: actor.email });
    reply.status(201);
    return { ...knowledgeView(item), body: item.body };
  });

  // Upload a PDF, Word (.docx) or text file. The raw file is the request body. We read the text out of it and
  // save it as a DRAFT, so a person always reviews what was extracted before anything is published.
  for (const type of ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'text/plain', 'text/markdown', 'application/octet-stream']) {
    app.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES + 1024 }, (_req, body, done) => done(null, body));
  }
  r.post('/api/v1/orgs/:orgId/knowledge/upload', {
    bodyLimit: MAX_UPLOAD_BYTES + 1024,
    onRequest: app.authenticate, // before the body is read, so a stranger cannot make us buffer 10 MB
    schema: {
      tags: ['knowledge'], security: SECURITY,
      summary: 'Upload a PDF, Word (.docx) or text file. The text is extracted and saved as a draft to review.',
      params: z.object({ orgId: Id }),
      querystring: z.object({ filename: z.string().trim().min(1).max(200), site_id: Id.optional() }),
      response: { 201: ItemDetail, 400: ErrorBody, 402: ErrorBody, 403: ErrorBody, 404: ErrorBody, 409: ErrorBody },
    },
  }, async (req, reply) => {
    const { orgId } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    await ctx.gate(orgId);
    const siteId = req.query.site_id ?? null;
    if (!canWrite(actor, orgId, siteId)) throw forbidden(siteId ? 'You cannot add knowledge for this site' : 'Only company admins can add knowledge for the whole company');
    if (!Buffer.isBuffer(req.body)) throw badRequest('Send the file itself as the request body');
    const { text, kind } = await extractText(req.body, req.query.filename);
    const base = titleFromFilename(req.query.filename);
    // never clash with an existing title: "Handbook", "Handbook (2)", ...
    const taken = new Set((await kb().list(orgId)).filter((i) => i.kind === 'document').map((i) => (i.doc_filename ?? i.title).toLowerCase()));
    let title = base; for (let n = 2; taken.has(title.toLowerCase()); n++) title = `${base} (${n})`;
    const item = await kb().createDocument(orgId, { title, body: text, site_id: siteId, status: 'draft', by: actor.email });
    reply.status(201);
    req.log.info({ orgId, kind, chars: text.length }, 'knowledge upload');
    return { ...knowledgeView(item), body: item.body };
  });

  // Upload a picture (PNG, JPEG or WebP): saved to private storage and added as a DRAFT image to describe and publish.
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
    app.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: MAX_IMAGE_BYTES + 1024 }, (_req, body, done) => done(null, body));
  }
  r.post('/api/v1/orgs/:orgId/knowledge/upload-image', {
    bodyLimit: MAX_IMAGE_BYTES + 1024,
    onRequest: app.authenticate,
    schema: {
      tags: ['knowledge'], security: SECURITY,
      summary: 'Upload a picture (PNG, JPEG or WebP, up to 10 MB). It is saved as a draft to describe and publish.',
      params: z.object({ orgId: Id }),
      querystring: z.object({ filename: z.string().trim().min(1).max(200), site_id: Id.optional() }),
      response: { 201: ItemDetail, 400: ErrorBody, 402: ErrorBody, 403: ErrorBody, 404: ErrorBody, 502: ErrorBody, 503: ErrorBody },
    },
  }, async (req, reply) => {
    const { orgId } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    await ctx.gate(orgId);
    const siteId = req.query.site_id ?? null;
    if (!canWrite(actor, orgId, siteId)) throw forbidden(siteId ? 'You cannot add knowledge for this site' : 'Only company admins can add knowledge for the whole company');
    if (!ctx.files?.uploadObject) throw new ApiHttpError(503, 'storage_unavailable', 'Picture uploads are not switched on yet');
    if (!Buffer.isBuffer(req.body)) throw badRequest('Send the picture itself as the request body');
    const type = sniffImage(req.body);
    const path = buildPath('image', orgId, imageFileName(req.query.filename, type));
    let url: string;
    try { url = await ctx.files.uploadObject(path, req.body, type); }
    catch (e) { req.log.error({ orgId, err: String((e as Error).message) }, 'picture upload failed'); throw new ApiHttpError(502, 'storage_failed', 'We could not save that picture. Please try again.'); }
    const item = await kb().createImage(orgId, { title: imageTitle(req.query.filename), url, site_id: siteId, status: 'draft', by: actor.email });
    reply.status(201);
    req.log.info({ orgId, bytes: req.body.length, type }, 'picture upload');
    return { ...knowledgeView(item), body: null, preview_url: await previewUrl(item) };
  });

  // Read the writing off a stored picture (a spec card, a menu page). Nothing is saved: the text comes back to be checked.
  r.post('/api/v1/orgs/:orgId/knowledge/:id/read-picture', {
    preHandler: app.authenticate,
    schema: {
      tags: ['knowledge'], security: SECURITY,
      summary: 'Read the text from a picture so it can be checked and saved as its description. Nothing is saved by this call.',
      params: z.object({ orgId: Id, id: Id }),
      response: { 200: z.object({ text: z.string() }), 400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 502: ErrorBody, 503: ErrorBody },
    },
  }, async (req) => {
    const { orgId, id } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    await ctx.gate(orgId);
    const item = await kb().get(orgId, id);
    if (!item || item.kind !== 'image' || !item.url || !canSee(actor, orgId, item)) throw notFound('Picture not found');
    if (!canWrite(actor, orgId, item.site_id)) throw forbidden('You cannot change this item');
    if (!ctx.reader || !ctx.files) throw new ApiHttpError(503, 'reader_unavailable', 'Reading text from pictures is not switched on yet');
    // Only files in our own storage are ever fetched: an address a person typed in is never followed from the server.
    if (!ctx.files.pathFromUrl || !ctx.files.pathFromUrl(item.url)) throw badRequest('That picture is not stored here, so it cannot be read. Upload it again.');
    const [signed] = await ctx.files.signUrls([item.url]);
    if (!signed) throw new ApiHttpError(502, 'picture_unavailable', 'We could not open that picture. Please try again.');
    let data: Buffer;
    try {
      const res = await fetch(signed, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      // read in pieces and stop at the limit, so a huge file can never fill the server's memory
      const parts: Buffer[] = []; let size = 0;
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) { size += chunk.length; if (size > MAX_READABLE_BYTES) { await res.body.cancel().catch(() => {}); throw badRequest('That picture is too large to read. Upload a smaller version (under 5 MB).'); } parts.push(Buffer.from(chunk)); }
      data = Buffer.concat(parts);
    } catch (e) { if (e instanceof ApiHttpError) throw e; throw new ApiHttpError(502, 'picture_unavailable', 'We could not open that picture. Please try again.'); }
    if (data.length > MAX_READABLE_BYTES) throw badRequest('That picture is too large to read. Upload a smaller version (under 5 MB).');
    await ctx.aiBudget?.spend(orgId, UNITS.picture);
    const text = await ctx.reader.read({ data, mediaType: sniffImage(data) });
    if (!text) throw new ApiHttpError(502, 'reader_failed', 'We could not read that picture just now. You can type the details in instead.');
    return { text };
  });

  r.patch('/api/v1/orgs/:orgId/knowledge/:id', {
    preHandler: app.authenticate,
    schema: {
      tags: ['knowledge'], summary: 'Edit, retarget (company or one site), publish or unpublish', security: SECURITY,
      params: z.object({ orgId: Id, id: Id }),
      body: z.object({ title: Title.optional(), body: z.string().max(600_000).optional(), url: z.string().trim().url().max(2000).optional(), description: z.string().max(4000).nullable().optional(), site_id: Id.nullable().optional(), team_id: Id.nullable().optional(), status: Status.optional() })
        .refine((b) => Object.keys(b).length > 0, 'Nothing to change'),
      response: { 200: ItemDetail, 400: ErrorBody, 402: ErrorBody, 403: ErrorBody, 404: ErrorBody, 409: ErrorBody },
    },
  }, async (req) => {
    const { orgId, id } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    await ctx.gate(orgId);
    const item = await kb().get(orgId, id);
    if (!item || !canSee(actor, orgId, item)) throw notFound('Knowledge item not found');
    if (!canWrite(actor, orgId, item.site_id)) throw forbidden('You cannot change this item');
    if (req.body.site_id !== undefined || req.body.team_id !== undefined) {
      const aud = await kb().resolveAudience(orgId, { site_id: req.body.site_id ?? null, team_id: req.body.team_id ?? null });
      if (!canWrite(actor, orgId, aud.site_id)) throw forbidden('You cannot move this item there');
    }
    const updated = await kb().update(orgId, id, req.body);
    return { ...knowledgeView(updated), body: updated.body };
  });

  r.delete('/api/v1/orgs/:orgId/knowledge/:id', {
    preHandler: app.authenticate,
    schema: {
      tags: ['knowledge'], summary: 'Delete a knowledge item (and take it out of the chat)', security: SECURITY,
      params: z.object({ orgId: Id, id: Id }),
      response: { 200: z.object({ deleted: z.literal(true) }), 402: ErrorBody, 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => {
    const { orgId, id } = req.params;
    const actor = userOnly(req);
    assertOrgAccess(req, orgId);
    await ctx.gate(orgId);
    const item = await kb().get(orgId, id);
    if (!item || !canSee(actor, orgId, item)) throw notFound('Knowledge item not found');
    if (!canWrite(actor, orgId, item.site_id)) throw forbidden('You cannot delete this item');
    await kb().remove(orgId, id);
    return { deleted: true as const };
  });
}
