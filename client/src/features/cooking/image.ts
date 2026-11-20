// Shrink a phone photo before upload: longest side ≤ 1280 px, re-encoded as JPEG.
// The server still verifies the bytes (magic numbers, ≤ 2 MB) — this only saves bandwidth.
const MAX_SIDE = 1280;
const MAX_BYTES = 2 * 1024 * 1024;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be opened as a photo. Try a JPEG, PNG or WEBP image.'));
    };
    img.src = url;
  });
}

/** Approximate decoded size of a base64 data URL. */
export function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((b64.length * 3) / 4);
}

export async function downscaleToJpeg(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Pick a photo (JPEG, PNG or WEBP).');
  }
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot prepare photos.');
  // JPEG has no transparency: paint a dark backdrop so transparent PNGs don't turn black-on-black oddly.
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-room').trim() || 'black';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  for (const q of [0.82, 0.7, 0.55]) {
    const out = canvas.toDataURL('image/jpeg', q);
    if (dataUrlBytes(out) <= MAX_BYTES) return out;
  }
  throw new Error('That photo is still larger than 2 MB after shrinking. Pick a smaller one.');
}
