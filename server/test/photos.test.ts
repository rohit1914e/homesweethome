import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { anon, closeSockets, connectSocket, expectError, loginAll, resetData, setupFile, sql, teardownFile, waitForEvent, type Client } from './helpers.js';

beforeAll(setupFile);
afterAll(teardownFile);

let c: Record<number, Client>;
beforeEach(async () => {
  closeSockets();
  await resetData();
  c = await loginAll();
});

const png = async (w: number, h: number, color = { r: 200, g: 120, b: 40 }) =>
  `data:image/png;base64,${(await sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer()).toString('base64')}`;
const avatarOf = async (viewer: Client, id: number) =>
  (await viewer.get('/api/members')).body.members.find((m: any) => m.id === id).avatarUrl as string | null;

describe('profile picture upload', () => {
  it('a member uploads their own picture; it is re-encoded to a 512×512 WebP and shown to everyone', async () => {
    const before = await avatarOf(c[3], 2);
    const r = await c[2].put('/api/members/me/photo', { image: await png(1200, 800) });
    expect(r.status).toBe(200);
    expect(r.body.member.avatarUrl).toMatch(/^\/api\/members\/2\/photo\?v=\d+$/);
    expect(await avatarOf(c[3], 2)).toBe(r.body.member.avatarUrl);
    expect(r.body.member.avatarUrl).not.toBe(before);
    // Public (the login screen shows it) and long-cached.
    const img = await anon().get(r.body.member.avatarUrl);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/webp');
    expect(img.headers.get('cache-control')).toContain('immutable');
    const meta = await sharp(Buffer.from(img.text, 'binary')).metadata().catch(() => null);
    const [row] = await sql('SELECT image FROM member_photos WHERE member_id = 2');
    const m = await sharp(row.image).metadata();
    expect([m.format, m.width, m.height, m.exif]).toEqual(['webp', 512, 512, undefined]);
    expect(meta === null || meta.format === 'webp').toBe(true);
    expect((await anon().get('/api/auth/members')).body.members[1].avatarUrl).toBe(r.body.member.avatarUrl);
  });

  it('changing again replaces (one row per member) and broadcasts member:updated', async () => {
    const sock = await connectSocket(c[5]);
    const ev = waitForEvent(sock, 'member:updated', 3000);
    await c[4].put('/api/members/me/photo', { image: await png(300, 300) });
    expect(await ev).toEqual({ memberId: 4 });
    await c[4].put('/api/members/me/photo', { image: await png(300, 300, { r: 10, g: 200, b: 90 }) });
    expect((await sql('SELECT count(*)::int AS n FROM member_photos'))[0].n).toBe(1);
  });

  it('removing returns to the default picture', async () => {
    const def = await avatarOf(c[1], 6);
    await c[6].put('/api/members/me/photo', { image: await png(200, 200) });
    const r = await c[6].del('/api/members/me/photo');
    expect(r.body.member.avatarUrl).toBe(def);
  });

  it('validates type, size and dimensions', async () => {
    const fakePng = `data:image/png;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}`;
    expectError(await c[2].put('/api/members/me/photo', { image: fakePng }), 422, 'image_invalid');
    expectError(await c[2].put('/api/members/me/photo', { image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }), 422);
    expectError(await c[2].put('/api/members/me/photo', {}), 422);
    // Just over the 2 MB image limit but under the 3 MB request limit → the image check answers.
    const noise = await sharp(Buffer.from(Array.from({ length: 860 * 860 * 3 }, () => Math.floor(Math.random() * 256))), {
      raw: { width: 860, height: 860, channels: 3 },
    }).png().toBuffer();
    expect(noise.length).toBeGreaterThan(2 * 1024 * 1024);
    expectError(await c[2].put('/api/members/me/photo', { image: `data:image/png;base64,${noise.toString('base64')}` }), 422, 'image_too_large');
    // Decompression bomb: tiny file, 100 megapixels.
    expectError(await c[2].put('/api/members/me/photo', { image: await png(10000, 10000) }), 422, 'image_invalid');
    expectError(await anon().put('/api/members/me/photo', { image: await png(10, 10) }), 401);
  });

  it('members cannot change anyone else’s picture; Rohit can manage all of them', async () => {
    const img = await png(256, 256);
    expectError(await c[2].put('/api/admin/members/3/photo', { image: img }), 403);
    expectError(await c[2].del('/api/admin/members/3/photo'), 403);
    expect((await c[2].put('/api/members/me/photo', { image: img, memberId: 3 })).body.member.id).toBe(2);
    expect((await sql('SELECT member_id FROM member_photos')).map((r) => r.member_id)).toEqual([2]);
    expect((await c[1].put('/api/admin/members/3/photo', { image: img })).status).toBe(204);
    expect(await avatarOf(c[2], 3)).toMatch(/^\/api\/members\/3\/photo/);
    expect((await c[1].del('/api/admin/members/3/photo')).status).toBe(204);
    expectError(await c[1].put('/api/admin/members/9/photo', { image: img }), 404);
  });

  it('the six accounts are untouched and pictures survive a backup → restore', async () => {
    await c[5].put('/api/members/me/photo', { image: await png(256, 256) });
    const backup = (await c[1].get('/api/admin/backup')).body;
    await sql('DELETE FROM member_photos');
    expect((await c[1].post('/api/admin/restore', { backup })).status).toBe(200);
    expect(await avatarOf(c[1], 5)).toMatch(/^\/api\/members\/5\/photo/);
    expect((await sql('SELECT count(*)::int AS n FROM members'))[0].n).toBe(6);
  });
});
