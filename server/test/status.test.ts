import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  anon,
  closeSockets,
  connectSocket,
  expectError,
  login,
  loginAll,
  resetData,
  setupFile,
  sql,
  teardownFile,
  waitForEvent,
  type Client,
} from './helpers.js';

beforeAll(setupFile);
afterAll(teardownFile);

let c: Record<number, Client>;
beforeEach(async () => {
  closeSockets();
  await resetData();
  c = await loginAll();
});

const statusOf = async (viewer: Client, id: number) =>
  (await viewer.get('/api/members')).body.members.find((m: any) => m.id === id);

describe('home / college status', () => {
  it('starts unset for everyone', async () => {
    const { members } = (await c[3].get('/api/members')).body;
    expect(members).toHaveLength(6);
    expect(members.every((m: any) => m.location === null && m.locationUpdatedAt === null)).toBe(true);
  });

  it('every member can set their own status, and everyone sees it', async () => {
    for (const id of [1, 2, 3, 4, 5, 6]) {
      const r = await c[id].put('/api/members/me/location', { location: id % 2 ? 'home' : 'college' });
      expect(r.status).toBe(200);
      expect(r.body.member).toMatchObject({ id, location: id % 2 ? 'home' : 'college' });
      expect(r.body.member.locationUpdatedAt).toBeTruthy();
    }
    const seen = (await c[4].get('/api/members')).body.members.map((m: any) => m.location);
    expect(seen).toEqual(['home', 'college', 'home', 'college', 'home', 'college']);
  });

  it('a member can only change their own status (a memberId in the body is ignored)', async () => {
    await c[2].put('/api/members/me/location', { location: 'college', memberId: 3 });
    expect((await statusOf(c[1], 2)).location).toBe('college');
    expect((await statusOf(c[1], 3)).location).toBeNull();
    // There is no route to set someone else's status — not even for Rohit.
    expect((await c[1].put('/api/members/3/location', { location: 'home' })).status).toBe(404);
    expect((await c[1].put('/api/admin/members/3/location', { location: 'home' })).status).toBe(404);
    expect((await statusOf(c[1], 3)).location).toBeNull();
  });

  it('can be changed any time', async () => {
    await c[5].put('/api/members/me/location', { location: 'home' });
    await c[5].put('/api/members/me/location', { location: 'college' });
    await c[5].put('/api/members/me/location', { location: 'home' });
    expect((await statusOf(c[2], 5)).location).toBe('home');
  });

  it('rejects invalid values and unauthenticated requests', async () => {
    expectError(await c[2].put('/api/members/me/location', { location: 'office' }), 422);
    expectError(await c[2].put('/api/members/me/location', {}), 422);
    expectError(await anon().put('/api/members/me/location', { location: 'home' }), 401);
    await expect(sql(`UPDATE members SET location = 'beach', location_updated_at = now() WHERE id = 2`)).rejects.toThrow();
  });

  it('persists after logging out and back in', async () => {
    await c[6].put('/api/members/me/location', { location: 'college' });
    await c[6].post('/api/auth/logout');
    const again = await login(6);
    expect((await again.get('/api/auth/me')).body.member.location).toBe('college');
  });

  it('is broadcast live to the other members', async () => {
    const sock = await connectSocket(c[4]);
    const ev = waitForEvent(sock, 'member:location', 3000);
    await c[2].put('/api/members/me/location', { location: 'home' });
    expect(await ev).toMatchObject({ memberId: 2, location: 'home' });
  });

  it('survives a backup → restore round trip', async () => {
    await c[3].put('/api/members/me/location', { location: 'college' });
    const backup = (await c[1].get('/api/admin/backup')).body;
    await sql(`UPDATE members SET location = NULL, location_updated_at = NULL`);
    expect((await c[1].post('/api/admin/restore', { backup })).status).toBe(200);
    expect((await statusOf(c[1], 3)).location).toBe('college');
  });
});
