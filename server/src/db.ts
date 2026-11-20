// Shared PostgreSQL access. Every module uses these helpers; nobody creates their own Pool.
import pg from 'pg';
import { config } from './config.js';

// DATE columns come back as plain 'YYYY-MM-DD' strings (never shifted through JS Date/timezones).
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
// int8 (bigserial ids, count(*)) as JS numbers — all our values are far below 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// A dropped idle connection (DB restart / maintenance) must not crash the process.
pool.on('error', (err) => console.error('[db] idle client error:', err.message));

export type Db = pg.Pool | pg.PoolClient;

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params: unknown[] = [],
  db: Db = pool,
): Promise<pg.QueryResult<T>> {
  return db.query<T>(text, params);
}

/** Run fn inside BEGIN/COMMIT; rolls back on any throw. */
export async function withTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function pgCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as any).code) : undefined;
}

/** 23505, optionally for a specific constraint/index name. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  return pgCode(err) === '23505' && (!constraint || (err as any).constraint === constraint);
}

/** Our triggers RAISE EXCEPTION '<code>' USING ERRCODE = 'P0001'. Returns that code. */
export function raisedCode(err: unknown): string | undefined {
  return pgCode(err) === 'P0001' ? String((err as any).message) : undefined;
}
