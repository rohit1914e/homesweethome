// Uploaded profile pictures. Render's free tier has no persistent disk, so the processed image
// lives in PostgreSQL (member_photos, one row per member — replacing overwrites, nothing piles up).
// Every upload is re-encoded by sharp: EXIF-rotated, cropped to 512×512, metadata stripped, WebP.
import { Router } from 'express';
import sharp from 'sharp';
import { query } from './db.js';
import { HttpError, notFound } from './errors.js';
import { parseImageDataUrl } from './images.js';
import { MEMBER_IDS } from './members.js';
import { broadcast } from './realtime.js';
import { idParam, parse, z } from './validate.js';

export const PHOTO_SIZE = 512;
/** Refuse decompression bombs: at most 40 megapixels of decoded image. */
const MAX_INPUT_PIXELS = 40_000_000;

export const photoInputSchema = z.object({ image: z.string().min(1, 'Choose a picture.').max(3_000_000) });

/** Validate (type by magic bytes, ≤ 2 MB) and re-encode an uploaded data URL. */
export async function processPhoto(dataUrl: string): Promise<Buffer> {
  const { buffer } = parseImageDataUrl(dataUrl); // 422 image_invalid / image_too_large
  try {
    return await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate()
      .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: 'cover', position: sharp.strategy.attention })
      .webp({ quality: 82 })
      .toBuffer(); // sharp drops EXIF/GPS metadata unless asked to keep it
  } catch {
    throw new HttpError(422, 'image_invalid', 'That picture could not be read. Try a different JPEG, PNG or WebP file.');
  }
}

function assertMember(id: number) {
  if (!MEMBER_IDS.includes(id)) throw notFound('That roommate does not exist.');
}

export async function setMemberPhoto(memberId: number, dataUrl: string, actorId: number): Promise<void> {
  assertMember(memberId);
  const webp = await processPhoto(dataUrl);
  await query(
    `INSERT INTO member_photos (member_id, image, mime, updated_by) VALUES ($1, $2, 'image/webp', $3)
     ON CONFLICT (member_id) DO UPDATE SET image = EXCLUDED.image, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [memberId, webp, actorId],
  );
  broadcast('member:updated', { memberId });
}

/** Back to the default picture (the one shipped with the app, or initials). */
export async function removeMemberPhoto(memberId: number): Promise<void> {
  assertMember(memberId);
  await query('DELETE FROM member_photos WHERE member_id = $1', [memberId]);
  broadcast('member:updated', { memberId });
}

/** Public (the login screen shows faces before sign-in). URLs are versioned, so they cache forever. */
export function photoRouter(): Router {
  const router = Router();
  router.get('/:id/photo', async (req, res) => {
    const id = parse(idParam, req.params.id);
    const { rows } = await query<{ image: Buffer; mime: string }>('SELECT image, mime FROM member_photos WHERE member_id = $1', [id]);
    if (!rows[0]) throw notFound('No uploaded picture.');
    res.setHeader('Content-Type', rows[0].mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(rows[0].image);
  });
  return router;
}
