// Applies server/migrations/*.sql in name order. Each file runs in its own transaction and is
// recorded in schema_migrations, so restarts and redeploys only apply what is new.
// A session-level advisory lock serialises concurrent instances (e.g. an overlapping redeploy).
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { pool } from './db.js';

/** Arbitrary constant shared by every instance of this app ("HSH" + 1). */
const MIGRATION_LOCK_KEY = 0x48534801;

export async function migrate(): Promise<string[]> {
  const files = (await readdir(config.migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           name       text        PRIMARY KEY,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
      const done = new Set(
        (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
      );
      for (const name of files) {
        if (done.has(name)) continue;
        const sql = await readFile(join(config.migrationsDir, name), 'utf8');
        try {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw new Error(`Migration ${name} failed: ${(err as Error).message}`);
        }
        applied.push(name);
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    }
  } finally {
    client.release();
  }
  return applied;
}
