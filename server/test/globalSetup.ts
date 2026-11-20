// Runs once before the whole vitest run: wipes the *test* database schema so migrations are
// exercised from scratch every run. Refuses to touch any database whose name does not end in _test.
import pg from 'pg';

export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/homesweethome_test';
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to reset non-test database "${dbName}"`);
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `Cannot reach the test database at ${url}. Start it with \`node scripts/local-db.mjs\`. (${(err as Error).message})`,
    );
  }
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
}
