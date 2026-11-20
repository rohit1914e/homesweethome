import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { statusWindowAt } from '../../shared/statusWindow.js';
import { setStatusClockForTests } from '../src/time.js';
import {
  anon,
  closeSockets,
  collectEvents,
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

// Pin the status clock: today 10:00 IST (inside the 8 AM – 3 PM window) unless a test moves it.
const HOUR = 3_600_000;
const today8 = statusWindowAt(new Date()).start.getTime();
const at = (hoursAfter8: number) => setStatusClockForTests(() => new Date(today8 + hoursAfter8 * HOUR));

// Two places ~3 km apart (Chennai-ish coordinates; only used inside the test DB).
const HOME = { lat: 13.0827, lng: 80.2707 };
const COLLEGE = { lat: 13.0827, lng: 80.2985 };

beforeAll(setupFile);
afterAll(async () => {
  setStatusClockForTests(null);
  await teardownFile();
});

let c: Record<number, Client>;
beforeEach(async () => {
  closeSockets();
  at(2);
  await resetData();
  c = await loginAll();
});

const statusOf = async (viewer: Client, id: number) =>
  (await viewer.get('/api/members')).body.members.find((m: any) => m.id === id);
const setPlaces = async () => {
  expect((await c[1].put('/api/admin/places/home', { ...HOME, radiusM: 200 })).status).toBe(200);
  expect((await c[1].put('/api/admin/places/college', { ...COLLEGE, radiusM: 300 })).status).toBe(200);
};
const reading = (who: number, body: object) => c[who].post('/api/members/me/gps/reading', body);
const enableGps = (who: number) => c[who].put('/api/members/me/gps', { enabled: true });

describe('manual status', () => {
  it('starts unset; every member sets only their own (home / college / away)', async () => {
    expect((await c[3].get('/api/members')).body.members.every((m: any) => m.location === null && !m.gpsEnabled)).toBe(true);
    const picks = ['home', 'college', 'away', 'home', 'college', 'away'];
    for (const id of [1, 2, 3, 4, 5, 6]) {
      const r = await c[id].put('/api/members/me/location', { location: picks[id - 1], memberId: 1 });
      expect(r.body.member).toMatchObject({ id, location: picks[id - 1], locationSource: 'manual' });
    }
    expect((await c[4].get('/api/members')).body.members.map((m: any) => m.location)).toEqual(picks);
    expect((await c[1].put('/api/members/3/location', { location: 'home' })).status).toBe(404);
  });

  it('rejects invalid values, unauthenticated requests and "unavailable" as a manual pick', async () => {
    expectError(await c[2].put('/api/members/me/location', { location: 'office' }), 422);
    expectError(await c[2].put('/api/members/me/location', { location: 'unavailable' }), 422);
    expectError(await anon().put('/api/members/me/location', { location: 'home' }), 401);
    await expect(sql(`UPDATE members SET location = 'beach' WHERE id = 2`)).rejects.toThrow();
  });

  it('persists after logging out and back in, and is broadcast live', async () => {
    const sock = await connectSocket(c[4]);
    const ev = waitForEvent(sock, 'member:location', 3000);
    await c[6].put('/api/members/me/location', { location: 'college' });
    expect(await ev).toMatchObject({ memberId: 6, location: 'college', source: 'manual' });
    await c[6].post('/api/auth/logout');
    expect((await (await login(6)).get('/api/auth/me')).body.member.location).toBe('college');
  });
});

describe('college-hours window (8 AM – 3 PM IST)', () => {
  it('hides every status after 3 PM and refuses updates', async () => {
    await c[2].put('/api/members/me/location', { location: 'college' });
    at(7.01); // 15:00:36
    expect((await statusOf(c[3], 2)).location).toBeNull();
    expect((await c[1].get('/api/meta')).body.statusHours).toEqual({ open: false, start: '08:00', end: '15:00' });
    expectError(await c[2].put('/api/members/me/location', { location: 'home' }), 409, 'status_closed');
  });

  it('hides yesterday’s status the next morning until it is updated again', async () => {
    await c[2].put('/api/members/me/location', { location: 'college' });
    at(24 - 1); // tomorrow 07:00 — closed
    expect((await statusOf(c[3], 2)).location).toBeNull();
    at(24 + 0.5); // tomorrow 08:30 — open, but the status is from yesterday
    expect((await statusOf(c[3], 2)).location).toBeNull();
    await c[2].put('/api/members/me/location', { location: 'home' });
    expect((await statusOf(c[3], 2)).location).toBe('home');
  });

  it('opens exactly at 8 AM and closes exactly at 3 PM', async () => {
    at(-0.001);
    expectError(await c[2].put('/api/members/me/location', { location: 'home' }), 409, 'status_closed');
    at(0);
    expect((await c[2].put('/api/members/me/location', { location: 'home' })).status).toBe(200);
    at(6.999);
    expect((await statusOf(c[3], 2)).location).toBe('home');
    at(7);
    expect((await statusOf(c[3], 2)).location).toBeNull();
  });
});

describe('places (Rohit only)', () => {
  it('only Rohit can read or change place coordinates; members only learn whether places exist', async () => {
    expectError(await c[2].get('/api/admin/places'), 403);
    expectError(await c[2].put('/api/admin/places/home', { ...HOME, radiusM: 200 }), 403);
    await setPlaces();
    const meta = (await c[2].get('/api/meta')).body;
    expect(meta.geofence).toEqual({ home: true, college: true });
    expect(JSON.stringify(meta)).not.toContain(String(HOME.lat));
    expect(JSON.stringify((await c[2].get('/api/members')).body)).not.toContain(String(HOME.lat));
    expect((await c[1].get('/api/admin/places')).body.places).toHaveLength(2);
    expectError(await c[1].put('/api/admin/places/home', { ...HOME, radiusM: 5 }), 422);
    expectError(await c[1].put('/api/admin/places/office', { ...HOME, radiusM: 200 }), 422);
  });
});

describe('GPS detection', () => {
  it('is opt-in: readings are refused until the member enables it', async () => {
    await setPlaces();
    expectError(await reading(2, { ...HOME, accuracy: 20 }), 409, 'gps_disabled');
  });

  it('inside home → At Home, inside college → At College, outside both → Away, denied → Location unavailable', async () => {
    await setPlaces();
    await enableGps(2);
    expect((await reading(2, { lat: HOME.lat + 0.001, lng: HOME.lng, accuracy: 20 })).body.member).toMatchObject({ location: 'home', locationSource: 'gps' });
    expect((await reading(2, { ...COLLEGE, accuracy: 30 })).body.member.location).toBe('college');
    expect((await reading(2, { lat: 13.2, lng: 80.5, accuracy: 30 })).body.member.location).toBe('away');
    expect((await reading(2, { error: 'denied' })).body.member.location).toBe('unavailable');
    expect((await statusOf(c[5], 2)).location).toBe('unavailable');
  });

  it('ignores inaccurate readings and readings when no place is configured', async () => {
    await enableGps(3);
    expect((await reading(3, { ...HOME, accuracy: 20 })).body).toMatchObject({ applied: false, reason: 'not_configured' });
    await setPlaces();
    await reading(3, { ...HOME, accuracy: 20 });
    const r = await reading(3, { ...COLLEGE, accuracy: 900 });
    expect(r.body).toMatchObject({ applied: false, reason: 'inaccurate' });
    expect(r.body.member.location).toBe('home');
  });

  it('a manual pick overrides GPS until the member turns GPS back on', async () => {
    await setPlaces();
    await enableGps(4);
    await reading(4, { ...HOME, accuracy: 20 });
    await c[4].put('/api/members/me/location', { location: 'away' });
    expect((await reading(4, { ...COLLEGE, accuracy: 20 })).body).toMatchObject({ applied: false, reason: 'manual_override' });
    expect((await statusOf(c[1], 4)).location).toBe('away');
    await enableGps(4); // "Use GPS again"
    expect((await reading(4, { ...COLLEGE, accuracy: 20 })).body.member).toMatchObject({ location: 'college', locationSource: 'gps' });
  });

  it('turning GPS off clears a GPS-derived status but keeps a manual one', async () => {
    await setPlaces();
    await enableGps(5);
    await reading(5, { ...HOME, accuracy: 20 });
    const off = await c[5].put('/api/members/me/gps', { enabled: false });
    expect(off.body.member).toMatchObject({ gpsEnabled: false, location: null });
    await c[5].put('/api/members/me/location', { location: 'college' });
    expect((await c[5].put('/api/members/me/gps', { enabled: false })).body.member.location).toBe('college');
  });

  it('never stores or returns coordinates, and only broadcasts real changes', async () => {
    await setPlaces();
    await enableGps(6);
    const sock = await connectSocket(c[1]);
    const events = collectEvents(sock, 'member:location', 1500);
    const r = await reading(6, { lat: 13.08291, lng: 80.27071, accuracy: 15 });
    await reading(6, { lat: 13.08292, lng: 80.27072, accuracy: 15 }); // still home → no new event
    expect(JSON.stringify(r.body)).not.toMatch(/13\.0829|80\.2707/);
    expect((await events).filter((e) => e.memberId === 6)).toHaveLength(1);
    const cols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name = 'members'`);
    expect(cols.map((x) => x.column_name).filter((n) => /lat|lng|coord/.test(n))).toEqual([]);
    const dump = JSON.stringify(await sql('SELECT * FROM members'));
    expect(dump).not.toMatch(/13\.0829|80\.2707/);
  });

  it('readings outside college hours are refused', async () => {
    await setPlaces();
    await enableGps(2);
    at(8);
    expectError(await reading(2, { ...HOME, accuracy: 20 }), 409, 'status_closed');
  });

  it('status, GPS opt-in and places survive a backup → restore round trip', async () => {
    await setPlaces();
    await enableGps(3);
    await reading(3, { ...COLLEGE, accuracy: 20 });
    const backup = (await c[1].get('/api/admin/backup')).body;
    await sql(`UPDATE members SET location = NULL, location_updated_at = NULL, location_source = NULL, gps_enabled = false`);
    await sql('DELETE FROM places');
    expect((await c[1].post('/api/admin/restore', { backup })).status).toBe(200);
    expect(await statusOf(c[1], 3)).toMatchObject({ location: 'college', gpsEnabled: true, locationSource: 'gps' });
    expect((await c[1].get('/api/admin/places')).body.places).toHaveLength(2);
  });
});

describe('initial places from env', () => {
  it('seeds a place once from "lat,lng,radius" and never overwrites Rohit’s edits', async () => {
    const { seedPlaces, parsePlaceEnv } = await import('../src/seed.js');
    expect(parsePlaceEnv('12.3456789, 79.1234567, 150')).toEqual({ lat: 12.3456789, lng: 79.1234567, radiusM: 150 });
    expect(parsePlaceEnv('13.02,80.02')).toEqual({ lat: 13.02, lng: 80.02, radiusM: 150 });
    expect(parsePlaceEnv('nonsense')).toBeNull();
    expect(parsePlaceEnv('95,80,150')).toBeNull();
    await seedPlaces(undefined, { HOME_PLACE: '12.3456789,79.1234567,150' });
    let places = (await c[1].get('/api/admin/places')).body.places;
    expect(places).toEqual([expect.objectContaining({ kind: 'home', lat: 12.3456789, lng: 79.1234567, radiusM: 150 })]);
    await c[1].put('/api/admin/places/home', { lat: 12.3456789, lng: 79.1234567, radiusM: 250 });
    await seedPlaces(undefined, { HOME_PLACE: '12.3456789,79.1234567,150' });
    places = (await c[1].get('/api/admin/places')).body.places;
    expect(places[0].radiusM).toBe(250);
  });
});
