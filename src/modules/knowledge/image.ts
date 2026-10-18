import { badRequest } from '../../lib/errors.js';
import type { PictureType } from './vision.js';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB, same as other uploads
const EXT: Record<PictureType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** What a picture really is, from its first bytes (the name and content type are only hints). PNG, JPEG and WebP only. */
export function sniffImage(buf: Buffer): PictureType {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw badRequest('That picture type is not supported. Use a PNG, JPEG or WebP image (iPhone photos: choose "Most Compatible", or take a screenshot).');
}

/** A tidy stored file name with the right extension for what the bytes really are. */
export function imageFileName(original: string, type: PictureType): string {
  const stem = original.replace(/\.[a-z0-9]+$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[._-]+/, '').slice(0, 60) || 'picture';
  return `${stem}.${EXT[type]}`;
}

/** A title to start from: the file name without its extension, with the separators turned into spaces. */
export function imageTitle(original: string): string {
  const t = original.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return t ? t[0]!.toUpperCase() + t.slice(1) : 'Picture';
}
