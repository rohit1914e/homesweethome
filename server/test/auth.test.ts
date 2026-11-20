import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ALL_IDS,
  MEMBER_NAMES,
  anon,
  expectError,
  login,
  resetData,
  setupFile,
  sha256,
  sql,
  teardownFile,
} from './helpers.js';

beforeAll(setupFile);
afterAll(teardownFile);
beforeEach(resetData);

describe('members & login', () => {
  it('GET /api/auth/members (public) returns exactly the six, ordered by id, and nobody is called "Admin"', async () => {
    const res = await anon().get('/api/auth/members');
    expect(res.status).toBe(200);
    const members = res.body.members;
    expect(members).toHaveLength(6);
    expect(members.map((m: any) => m.id)).toEqual(ALL_IDS);
    expect(members.map((m: any) => m.name)).toEqual(MEMBER_NAMES);
    for (const m of members) {
      expect(m.name).not.toMatch(/admin/i);
      expect(typeof m.hasPin).toBe('boolean');
      expect(m).not.toHaveProperty('pinHash');
      expect(m).not.toHaveProperty('pin_hash');
    }
    expect(res.text).not.toMatch(/admin/i);
  });

  it('all six members can log in by tapping (no PIN by default)', async () => {
    for (const id of ALL_IDS) {
      const c = await login(id);
      expect(c.member.id).toBe(id);
      expect(c.member.name).toBe(MEMBER_NAMES[id - 1]);
      expect(c.member.isAdmin).toBe(id === 1);
      const me = await c.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.member.id).toBe(id);
    }
    const rows = await sql('SELECT member_id FROM sessions ORDER BY member_id');
    expect(rows.map((r) => r.member_id)).toEqual(ALL_IDS);
  });

  it('only Rohit is an administrator, and his display name is exactly "Rohit"', async () => {
    const rohit = await login(1);
    const res = await rohit.get('/api/members');
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(6);
    const admins = res.body.members.filter((m: any) => m.isAdmin);
    expect(admins.map((m: any) => m.name)).toEqual(['Rohit']);
    for (const m of res.body.members) expect(m.name).not.toMatch(/admin/i);
  });

  it('unknown member id 7 → 404 not_found, and no member or session row is created', async () => {
    const c = anon();
    const res = await c.post('/api/auth/login', { memberId: 7 });
    expectError(res, 404, 'not_found');
    expect(c.cookie).toBeNull();
    expect((await sql('SELECT count(*)::int AS n FROM members'))[0].n).toBe(6);
    expect((await sql('SELECT count(*)::int AS n FROM sessions'))[0].n).toBe(0);
  });

  it('malformed login bodies are rejected without creating a session', async () => {
    for (const body of [{}, { memberId: 'rohit' }, { memberId: 0 }, { memberId: -1 }, { memberId: 1.5 }]) {
      const res = await anon().post('/api/auth/login', body);
      expect([404, 422], `body ${JSON.stringify(body)} → ${res.status} ${res.text}`).toContain(res.status);
    }
    expect((await sql('SELECT count(*)::int AS n FROM sessions'))[0].n).toBe(0);
  });

  it('there is no registration endpoint; member count stays 6', async () => {
    const rohit = await login(1);
    const attempts = [
      await anon().post('/api/auth/register', { name: 'Eve' }),
      await anon().post('/api/auth/signup', { name: 'Eve' }),
      await anon().post('/api/members', { name: 'Eve', slug: 'eve' }),
      await rohit.post('/api/members', { name: 'Eve', slug: 'eve' }),
      await rohit.post('/api/admin/members', { name: 'Eve', slug: 'eve' }),
    ];
    for (const res of attempts) expect([401, 404, 405], res.text).toContain(res.status);
    expect((await sql('SELECT count(*)::int AS n FROM members'))[0].n).toBe(6);
    const pub = await anon().get('/api/auth/members');
    expect(pub.body.members).toHaveLength(6);
  });

  it('PATCH /api/members/me updates only the caller’s bio (≤ 280 chars)', async () => {
    const jagan = await login(2);
    const ok = await jagan.patch('/api/members/me', { bio: 'Makes the best rasam.' });
    expect(ok.status).toBe(200);
    expect(ok.body.member.id).toBe(2);
    expect(ok.body.member.bio).toBe('Makes the best rasam.');
    const tooLong = await jagan.patch('/api/members/me', { bio: 'x'.repeat(281) });
    expectError(tooLong, 422);
    const rows = await sql('SELECT id, bio FROM members ORDER BY id');
    expect(rows.find((r) => r.id === 2).bio).toBe('Makes the best rasam.');
    expect(rows.filter((r) => r.id !== 2).every((r) => r.bio === '')).toBe(true);
  });
});

describe('sessions', () => {
  // Every route the contract marks as needing a session.
  const PROTECTED: Array<[string, string, unknown?]> = [
    ['GET', '/api/auth/me'],
    ['GET', '/api/meta'],
    ['GET', '/api/members'],
    ['PATCH', '/api/members/me', { bio: 'x' }],
    ['PUT', '/api/members/me/pin', { newPin: '1234' }],
    ['DELETE', '/api/admin/members/2/pin'],
    ['POST', '/api/admin/members/2/sign-out'],
    ['GET', '/api/admin/backup'],
    ['POST', '/api/admin/restore', { backup: {} }],
    ['GET', '/api/notifications'],
    ['POST', '/api/notifications/read', {}],
    ['GET', '/api/cooking/today'],
    ['GET', '/api/cooking/menus'],
    ['GET', '/api/cooking/menus/1'],
    ['GET', '/api/cooking/menus/1/image'],
    ['POST', '/api/cooking/menus', { title: 'x', menuDate: '2026-01-01' }],
    ['PATCH', '/api/cooking/menus/1', { title: 'x' }],
    ['DELETE', '/api/cooking/menus/1'],
    ['POST', '/api/cooking/menus/1/close'],
    ['POST', '/api/cooking/menus/1/reopen'],
    ['PUT', '/api/cooking/menus/1/vote', { choice: 'want' }],
    ['GET', '/api/washing/bookings'],
    ['GET', '/api/washing/history'],
    ['POST', '/api/washing/bookings', { date: '2026-01-01' }],
    ['DELETE', '/api/washing/bookings/1'],
    ['GET', '/api/chat/messages'],
    ['POST', '/api/chat/messages', { body: 'hi', clientId: '9f1c1d8e-8a4b-4c8e-9a52-0d3c2b1a0f11' }],
    ['POST', '/api/chat/read', { lastMessageId: 1 }],
  ];

  it.each(PROTECTED)('%s %s without a cookie → 401', async (method, path, body) => {
    const res = await anon().req(method, path, body);
    expectError(res, 401);
  });

  it('a garbage or tampered cookie → 401 on every protected GET', async () => {
    const real = await login(3);
    const token = real.token!;
    const flipped = (token[0] === 'a' ? 'b' : 'a') + token.slice(1);
    const cookies = [
      'hsh_session=garbage',
      'hsh_session=',
      `hsh_session=${flipped}`,
      `hsh_session=${token}x`,
      `hsh_session=${encodeURIComponent("' OR '1'='1")}`,
    ];
    for (const cookie of cookies) {
      for (const [method, path] of PROTECTED.filter(([m]) => m === 'GET')) {
        const res = await anon().req(method, path, undefined, { cookie });
        expect(res.status, `${cookie} ${method} ${path} → ${res.status}`).toBe(401);
      }
    }
    // the genuine cookie still works
    expect((await real.get('/api/auth/me')).status).toBe(200);
  });

  it('the database stores only sha256(token), never the token itself', async () => {
    const c = await login(4);
    const token = c.token!;
    expect(token.length).toBeGreaterThanOrEqual(32);
    const rows = await sql<{ token_hash: Buffer; member_id: number; expires_at: Date }>(
      'SELECT token_hash, member_id, expires_at FROM sessions',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].member_id).toBe(4);
    expect(rows[0].token_hash.toString('utf8')).not.toContain(token);
    expect(rows[0].token_hash.equals(sha256(token))).toBe(true);
    const days = (rows[0].expires_at.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });

  it('CSRF: a mutation without X-HSH-Client → 403 csrf (and nothing happens)', async () => {
    const jagan = await login(2);
    const res = await jagan.patch('/api/members/me', { bio: 'csrf attempt' }, { csrf: false });
    expectError(res, 403, 'csrf');
    const chat = await jagan.post(
      '/api/chat/messages',
      { body: 'csrf attempt', clientId: '4d6f1c38-3a59-4c62-9d0c-6f7f2c1b5a10' },
      { csrf: false },
    );
    expectError(chat, 403, 'csrf');
    const login403 = await anon().post('/api/auth/login', { memberId: 2 }, { csrf: false });
    expectError(login403, 403, 'csrf');
    expect((await sql(`SELECT bio FROM members WHERE id = 2`))[0].bio).toBe('');
    expect((await sql('SELECT count(*)::int AS n FROM chat_messages'))[0].n).toBe(0);
    // wrong header value is not accepted either
    const wrong = await jagan.patch('/api/members/me', { bio: 'x' }, { csrf: false, headers: { 'X-HSH-Client': '0' } });
    expect(wrong.status).toBe(403);
  });

  it('logout → 204, clears the cookie, deletes the session; the old cookie is then rejected', async () => {
    const c = await login(5);
    const oldCookie = c.cookie!;
    const res = await c.post('/api/auth/logout');
    expect(res.status).toBe(204);
    const cleared = res.setCookies.find((s) => s.startsWith('hsh_session='));
    expect(cleared, 'logout should send a clearing Set-Cookie').toBeTruthy();
    expect((await sql('SELECT count(*)::int AS n FROM sessions WHERE member_id = 5'))[0].n).toBe(0);
    const after = await anon().get('/api/auth/me', { cookie: oldCookie });
    expectError(after, 401);
  });

  it('logging out one device leaves the member’s other sessions alone', async () => {
    const a = await login(6);
    const b = await login(6);
    expect((await a.post('/api/auth/logout')).status).toBe(204);
    expect((await b.get('/api/auth/me')).status).toBe(200);
  });
});

describe('admin routes (Rohit only)', () => {
  const ADMIN: Array<[string, string, unknown?]> = [
    ['DELETE', '/api/admin/members/3/pin'],
    ['POST', '/api/admin/members/3/sign-out'],
    ['GET', '/api/admin/backup'],
    ['POST', '/api/admin/restore', { backup: { app: 'homesweethome', version: 1, tables: {} } }],
  ];

  it('every other member gets 403 forbidden on every admin route', async () => {
    for (const id of [2, 3, 4, 5, 6]) {
      const c = await login(id);
      for (const [method, path, body] of ADMIN) {
        const res = await c.req(method, path, body);
        expect(res.status, `member ${id} ${method} ${path} → ${res.status} ${res.text}`).toBe(403);
        expect(res.body?.error?.code).toBe('forbidden');
      }
    }
    // the non-admin calls had no effect: Bharath still signed in
    const bharath = await login(3);
    expect((await bharath.get('/api/auth/me')).status).toBe(200);
  });

  it('Rohit can reset a PIN (204) and the member can then log in without it', async () => {
    const bharath = await login(3);
    expect((await bharath.put('/api/members/me/pin', { newPin: '4321' })).status).toBe(204);
    expectError(await anon().post('/api/auth/login', { memberId: 3 }), 401, 'pin_required');
    const rohit = await login(1);
    expect((await rohit.del('/api/admin/members/3/pin')).status).toBe(204);
    expect((await sql('SELECT pin_hash FROM members WHERE id = 3'))[0].pin_hash).toBeNull();
    await login(3);
  });

  it('Rohit can sign a member out everywhere (204); their cookies stop working', async () => {
    const s1 = await login(4);
    const s2 = await login(4);
    const rohit = await login(1);
    expect((await rohit.post('/api/admin/members/4/sign-out')).status).toBe(204);
    expect((await s1.get('/api/auth/me')).status).toBe(401);
    expect((await s2.get('/api/auth/me')).status).toBe(401);
    expect((await rohit.get('/api/auth/me')).status).toBe(200);
  });

  it('Rohit downloads a backup as an attachment without sessions, and restore round-trips it', async () => {
    const rohit = await login(1);
    const jagan = await login(2);
    await jagan.post('/api/chat/messages', { body: 'backup me', clientId: '0b8f7d1e-2c3a-4b5c-8d9e-0f1a2b3c4d5e' });
    const res = await rohit.get('/api/admin/backup');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition') ?? '').toMatch(
      /attachment;\s*filename="?homesweethome-backup-\d{4}-\d{2}-\d{2}\.json"?/,
    );
    const backup = res.body;
    expect(backup.app).toBe('homesweethome');
    expect(backup.version).toBe(1);
    expect(backup.tables).not.toHaveProperty('sessions');
    expect(backup.tables.members).toHaveLength(6);
    expect(res.text).not.toContain(rohit.token!);
    expect(backup.tables.chat_messages.map((m: any) => m.body)).toContain('backup me');

    await jagan.post('/api/chat/messages', { body: 'after backup', clientId: '1b8f7d1e-2c3a-4b5c-8d9e-0f1a2b3c4d5e' });
    const restore = await rohit.post('/api/admin/restore', { backup });
    expect(restore.status, restore.text).toBe(200);
    expect(restore.body.restored).toBeTypeOf('object');
    const bodies = (await sql('SELECT body FROM chat_messages ORDER BY id')).map((r) => r.body);
    expect(bodies).toEqual(['backup me']);
    expect((await sql('SELECT count(*)::int AS n FROM members'))[0].n).toBe(6);
  });
});

describe('optional PIN', () => {
  it('set PIN → login requires it (pin_required / invalid_pin / 200); changing needs the current PIN', async () => {
    const jagan = await login(2);
    expect((await jagan.put('/api/members/me/pin', { newPin: '12' })).status).toBe(422); // too short
    expect((await jagan.put('/api/members/me/pin', { newPin: 'abcd' })).status).toBe(422); // not digits
    expect((await jagan.put('/api/members/me/pin', { newPin: '123456789' })).status).toBe(422); // too long
    expect((await jagan.put('/api/members/me/pin', { newPin: '2468' })).status).toBe(204);

    const hash = (await sql('SELECT pin_hash FROM members WHERE id = 2'))[0].pin_hash as string;
    expect(hash).toMatch(/^\$2[aby]\$/); // bcrypt
    expect(hash).not.toContain('2468');

    const pub = await anon().get('/api/auth/members');
    expect(pub.body.members.find((m: any) => m.id === 2).hasPin).toBe(true);
    expect(pub.body.members.find((m: any) => m.id === 3).hasPin).toBe(false);
    expect(pub.text).not.toContain(hash);

    expectError(await anon().post('/api/auth/login', { memberId: 2 }), 401, 'pin_required');
    expectError(await anon().post('/api/auth/login', { memberId: 2, pin: '9999' }), 401, 'invalid_pin');
    const ok = await login(2, '2468');
    expect(ok.member.id).toBe(2);

    // changing the PIN requires the current one
    expectError(await ok.put('/api/members/me/pin', { newPin: '1357' }), 401, 'invalid_pin');
    expectError(await ok.put('/api/members/me/pin', { currentPin: '0000', newPin: '1357' }), 401, 'invalid_pin');
    expect((await ok.put('/api/members/me/pin', { currentPin: '2468', newPin: '1357' })).status).toBe(204);
    await login(2, '1357');
    // removing it
    expect((await ok.put('/api/members/me/pin', { currentPin: '1357', newPin: null })).status).toBe(204);
    await login(2);
  });

  it('seed + migrate are idempotent: still 6 members, Rohit’s PIN and bio preserved', async () => {
    const rohit = await login(1);
    expect((await rohit.put('/api/members/me/pin', { newPin: '8080' })).status).toBe(204);
    expect((await rohit.patch('/api/members/me', { bio: 'Keeps the house running.' })).status).toBe(200);
    const before = (await sql('SELECT pin_hash FROM members WHERE id = 1'))[0].pin_hash;

    const { migrate } = await import('../src/migrate.js');
    const { seedMembers } = await import('../src/seed.js');
    const applied = await migrate();
    expect(applied).toEqual([]); // nothing pending the second time
    await seedMembers();
    await seedMembers();

    const rows = await sql('SELECT id, name, is_admin, pin_hash, bio FROM members ORDER BY id');
    expect(rows.map((r) => r.name)).toEqual(MEMBER_NAMES);
    expect(rows.filter((r) => r.is_admin).map((r) => r.id)).toEqual([1]);
    expect(rows[0].pin_hash).toBe(before);
    expect(rows[0].bio).toBe('Keeps the house running.');
    expectError(await anon().post('/api/auth/login', { memberId: 1 }), 401, 'pin_required');
    await login(1, '8080');
  });

  it('the database itself refuses a seventh member or a second admin', async () => {
    await expect(sql(`INSERT INTO members (id, slug, name) VALUES (7, 'eve', 'Eve')`)).rejects.toThrow();
    await expect(sql(`UPDATE members SET is_admin = true WHERE id = 2`)).rejects.toThrow();
  });

  // Keep last in the file: the limiter may be per IP and would block later logins.
  it('repeated wrong PINs are rate limited → 429 rate_limited', async () => {
    const dharun = await login(6);
    expect((await dharun.put('/api/members/me/pin', { newPin: '5555' })).status).toBe(204);
    const statuses: number[] = [];
    let limited: any = null;
    for (let i = 0; i < 40; i++) {
      const res = await anon().post('/api/auth/login', { memberId: 6, pin: String(1000 + i) });
      statuses.push(res.status);
      if (res.status === 429) {
        limited = res;
        break;
      }
      expect(res.status).toBe(401);
    }
    expect(limited, `no 429 after ${statuses.length} wrong PINs: ${statuses.join(',')}`).not.toBeNull();
    expectError(limited, 429, 'rate_limited');
  });
});
