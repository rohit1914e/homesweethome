// Turns the owner's original photos (git-ignored, project root or ./photos) into
// 512×512 face-centred WebP avatars in client/public/avatars/<slug>.webp (EXIF stripped).
//   npm run avatars
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const SLUGS = ['rohit', 'jagan', 'bharath', 'surya', 'bazith', 'dharun'];
const OUT = 'client/public/avatars';
// Manual square crops for photos where automatic framing misses the face.
// Fractions of the (EXIF-rotated) image: left/top of the square, size = side / image width.
const OVERRIDES = JSON.parse(process.env.AVATAR_OVERRIDES ?? 'null') ?? {
  bazith: { left: 0.29, top: 0.1, size: 0.38 },
  dharun: { left: 0.09, top: 0.09, size: 0.82 },
};

mkdirSync(OUT, { recursive: true });
const dirs = ['.', 'photos'].filter((d) => existsSync(d));

for (const slug of SLUGS) {
  const file = dirs
    .flatMap((d) => readdirSync(d).map((f) => join(d, f)))
    .find((f) => new RegExp(`(^|[\\/])${slug}\.(jpe?g|png|webp)$`, 'i').test(f));
  if (!file) {
    console.log(`- ${slug}: no photo found (initials will be shown)`);
    continue;
  }
  const base = sharp(file).rotate();
  const { width, height } = await sharp(await base.clone().toBuffer()).metadata();
  let img = base.clone();
  const o = OVERRIDES[slug];
  if (o) {
    const side = Math.round(Math.min(o.size * width, width, height));
    const left = Math.max(0, Math.min(width - side, Math.round(o.left * width)));
    const top = Math.max(0, Math.min(height - side, Math.round(o.top * height)));
    img = img.extract({ left, top, width: side, height: side });
  }
  const out = join(OUT, `${slug}.webp`);
  const info = await img
    .resize(512, 512, { fit: 'cover', position: sharp.strategy.attention })
    .webp({ quality: 82 })
    .toFile(out);
  console.log(`- ${slug}: ${file} -> ${out} (${Math.round(info.size / 1024)} KB)`);
}
