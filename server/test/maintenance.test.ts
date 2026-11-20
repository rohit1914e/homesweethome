import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runCleanup } from '../src/maintenance.js';
import { addDays, db, expectError, loginAll, meta, resetData, setupFile, sql, teardownFile, type Client } from './helpers.js';

beforeAll(setupFile);
afterAll(teardownFile);

let c: Record<number, Client>;
let today: string;
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

beforeEach(async () => {
  await resetData();
  c = await loginAll();
  today = (await meta(c[1])).today;
});

async function seedEverything() {
  for (const [days, body] of [[10, 'very old'], [6.5, 'old'], [5, 'recent'], [0, 'now']] as const) {
    await sql(`INSERT INTO chat_messages (member_id, body, created_at) VALUES (2, $1, $2)`, [body, ago(days)]);
    await sql(`INSERT INTO notifications (member_id, kind, title, created_at) VALUES (3, 'chat_message', $1, $2)`, [body, ago(days)]);
  }
  await sql(`INSERT INTO sessions (token_hash, member_id, expires_at) VALUES ('\\x01', 4, $1), ('\\x02', 4, $2)`, [ago(1), ago(-5)]);
  const old = (await sql(`INSERT INTO cooking_menus (menu_date, title, created_by) VALUES ($1, 'Old menu', 1) RETURNING id`, [addDays(today, -3)]))[0].id;
  await sql(`INSERT INTO cooking_votes (menu_id, member_id, choice) VALUES ($1, 2, 'want')`, [old]);
  await sql(`INSERT INTO cooking_menus (menu_date, title, created_by) VALUES ($1, 'Yesterday', 1), ($2, 'Today', 1)`, [addDays(today, -1), today]);
  // Things that must survive no matter how old.
  await c[2].post('/api/washing/bookings', { date: today });
  await sql(`INSERT INTO washing_bookings (booking_date, member_id, booked_by, created_at) VALUES ($1, 3, 3, $2)`, [addDays(today, 2), ago(30)]);
  await c[1].post('/api/cleaning/tasks', { memberId: 4, date: addDays(today, -20), categories: ['floor'] });
  await sql(`UPDATE members SET bio = 'keep me' WHERE id = 5`);
  await c[1].put('/api/admin/places/home', { lat: 12.3, lng: 79.1, radiusM: 150 });
}

describe('6-day cleanup', () => {
  it('removes only disposable data and keeps accounts, bookings, duties, settings', async () => {
    await seedEverything();
    const r = await runCleanup();
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') return;
    expect(r.deleted).toEqual({ chat_messages: 2, notifications: 2, cooking_votes: 1, cooking_menus: 1, expired_sessions: 1 });
    expect((await sql('SELECT body FROM chat_messages ORDER BY id')).map((x) => x.body)).toEqual(['recent', 'now']);
    expect((await sql('SELECT title FROM cooking_menus ORDER BY id')).map((x) => x.title)).toEqual(['Yesterday', 'Today']);
    expect((await sql('SELECT count(*)::int AS n FROM members'))[0].n).toBe(6);
    expect((await sql(`SELECT bio FROM members WHERE id = 5`))[0].bio).toBe('keep me');
    expect((await sql('SELECT count(*)::int AS n FROM washing_bookings'))[0].n).toBe(2);
    expect((await sql('SELECT count(*)::int AS n FROM cleaning_tasks'))[0].n).toBe(1);
    expect((await sql('SELECT count(*)::int AS n FROM places'))[0].n).toBe(1);
    // Live sessions (incl. everyone signed in for this test) survive; only the expired one is gone.
    expect((await c[2].get('/api/auth/me')).status).toBe(200);
  });

  it('backs up exactly the removed rows first and logs the run (Rohit only)', async () => {
    await seedEverything();
    const r = await runCleanup();
    if (r.status !== 'succeeded') throw new Error('expected success');
    expectError(await c[2].get('/api/admin/maintenance'), 403);
    const log = (await c[1].get('/api/admin/maintenance')).body;
    expect(log.runs[0]).toMatchObject({ id: r.runId, status: 'succeeded', hasBackup: true, deleted: r.deleted });
    expect(new Date(log.nextDueAt).getTime() - new Date(log.runs[0].startedAt).getTime()).toBe(6 * DAY);
    const backup = (await c[1].get(`/api/admin/maintenance/${r.runId}/backup`)).body;
    expect(backup.rows.chat_messages.map((m: any) => m.body)).toEqual(['very old', 'old']);
    expect(backup.rows.cooking_menus.map((m: any) => m.title)).toEqual(['Old menu']);
    expect(backup.rows.cooking_votes).toHaveLength(1);
    expectError(await c[3].get(`/api/admin/maintenance/${r.runId}/backup`), 403);
  });

  it('runs at most once every 6 days', async () => {
    const now = new Date();
    expect((await runCleanup({ now })).status).toBe('succeeded');
    expect(await runCleanup({ now: new Date(now.getTime() + 5.9 * DAY) })).toMatchObject({ status: 'skipped', reason: 'not_due' });
    expect((await runCleanup({ now: new Date(now.getTime() + 6 * DAY + 1000) })).status).toBe('succeeded');
  });

  it('cannot run twice at the same time', async () => {
    // While another session holds the cleanup lock, a run is refused outright.
    const holder = await db().connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(74062026)');
      expect(await runCleanup({ force: true })).toEqual({ status: 'skipped', reason: 'already_running' });
      await holder.query('ROLLBACK');
    } finally {
      holder.release();
    }
    // Several scheduled checks firing together → exactly one cleanup; the rest are skipped.
    const results = await Promise.all([runCleanup(), runCleanup(), runCleanup(), runCleanup()]);
    expect(results.filter((r) => r.status === 'succeeded')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'skipped')).toHaveLength(3);
    expect((await sql(`SELECT count(*)::int AS n FROM maintenance_runs`))[0].n).toBe(1);
    // The database also refuses a second "running" row outright.
    await sql(`INSERT INTO maintenance_runs (status) VALUES ('running')`);
    await expect(sql(`INSERT INTO maintenance_runs (status) VALUES ('running')`)).rejects.toThrow(/maintenance_one_running/);
  });

  it('keeps removed-row backups for the latest 3 runs only', async () => {
    for (let i = 0; i < 5; i++) await runCleanup({ force: true });
    const rows = await sql('SELECT id, backup IS NOT NULL AS kept FROM maintenance_runs ORDER BY id');
    expect(rows.map((r) => r.kept)).toEqual([false, false, true, true, true]);
  });

  it('Rohit can trigger a cleanup now; members cannot', async () => {
    expectError(await c[2].post('/api/admin/maintenance/run'), 403);
    const r = await c[1].post('/api/admin/maintenance/run');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('succeeded');
  });
});
