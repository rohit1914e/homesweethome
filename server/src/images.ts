// Food photo uploads arrive as data: URLs. We never trust the declared mime type:
// the decoded bytes must start with a real JPEG / PNG / WEBP signature.
import { unprocessable } from './errors.js';

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB decoded (matches the DB CHECK)

const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i;

/** Detect the real image type from its first bytes. */
export function sniffImageMime(buf: Buffer): ImageMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Parse + verify a data URL. Throws 422 image_invalid / image_too_large. */
export function parseImageDataUrl(dataUrl: string): { buffer: Buffer; mime: ImageMime } {
  const m = DATA_URL.exec(dataUrl);
  if (!m) throw unprocessable('image_invalid', 'That photo could not be read. Use a JPEG, PNG or WEBP image.');
  const b64 = m[2].replace(/\s+/g, '');
  // Cheap size guard before decoding: base64 is 4 chars per 3 bytes.
  if (Math.floor((b64.length * 3) / 4) > MAX_IMAGE_BYTES + 3) {
    throw unprocessable('image_too_large', 'That photo is larger than 2 MB. Pick a smaller one.');
  }
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length === 0) throw unprocessable('image_invalid', 'That photo is empty.');
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw unprocessable('image_too_large', 'That photo is larger than 2 MB. Pick a smaller one.');
  }
  const mime = sniffImageMime(buffer);
  if (!mime) throw unprocessable('image_invalid', 'That file is not a JPEG, PNG or WEBP photo.');
  return { buffer, mime };
}
