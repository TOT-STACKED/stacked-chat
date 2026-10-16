import { badRequest } from '../../lib/errors.js';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export type FileKind = 'pdf' | 'docx' | 'text';
export interface Extracted { kind: FileKind; text: string; pages: number | null }

/** Tidy extracted text: unix line breaks, no NULs, no runs of blank lines or spaces. */
export function normaliseText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n').replace(/\u0000/g, '').replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

const startsWith = (b: Buffer, sig: number[]) => sig.every((v, i) => b[i] === v);
const ext = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();

/** Decide what a file really is from its first bytes (the name and content type are only hints). */
export function sniff(buf: Buffer, filename: string): FileKind {
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf'; // %PDF-
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) { // zip container
    if (ext(filename) === 'docx') return 'docx';
    throw badRequest('That looks like a zip-based file. Word documents need to be .docx.');
  }
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0])) throw badRequest('Old Word files (.doc) are not supported. Save it as .docx or PDF and try again.');
  if (['txt', 'md', 'markdown', 'csv'].includes(ext(filename)) && !buf.subarray(0, 4096).includes(0)) return 'text';
  throw badRequest('That file type is not supported. Upload a PDF, a Word document (.docx), or a plain text file (.txt, .md).');
}

async function pdfText(buf: Buffer): Promise<{ text: string; pages: number }> {
  // pdf.js (legacy build runs on Node); loaded on demand so the app starts fast and an install problem cannot stop the server.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let out = '';
      for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
        if (typeof item.str !== 'string') continue;
        out += item.str + (item.hasEOL ? '\n' : item.str.endsWith(' ') ? '' : ' ');
      }
      pages.push(out);
      page.cleanup();
    }
    return { text: pages.join('\n\n'), pages: doc.numPages };
  } finally { await doc.destroy(); }
}

async function docxText(buf: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const m = (mammoth as unknown as { default?: typeof mammoth }).default ?? mammoth;
  return (await m.extractRawText({ buffer: buf })).value;
}

/** Pull the readable text out of an uploaded PDF, Word (.docx) or plain-text file. Throws a friendly 400 if it cannot. */
export async function extractText(buf: Buffer, filename: string): Promise<Extracted> {
  if (!buf.length) throw badRequest('That file is empty.');
  if (buf.length > MAX_UPLOAD_BYTES) throw badRequest('That file is too big. The limit is 10 MB.');
  const kind = sniff(buf, filename);
  let raw: string; let pages: number | null = null;
  try {
    if (kind === 'pdf') { const r = await pdfText(buf); raw = r.text; pages = r.pages; }
    else if (kind === 'docx') raw = await docxText(buf);
    else raw = buf.toString('utf8');
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode) throw e;
    throw badRequest(kind === 'pdf' ? 'We could not read that PDF. It may be damaged or password-protected.' : 'We could not read that file. It may be damaged.');
  }
  const text = normaliseText(raw);
  if (!text) throw badRequest(kind === 'pdf' ? 'That PDF has no text we can read. It may be a scan or photo. Try a text-based PDF, or paste the text in.' : 'There is no text in that file.');
  return { kind, text, pages };
}

/** "Allergen policy v2.pdf" -> "Allergen policy v2" */
export const titleFromFilename = (name: string) => name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled document';
