// 6-day maintenance cleanup. Removes ONLY disposable data:
//   - chat messages older than 6 days
//   - notifications older than 6 days
//   - expired sign-in sessions
//   - cooking menus (+ their votes) older than yesterday (the existing 2-day rule)
// It never touches members, PINs, bios, profile pictures, status, places, washing bookings,
// cleaning duties or anything else a feature still uses. Before deleting, the exact rows are
// copied into maintenance_runs.backup (kept for the latest 3 runs) and the counts are logged.
// Uploaded pictures are one-row-per-member (replacing overwrites) and nothing is written to disk,
// so there are no orphaned uploads or temporary files to sweep.
import type pg from 'pg';
import type { MaintenanceRun } from '../../shared/types.js';
import { pool } from './db.js';

export const CLEANUP_EVERY_MS = 6 * 24 * 3_600_000;
export const CHAT_RETENTION_MS = 6 * 24 * 3_600_000;
const LOCK_KEY = 74_062_026; // pg advisory lock id for "cleanup"
const KEEP_BACKUPS = 3;

export type CleanupResult =
  | { status: 'skipped'; reason: 'already_running' | 'not_due'; nextDueAt?: string }
  | { status: 'succeeded'; runId: number; deleted: Record<string, number> }
  | { status: 'failed'; runId: number | null; error: string };

const ist = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(d);

/** Rows to remove, as backup-able JSON. Images are left out of the backup (menus are disposable after 2 days). */
const TARGETS: { table: string; backup: string; remove?: string; backedUp: boolean }[] = [
  {
    table: 'chat_messages',
    backup: `SELECT id, member_id, body, client_id, created_at FROM chat_messages WHERE created_at < $1 ORDER BY id`,
    remove: `DELETE FROM chat_messages WHERE created_at < $1`,
    backedUp: true,
  },
  {
    table: 'notifications',
    backup: `SELECT id, member_id, kind, title, body, link, actor_id, count, created_at, read_at FROM notifications WHERE created_at < $1 ORDER BY id`,
    remove: `DELETE FROM notifications WHERE created_at < $1`,
    backedUp: true,
  },
  {
    table: 'cooking_votes',
    backup: `SELECT v.* FROM cooking_votes v JOIN cooking_menus m ON m.id = v.menu_id WHERE m.menu_date < room_today() - 1`,
    // no own DELETE: votes go with their menu (ON DELETE CASCADE) in the next step
    backedUp: true,
  },
  {
    table: 'cooking_menus',
    backup: `SELECT id, menu_date, title, description, status, created_by, created_at, updated_at, closed_at
             FROM cooking_menus WHERE menu_date < room_today() - 1 ORDER BY id`,
    remove: `DELETE FROM cooking_menus WHERE menu_date < room_today() - 1`,
    backedUp: true,
  },
  {
    table: 'expired_sessions', // not backed up: they are dead credentials
    backup: `SELECT count(*)::int AS n FROM sessions WHERE expires_at < $1`,
    remove: `DELETE FROM sessions WHERE expires_at < $1`,
    backedUp: false,
  },
];

export async function lastSuccessfulRun(db: pg.Pool | pg.PoolClient = pool): Promise<Date | null> {
  const { rows } = await db.query<{ at: Date | null }>(
    `SELECT max(started_at) AS at FROM maintenance_runs WHERE status = 'succeeded'`,
  );
  return rows[0].at;
}

/**
 * Runs the cleanup if 6 days have passed since the last successful run (or `force`).
 * Safe to call from several places at once: a transaction-level advisory lock lets exactly one
 * caller proceed; the others return { status: 'skipped', reason: 'already_running' }.
 */
export async function runCleanup(opts: { now?: Date; force?: boolean } = {}): Promise<CleanupResult> {
  const now = opts.now ?? new Date();
  const client = await pool.connect();
  let runId: number | null = null;
  try {
    await client.query('BEGIN');
    const { rows: lock } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS ok', [LOCK_KEY]);
    if (!lock[0].ok) {
      await client.query('ROLLBACK');
      return { status: 'skipped', reason: 'already_running' };
    }
    const last = await lastSuccessfulRun(client);
    if (!opts.force && last && now.getTime() - last.getTime() < CLEANUP_EVERY_MS) {
      await client.query('ROLLBACK');
      return { status: 'skipped', reason: 'not_due', nextDueAt: new Date(last.getTime() + CLEANUP_EVERY_MS).toISOString() };
    }
    const run = await client.query<{ id: number }>(
      `INSERT INTO maintenance_runs (status, started_at) VALUES ('running', $1) RETURNING id`,
      [now],
    );
    runId = run.rows[0].id;

    const cutoff = new Date(now.getTime() - CHAT_RETENTION_MS);
    const deleted: Record<string, number> = {};
    const backup: Record<string, unknown[]> = {};
    for (const t of TARGETS) {
      const params = t.table === 'expired_sessions' ? [now] : [cutoff];
      const args = (q: string) => (q.includes('$1') ? params : []);
      const rows = (await client.query(t.backup, args(t.backup))).rows;
      if (t.backedUp) {
        backup[t.table] = rows;
        deleted[t.table] = rows.length;
      } else {
        deleted[t.table] = rows[0]?.n ?? 0;
      }
      if (t.remove) await client.query(t.remove, args(t.remove));
    }

    await client.query(
      `UPDATE maintenance_runs SET status = 'succeeded', finished_at = clock_timestamp(), deleted = $2, backup = $3 WHERE id = $1`,
      [runId, JSON.stringify(deleted), JSON.stringify({ cutoff: cutoff.toISOString(), rows: backup })],
    );
    // Keep the removed-rows backups of the latest runs only (the run log itself is kept).
    await client.query(
      `UPDATE maintenance_runs SET backup = NULL
       WHERE backup IS NOT NULL AND id NOT IN (SELECT id FROM maintenance_runs WHERE backup IS NOT NULL ORDER BY id DESC LIMIT $1)`,
      [KEEP_BACKUPS],
    );
    await client.query('COMMIT');
    console.log(
      `[cleanup] run ${runId} at ${ist(now)} IST removed: ${Object.entries(deleted).map(([k, v]) => `${k}=${v}`).join(', ')} ` +
        `(chat/notifications older than ${ist(cutoff)} IST)`,
    );
    return { status: 'succeeded', runId, deleted };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const message = (err as Error).message;
    console.error('[cleanup] failed, nothing was deleted:', message);
    const failed = await pool
      .query<{ id: number }>(
        `INSERT INTO maintenance_runs (status, started_at, finished_at, error) VALUES ('failed', $1, clock_timestamp(), $2) RETURNING id`,
        [now, message.slice(0, 500)],
      )
      .catch(() => null);
    return { status: 'failed', runId: failed?.rows[0]?.id ?? null, error: message };
  } finally {
    client.release();
  }
}

/** Checks every hour while the server is awake (and shortly after start); runs when due. */
export function startCleanupSchedule(checkEveryMs = 3_600_000): () => void {
  const tick = () => void runCleanup().catch((e) => console.error('[cleanup] check failed:', e.message));
  const first = setTimeout(tick, 60_000);
  const t = setInterval(tick, checkEveryMs);
  first.unref();
  t.unref();
  return () => {
    clearTimeout(first);
    clearInterval(t);
  };
}

export async function listRuns(limit = 10): Promise<{ runs: MaintenanceRun[]; nextDueAt: string | null }> {
  const { rows } = await pool.query(
    `SELECT id, started_at, finished_at, status, deleted, (backup IS NOT NULL) AS has_backup, error
     FROM maintenance_runs ORDER BY id DESC LIMIT $1`,
    [limit],
  );
  const last = await lastSuccessfulRun();
  return {
    runs: rows.map((r) => ({
      id: r.id,
      startedAt: r.started_at.toISOString(),
      finishedAt: r.finished_at?.toISOString() ?? null,
      status: r.status,
      deleted: r.deleted,
      hasBackup: r.has_backup,
      error: r.error,
    })),
    nextDueAt: last ? new Date(last.getTime() + CLEANUP_EVERY_MS).toISOString() : null,
  };
}

export async function runBackup(id: number): Promise<unknown | null> {
  const { rows } = await pool.query('SELECT backup FROM maintenance_runs WHERE id = $1', [id]);
  return rows[0]?.backup ?? null;
}
