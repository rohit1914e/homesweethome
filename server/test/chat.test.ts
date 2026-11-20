import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  startTestServer,
  stopTestServer,
  teardownFile,
  waitForEvent,
  Client,
} from './helpers.js';

beforeAll(setupFile);
afterAll(teardownFile);

let c: Record<number, Client>;

beforeEach(async () => {
  closeSockets();
  await resetData();
  c = await loginAll();
});

const send = (who: number, body: string, clientId: string = randomUUID(), extra: Record<string, unknown> = {}) =>
  c[who].post('/api/chat/messages', { body, clientId, ...extra });

describe('sending', () => {
  it('send → 201 with the stored message; sender = the session member', async () => {
    const clientId = randomUUID();
    const res = await send(2, 'Who took my curd?', clientId);
    expect(res.status, res.text).toBe(201);
    expect(res.body.message).toMatchObject({ memberId: 2, body: 'Who took my curd?', clientId });
    expect(typeof res.body.message.id).toBe('number');
    expect(Number.isNaN(Date.parse(res.body.message.createdAt))).toBe(false);
  });

  it('a forged memberId / sender in the body is ignored — the stored sender is the authenticated member', async () => {
    const res = await send(2, 'I am totally Rohit', randomUUID(), { memberId: 1, sender: 1, member_id: 1, senderId: 1 });
    expect([201, 422], res.text).toContain(res.status);
    if (res.status === 201) expect(res.body.message.memberId).toBe(2);
    const rows = await sql('SELECT member_id FROM chat_messages');
    expect(rows.every((r) => r.member_id === 2)).toBe(true);
  });

  it('message body is trimmed for validation: empty / whitespace / 2001 chars → 422; 2000 chars → 201', async () => {
    expectError(await send(3, ''), 422);
    expectError(await send(3, '   \n\t  '), 422);
    expectError(await send(3, 'x'.repeat(2001)), 422);
    expectError(await c[3].post('/api/chat/messages', { clientId: randomUUID() }), 422);
    expectError(await c[3].post('/api/chat/messages', { body: 42, clientId: randomUUID() }), 422);
    expect((await sql('SELECT count(*)::int AS n FROM chat_messages'))[0].n).toBe(0);
    const ok = await send(3, 'y'.repeat(2000));
    expect(ok.status).toBe(201);
    expect(ok.body.message.body).toHaveLength(2000);
  });

  it('clientId must be a uuid', async () => {
    expectError(await send(3, 'hello', 'not-a-uuid'), 422);
  });

  it('idempotent retry: same clientId returns the same message (200) and stores one row', async () => {
    const clientId = randomUUID();
    const first = await send(4, 'Gas cylinder is here', clientId);
    expect(first.status).toBe(201);
    const retry = await send(4, 'Gas cylinder is here', clientId);
    expect(retry.status).toBe(200);
    expect(retry.body.message.id).toBe(first.body.message.id);
    // concurrent retries (flaky network double-send)
    const id2 = randomUUID();
    const burst = await Promise.all([send(4, 'twice', id2), send(4, 'twice', id2), send(4, 'twice', id2)]);
    expect(burst.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(burst.map((r) => r.body.message.id)).size).toBe(1);
    expect((await sql('SELECT count(*)::int AS n FROM chat_messages'))[0].n).toBe(2);
    // the same clientId from a different member is a different message
    const other = await send(5, 'Gas cylinder is here', clientId);
    expect(other.status).toBe(201);
    expect(other.body.message.id).not.toBe(first.body.message.id);
  });

  it('unauthenticated GET / POST → 401', async () => {
    expectError(await anon().get('/api/chat/messages'), 401);
    expectError(await anon().post('/api/chat/messages', { body: 'hi', clientId: randomUUID() }), 401);
    expect((await sql('SELECT count(*)::int AS n FROM chat_messages'))[0].n).toBe(0);
  });

  it('sending faster than ~20 messages / 10 s is rate limited (429)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) {
      const res = await send(6, `spam ${i}`);
      statuses.push(res.status);
      if (res.status === 429) break;
    }
    expect(statuses).toContain(429);
    expect(statuses.filter((s) => s === 201).length).toBeGreaterThanOrEqual(15);
  });
});

describe('history', () => {
  it('history is ascending by id and persists across a refetch and a fresh login', async () => {
    const ids: number[] = [];
    for (const [who, body] of [[2, 'one'], [3, 'two'], [4, 'three']] as const) {
      ids.push((await send(who, body)).body.message.id);
    }
    const res = await c[5].get('/api/chat/messages');
    expect(res.status).toBe(200);
    expect(res.body.messages.map((m: any) => m.id)).toEqual(ids);
    expect(res.body.messages.map((m: any) => [m.memberId, m.body])).toEqual([[2, 'one'], [3, 'two'], [4, 'three']]);
    expect(res.body.hasMore).toBe(false);
    const fresh = await login(6);
    expect((await fresh.get('/api/chat/messages')).body.messages.map((m: any) => m.id)).toEqual(ids);
  });

  it('pagination with before: latest page first, then older pages, each ascending', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 7; i++) ids.push((await send((i % 4) + 2, `m${i}`)).body.message.id);
    const p1 = await c[1].get('/api/chat/messages?limit=3');
    expect(p1.body.messages.map((m: any) => m.id)).toEqual(ids.slice(4, 7));
    expect(p1.body.hasMore).toBe(true);
    const p2 = await c[1].get(`/api/chat/messages?limit=3&before=${p1.body.messages[0].id}`);
    expect(p2.body.messages.map((m: any) => m.id)).toEqual(ids.slice(1, 4));
    expect(p2.body.hasMore).toBe(true);
    const p3 = await c[1].get(`/api/chat/messages?limit=3&before=${p2.body.messages[0].id}`);
    expect(p3.body.messages.map((m: any) => m.id)).toEqual(ids.slice(0, 1));
    expect(p3.body.hasMore).toBe(false);
    expectError(await c[1].get('/api/chat/messages?limit=0'), 422);
    expectError(await c[1].get('/api/chat/messages?limit=101'), 422);
  });

  it('history survives closing and restarting the server', async () => {
    const id = (await send(2, 'still here after restart?')).body.message.id;
    closeSockets();
    await stopTestServer();
    await startTestServer();
    // sessions live in the DB, so the pre-restart cookie still works against the new server
    const old = new Client();
    old.cookie = c[2].cookie;
    expect((await old.get('/api/auth/me')).status).toBe(200);
    const jagan = await login(2);
    const res = await jagan.get('/api/chat/messages');
    expect(res.status).toBe(200);
    expect(res.body.messages.map((m: any) => m.id)).toContain(id);
    expect(res.body.messages.find((m: any) => m.id === id).body).toBe('still here after restart?');
  });
});

describe('real-time', () => {
  it('a message is delivered live to another member’s socket with the right memberId', async () => {
    const surya = await connectSocket(c[4]);
    const got = waitForEvent<any>(surya, 'chat:message', 2000, (m) => m.body === 'dinner at 9');
    const sent = await send(2, 'dinner at 9');
    const m = await got;
    expect(m).toMatchObject({ id: sent.body.message.id, memberId: 2, body: 'dinner at 9' });
  });

  it('an idempotent retry is not broadcast twice', async () => {
    const surya = await connectSocket(c[4]);
    const events = collectEvents<any>(surya, 'chat:message', 1200);
    const clientId = randomUUID();
    await send(2, 'once', clientId);
    await send(2, 'once', clientId);
    expect((await events).filter((m) => m.body === 'once')).toHaveLength(1);
  });

  it('an unauthenticated socket connection is rejected (connect_error)', async () => {
    await expect(connectSocket(null)).rejects.toThrow(/unauthorized/i);
    await expect(connectSocket(null, { cookie: 'hsh_session=garbage' })).rejects.toThrow(/unauthorized/i);
    const loggedOut = await login(3);
    const cookie = loggedOut.cookie!;
    await loggedOut.post('/api/auth/logout');
    await expect(connectSocket(null, { cookie })).rejects.toThrow(/unauthorized/i);
  });

  it('typing is relayed to the others but not echoed to the sender', async () => {
    const jagan = await connectSocket(c[2]);
    const surya = await connectSocket(c[4]);
    const rohit = await connectSocket(c[1]);
    const ownEcho = collectEvents<any>(jagan, 'chat:typing', 1000);
    const atSurya = waitForEvent<any>(surya, 'chat:typing', 2000, (p) => p.typing === true);
    const atRohit = waitForEvent<any>(rohit, 'chat:typing', 2000, (p) => p.typing === true);
    jagan.emit('chat:typing', { typing: true });
    expect(await atSurya).toEqual({ memberId: 2, typing: true });
    expect(await atRohit).toEqual({ memberId: 2, typing: true });
    expect((await ownEcho).filter((p) => p.memberId === 2)).toEqual([]);
  });

  it('typing auto-clears after ~5 s if the typer goes quiet', async () => {
    const jagan = await connectSocket(c[2]);
    const surya = await connectSocket(c[4]);
    const started = waitForEvent<any>(surya, 'chat:typing', 2000, (p) => p.memberId === 2 && p.typing);
    jagan.emit('chat:typing', { typing: true });
    await started;
    const cleared = await waitForEvent<any>(surya, 'chat:typing', 8000, (p) => p.memberId === 2 && !p.typing);
    expect(cleared).toEqual({ memberId: 2, typing: false });
  }, 15_000);

  it('a socket can not spoof another member in a typing event', async () => {
    const jagan = await connectSocket(c[2]);
    const surya = await connectSocket(c[4]);
    const got = waitForEvent<any>(surya, 'chat:typing', 2000);
    (jagan as any).emit('chat:typing', { typing: true, memberId: 1 });
    expect((await got).memberId).toBe(2);
  });
});

describe('notifications', () => {
  it('chat notifications coalesce into one unread chat_message row per recipient; /read clears it', async () => {
    const ids: number[] = [];
    for (const body of ['a', 'b', 'c']) ids.push((await send(2, body)).body.message.id);

    for (const id of [1, 3, 4, 5, 6]) {
      const res = await c[id].get('/api/notifications');
      const rows = res.body.notifications.filter((n: any) => n.kind === 'chat_message' && n.readAt === null);
      expect(rows, `member ${id}`).toHaveLength(1);
      expect(rows[0].count).toBe(3);
    }
    const sender = await c[2].get('/api/notifications');
    expect(sender.body.notifications.filter((n: any) => n.kind === 'chat_message')).toEqual([]);
    const dbRows = await sql(`SELECT member_id FROM notifications WHERE kind = 'chat_message' ORDER BY member_id`);
    expect(dbRows.map((r) => r.member_id)).toEqual([1, 3, 4, 5, 6]);

    expect((await c[4].post('/api/chat/read', { lastMessageId: ids[2] })).status).toBe(204);
    const after = await c[4].get('/api/notifications');
    expect(after.body.notifications.filter((n: any) => n.kind === 'chat_message' && n.readAt === null)).toEqual([]);
    expect(after.body.unread).toBe(0);
    const [read] = await sql('SELECT last_read_message_id FROM chat_reads WHERE member_id = 4');
    expect(Number(read.last_read_message_id)).toBe(ids[2]);
    // others still have theirs
    const bharath = await c[3].get('/api/notifications');
    expect(bharath.body.unread).toBeGreaterThanOrEqual(1);

    // a new message after reading starts a fresh row with count 1
    await send(2, 'd');
    const again = await c[4].get('/api/notifications');
    const fresh = again.body.notifications.filter((n: any) => n.kind === 'chat_message' && n.readAt === null);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].count).toBe(1);
  });

  it('notification:new is pushed live to the recipient', async () => {
    const surya = await connectSocket(c[4]);
    const got = waitForEvent<any>(surya, 'notification:new', 2000, (n) => n.kind === 'chat_message');
    await send(3, 'ping');
    const n = await got;
    expect(n.kind).toBe('chat_message');
    expect(n.readAt).toBeNull();
  });

  it('POST /api/chat/read validates its body', async () => {
    expectError(await c[4].post('/api/chat/read', {}), 422);
    expectError(await c[4].post('/api/chat/read', { lastMessageId: 'x' }), 422);
  });
});
