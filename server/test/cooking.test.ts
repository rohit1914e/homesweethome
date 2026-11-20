import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ALL_IDS,
  TINY_PNG_BASE64,
  TINY_PNG_DATA_URL,
  addDays,
  closeSockets,
  collectEvents,
  connectSocket,
  expectError,
  login,
  loginAll,
  meta,
  resetData,
  server,
  setupFile,
  sql,
  teardownFile,
  waitForEvent,
  type Client,
} from './helpers.js';

beforeAll(setupFile);
afterAll(teardownFile);

let c: Record<number, Client>;
let today: string;

beforeEach(async () => {
  closeSockets();
  await resetData();
  c = await loginAll();
  today = (await meta(c[1])).today;
});

async function publish(input: Record<string, unknown> = {}) {
  const res = await c[1].post('/api/cooking/menus', {
    title: 'Rice + Sambar',
    description: 'With potato fry.',
    menuDate: today,
    ...input,
  });
  if (res.status !== 201) throw new Error(`publish failed: ${res.status} ${res.text}`);
  return res.body.menu;
}

const sumOk = (m: any) => {
  expect(m.tally.want + m.tally.dontWant + m.tally.pending).toBe(6);
  expect(m.tally.want + m.tally.dontWant).toBeLessThanOrEqual(6);
};

describe('publishing (Rohit only)', () => {
  it('Rohit publishes a menu → 201, it appears in /today with an empty tally', async () => {
    const menu = await publish();
    expect(menu).toMatchObject({
      title: 'Rice + Sambar',
      description: 'With potato fry.',
      menuDate: today,
      status: 'open',
      createdBy: 1,
      imageUrl: null,
      closedAt: null,
      myVote: null,
      tally: { want: 0, dontWant: 0, pending: 6 },
    });
    expect(menu.votes).toEqual([]);
    for (const id of ALL_IDS) {
      const res = await c[id].get('/api/cooking/today');
      expect(res.status).toBe(200);
      expect(res.body.menus.map((m: any) => m.id)).toContain(menu.id);
    }
    const one = await c[3].get(`/api/cooking/menus/${menu.id}`);
    expect(one.status).toBe(200);
    expect(one.body.menu.id).toBe(menu.id);
  });

  it('/today lists only today’s menus, newest first', async () => {
    const a = await publish({ title: 'Breakfast dosa' });
    const b = await publish({ title: 'Dinner biryani' });
    const tomorrow = await publish({ title: 'Tomorrow idli', menuDate: addDays(today, 1) });
    const res = await c[2].get('/api/cooking/today');
    const ids = res.body.menus.map((m: any) => m.id);
    expect(ids).toEqual([b.id, a.id]);
    expect(ids).not.toContain(tomorrow.id);
  });

  it('other members get 403 on create / edit / delete / close / reopen, and nothing changes', async () => {
    const menu = await publish();
    for (const id of [2, 3, 4, 5, 6]) {
      const m = c[id];
      expectError(await m.post('/api/cooking/menus', { title: 'Sneaky', menuDate: today }), 403, 'forbidden');
      expectError(await m.patch(`/api/cooking/menus/${menu.id}`, { title: 'Hacked' }), 403, 'forbidden');
      expectError(await m.del(`/api/cooking/menus/${menu.id}`), 403, 'forbidden');
      expectError(await m.post(`/api/cooking/menus/${menu.id}/close`), 403, 'forbidden');
      expectError(await m.post(`/api/cooking/menus/${menu.id}/reopen`), 403, 'forbidden');
      // a forged createdBy is not a way around it
      expectError(
        await m.post('/api/cooking/menus', { title: 'Sneaky', menuDate: today, createdBy: 1 }),
        403,
        'forbidden',
      );
    }
    const rows = await sql('SELECT id, title, status FROM cooking_menus');
    expect(rows).toEqual([{ id: menu.id, title: 'Rice + Sambar', status: 'open' }]);
  });

  it('Rohit can edit and delete; deleted menu → 404', async () => {
    const menu = await publish();
    const edited = await c[1].patch(`/api/cooking/menus/${menu.id}`, { title: 'Curd rice', description: 'Cool.' });
    expect(edited.status).toBe(200);
    expect(edited.body.menu).toMatchObject({ id: menu.id, title: 'Curd rice', description: 'Cool.' });
    expect((await c[1].del(`/api/cooking/menus/${menu.id}`)).status).toBe(204);
    expectError(await c[2].get(`/api/cooking/menus/${menu.id}`), 404, 'not_found');
    expectError(await c[2].put(`/api/cooking/menus/${menu.id}/vote`, { choice: 'want' }), 404, 'not_found');
  });

  it('invalid menu input → 422', async () => {
    expectError(await c[1].post('/api/cooking/menus', { title: '   ', menuDate: today }), 422);
    expectError(await c[1].post('/api/cooking/menus', { title: 'x'.repeat(121), menuDate: today }), 422);
    expectError(await c[1].post('/api/cooking/menus', { title: 'ok', menuDate: '20-11-2026' }), 422);
    expectError(await c[1].post('/api/cooking/menus', { title: 'ok' }), 422);
    expectError(await c[1].post('/api/cooking/menus', { title: 'ok', menuDate: today, description: 'd'.repeat(1001) }), 422);
    expect((await sql('SELECT count(*)::int AS n FROM cooking_menus'))[0].n).toBe(0);
  });
});

describe('voting', () => {
  it('all six vote; tally and myVote are right for each member', async () => {
    const menu = await publish();
    const choices: Record<number, 'want' | 'dont_want'> = {
      1: 'want', 2: 'want', 3: 'dont_want', 4: 'want', 5: 'dont_want', 6: 'want',
    };
    for (const id of ALL_IDS) {
      const res = await c[id].put(`/api/cooking/menus/${menu.id}/vote`, { choice: choices[id] });
      expect(res.status, res.text).toBe(200);
      expect(res.body.menu.myVote).toBe(choices[id]);
      sumOk(res.body.menu);
    }
    for (const id of ALL_IDS) {
      const res = await c[id].get(`/api/cooking/menus/${menu.id}`);
      expect(res.body.menu.tally).toEqual({ want: 4, dontWant: 2, pending: 0 });
      expect(res.body.menu.myVote).toBe(choices[id]);
      expect(res.body.menu.votes).toHaveLength(6);
      const byMember = Object.fromEntries(res.body.menu.votes.map((v: any) => [v.memberId, v.choice]));
      expect(byMember).toEqual(Object.fromEntries(ALL_IDS.map((i) => [String(i), choices[i]])));
    }
  });

  it('changing a vote updates the same row; re-voting never inflates the totals', async () => {
    const menu = await publish();
    await c[2].put(`/api/cooking/menus/${menu.id}/vote`, { choice: 'want' });
    await c[2].put(`/api/cooking/menus/${menu.id}/vote`, { choice: 'want' });
    await c[2].put(`/api/cooking/menus/${menu.id}/vote`, { choice: 'want' });
    let res = await c[2].get(`/api/cooking/menus/${menu.id}`);
    expect(res.body.menu.tally).toEqual({ want: 1, dontWant: 0, pending: 5 });

    res = await c[2].put(`/api/cooking/menus/${menu.id}/vote`, { choice: 'dont_want' });
    expect(res.body.menu.tally).toEqual({ want: 0, dontWant: 1, pending: 5 });
    expect(res.body.menu.myVote).toBe('dont_want');

    // concurrent double-tap from the same member
    await Promise.all(
      Array.from({ length: 5 }, () => c[2].put(`/api/cooking/menus/${menu.id}/vote`, { choice: 'want' })),
    );
    res = await c[2].get(`/api/cooking/menus/${menu.id}`);
    expect(res.body.menu.tally).toEqual({ want: 1, dontWant: 0, pending: 5 });
    const rows = await sql('SELECT member_id, choice FROM cooking_votes WHERE menu_id = $1', [menu.id]);
    expect(rows).toEqual([{ member_id: 2, choice: 'want' }]);
  });

  it('the voter is the session member — a forged memberId in the body is ignored', async () => {
    const menu = await publish();
    const res = await c[3].put(`/api/cooking/menus/${menu.id}/vote`, { choice: 'want', memberId: 1 });
    expect([200, 422]).toContain(res.status);
    const rows = await sql('SELECT member_id FROM cooking_votes WHERE menu_id = $1', [menu.id]);
    expect(rows.every((r) => r.member_id === 3)).toBe(true);
  });

  it('invalid choice → 422', async () => {
    const menu = await publish();
    expectError(await c[2].put(`/api/cooking/menus/${menu.id}/vote`, { choice: 'maybe' }), 422);
    expectError(await c[2].put(`/api/cooking/menus/${menu.id}/vote`, {}), 422);
  });

  it('votes persist: a fresh login sees the same vote and tally', async () => {
    const menu = await publish();
    await c[4].put(`/api/cooking/menus/${menu.id}/vote`, { choice: 'dont_want' });
    const fresh = await login(4);
    const res = await fresh.get('/api/cooking/today');
    const m = res.body.menus.find((x: any) => x.id === menu.id);
    expect(m.myVote).toBe('dont_want');
    expect(m.tally).toEqual({ want: 0, dontWant: 1, pending: 5 });
  });

  it('close → votes get 409 voting_closed; reopen → voting works again', async () => {
    const menu = await publish();
    await c[2].put(`/api/cooking/menus/${menu.id}/vote`, { choice: 'want' });
    const closed = await c[1].post(`/api/cooking/menus/${menu.id}/close`);
    expect(closed.status).toBe(200);
    expect(closed.body.menu.status).toBe('closed');
    expect(closed.body.menu.closedAt).toBeTruthy();

    expectError(await c[3].put(`/api/cooking/menus/${menu.id}/vote`, { choice: 'want' }), 409, 'voting_closed');
    expectError(await c[2].put(`/api/cooking/menus/${menu.id}/vote`, { choice: 'dont_want' }), 409, 'voting_closed');
    let res = await c[2].get(`/api/cooking/menus/${menu.id}`);
    expect(res.body.menu.tally).toEqual({ want: 1, dontWant: 0, pending: 5 });

    const reopened = await c[1].post(`/api/cooking/menus/${menu.id}/reopen`);
    expect(reopened.status).toBe(200);
    expect(reopened.body.menu.status).toBe('open');
    expect(reopened.body.menu.closedAt).toBeNull();
    res = await c[3].put(`/api/cooking/menus/${menu.id}/vote`, { choice: 'dont_want' });
    expect(res.status).toBe(200);
    expect(res.body.menu.tally).toEqual({ want: 1, dontWant: 1, pending: 4 });
  });

  it('history includes past menus with their tallies, newest first, paginated', async () => {
    // Past menus cannot be created "yesterday" through the API, so insert them directly.
    const yesterday = addDays(today, -1);
    const lastWeek = addDays(today, -7);
    const [old] = await sql(
      `INSERT INTO cooking_menus (menu_date, title, created_by, status, closed_at)
       VALUES ($1, 'Old pongal', 1, 'closed', now()) RETURNING id`,
      [lastWeek],
    );
    const [past] = await sql(
      `INSERT INTO cooking_menus (menu_date, title, created_by) VALUES ($1, 'Yesterday chapati', 1) RETURNING id`,
      [yesterday],
    );
    await sql(
      `INSERT INTO cooking_votes (menu_id, member_id, choice) VALUES ($1, 2, 'want'), ($1, 3, 'want'), ($1, 4, 'dont_want')`,
      [past.id],
    );
    const current = await publish();

    const res = await c[5].get('/api/cooking/menus');
    expect(res.status).toBe(200);
    expect(res.body.menus.map((m: any) => m.id)).toEqual([current.id, past.id, old.id]);
    const p = res.body.menus.find((m: any) => m.id === past.id);
    expect(p.menuDate).toBe(yesterday);
    expect(p.tally).toEqual({ want: 2, dontWant: 1, pending: 3 });
    expect(p.myVote).toBeNull();
    expect(res.body.nextCursor).toBeNull();

    const page1 = await c[5].get('/api/cooking/menus?limit=2');
    expect(page1.body.menus.map((m: any) => m.id)).toEqual([current.id, past.id]);
    expect(page1.body.nextCursor).not.toBeNull();
    const page2 = await c[5].get(`/api/cooking/menus?limit=2&before=${page1.body.nextCursor}`);
    expect(page2.body.menus.map((m: any) => m.id)).toEqual([old.id]);
    expect(page2.body.nextCursor).toBeNull();

    expectError(await c[5].get('/api/cooking/menus?limit=0'), 422);
    expectError(await c[5].get('/api/cooking/menus?limit=51'), 422);
  });
});

describe('real-time', () => {
  it('Surya’s socket receives menu:changed within 2 s when Jagan votes', async () => {
    const menu = await publish();
    const surya = await connectSocket(c[4]);
    const pending = waitForEvent(surya, 'menu:changed', 2000, (p: any) => p.menuId === menu.id && p.action === 'voted');
    const vote = await c[2].put(`/api/cooking/menus/${menu.id}/vote`, { choice: 'want' });
    expect(vote.status).toBe(200);
    expect(await pending).toEqual({ menuId: menu.id, action: 'voted' });
  });

  it('publish / close / reopen / delete broadcast menu:changed with the matching action', async () => {
    const jagan = await connectSocket(c[2]);
    const events = collectEvents<any>(jagan, 'menu:changed', 1500);
    const menu = await publish();
    await c[1].patch(`/api/cooking/menus/${menu.id}`, { title: 'Lemon rice' });
    await c[1].post(`/api/cooking/menus/${menu.id}/close`);
    await c[1].post(`/api/cooking/menus/${menu.id}/reopen`);
    await c[1].del(`/api/cooking/menus/${menu.id}`);
    const got = await events;
    expect(got.map((e) => e.action)).toEqual(['created', 'updated', 'closed', 'reopened', 'deleted']);
    expect(got.every((e) => e.menuId === menu.id)).toBe(true);
  });
});

describe('images', () => {
  it('a valid tiny PNG data URL is accepted and served back as image/png', async () => {
    const menu = await publish({ image: TINY_PNG_DATA_URL });
    expect(menu.imageUrl).toMatch(new RegExp(`^/api/cooking/menus/${menu.id}/image\\?v=\\d+`));
    const res = await fetch(server().url + menu.imageUrl, { headers: { Cookie: c[3].cookie! } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^image\/png/);
    expect(res.headers.get('cache-control') ?? '').toMatch(/private/);
    expect(res.headers.get('cache-control') ?? '').toMatch(/max-age=86400/);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.equals(Buffer.from(TINY_PNG_BASE64, 'base64'))).toBe(true);

    // image route needs a session
    const anonRes = await fetch(server().url + menu.imageUrl);
    expect(anonRes.status).toBe(401);
  });

  it('PATCH image: null removes it, omitted keeps it', async () => {
    const menu = await publish({ image: TINY_PNG_DATA_URL });
    const kept = await c[1].patch(`/api/cooking/menus/${menu.id}`, { title: 'Still pictured' });
    expect(kept.body.menu.imageUrl).toBeTruthy();
    const removed = await c[1].patch(`/api/cooking/menus/${menu.id}`, { image: null });
    expect(removed.status).toBe(200);
    expect(removed.body.menu.imageUrl).toBeNull();
    const res = await c[1].get(`/api/cooking/menus/${menu.id}/image`);
    expect(res.status).toBe(404);
  });

  it('a text file disguised as an image/png data URL → 422 (magic bytes checked)', async () => {
    const fake = 'data:image/png;base64,' + Buffer.from('this is definitely not a png file').toString('base64');
    expectError(await c[1].post('/api/cooking/menus', { title: 'Fake', menuDate: today, image: fake }), 422, 'image_invalid');
    // HTML / SVG payloads are never accepted as images
    const html = 'data:image/png;base64,' + Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
    expectError(await c[1].post('/api/cooking/menus', { title: 'Fake', menuDate: today, image: html }), 422);
    const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
    expectError(await c[1].post('/api/cooking/menus', { title: 'Fake', menuDate: today, image: svg }), 422);
    expect((await sql('SELECT count(*)::int AS n FROM cooking_menus'))[0].n).toBe(0);
  });

  it('an image over 2 MB decoded → 422 image_too_large', async () => {
    const png = Buffer.from(TINY_PNG_BASE64, 'base64');
    const big = Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024 + 50_000 - png.length, 0)]);
    const url = 'data:image/png;base64,' + big.toString('base64');
    expect(url.length).toBeLessThan(3 * 1024 * 1024 - 1000); // still under the 3 MB body limit
    expectError(await c[1].post('/api/cooking/menus', { title: 'Huge', menuDate: today, image: url }), 422, 'image_too_large');
  });
});

describe('notifications', () => {
  it('publishing notifies everyone except Rohit', async () => {
    await publish();
    for (const id of [2, 3, 4, 5, 6]) {
      const res = await c[id].get('/api/notifications');
      expect(res.body.notifications.map((n: any) => n.kind)).toContain('menu_published');
    }
    const mine = await c[1].get('/api/notifications');
    expect(mine.body.notifications.map((n: any) => n.kind)).not.toContain('menu_published');
  });

  it('Rohit voting creates no vote_cast notification for himself (or anyone)', async () => {
    const menu = await publish();
    expect((await c[1].put(`/api/cooking/menus/${menu.id}/vote`, { choice: 'want' })).status).toBe(200);
    const rows = await sql(`SELECT member_id FROM notifications WHERE kind = 'vote_cast'`);
    expect(rows).toEqual([]);
  });

  it('votes coalesce into ONE unread vote_cast row for Rohit, with a count', async () => {
    const menu = await publish();
    const rohitSocket = await connectSocket(c[1]);
    const live = waitForEvent<any>(rohitSocket, 'notification:new', 2000, (n) => n.kind === 'vote_cast');
    await c[2].put(`/api/cooking/menus/${menu.id}/vote`, { choice: 'want' });
    expect((await live).kind).toBe('vote_cast');
    await c[3].put(`/api/cooking/menus/${menu.id}/vote`, { choice: 'dont_want' });
    await c[4].put(`/api/cooking/menus/${menu.id}/vote`, { choice: 'want' });

    const res = await c[1].get('/api/notifications');
    const voteRows = res.body.notifications.filter((n: any) => n.kind === 'vote_cast' && n.readAt === null);
    expect(voteRows).toHaveLength(1);
    expect(voteRows[0].count).toBe(3);
    expect(voteRows[0].title + ' ' + voteRows[0].body).toContain('Rice + Sambar');

    const others = await sql(`SELECT member_id FROM notifications WHERE kind = 'vote_cast' AND member_id <> 1`);
    expect(others).toEqual([]);

    // after reading, the next vote starts a fresh row
    expect((await c[1].post('/api/notifications/read', {})).status).toBe(204);
    expect((await c[1].get('/api/notifications')).body.unread).toBe(0);
    await c[5].put(`/api/cooking/menus/${menu.id}/vote`, { choice: 'want' });
    const after = await c[1].get('/api/notifications');
    const unreadVote = after.body.notifications.filter((n: any) => n.kind === 'vote_cast' && n.readAt === null);
    expect(unreadVote).toHaveLength(1);
    expect(unreadVote[0].count).toBe(1);
    expect(after.body.unread).toBe(1);
  });
});
