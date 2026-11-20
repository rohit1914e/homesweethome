import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { startSessionCleanup } from './auth.js';
import { registerChatSocket } from './chatSocket.js';
import { assertConfig, config } from './config.js';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { startKeepAlive } from './keepalive.js';
import { startCleanupSchedule } from './maintenance.js';
import { initRealtime } from './realtime.js';
import { seedMembers, seedPlaces } from './seed.js';

/** A cold-started free instance may come up before the database answers; retry for ~60 s. */
async function waitForDatabase(timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (Date.now() - start > timeoutMs) throw err;
      console.warn(`[db] not ready (attempt ${attempt}): ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, Math.min(1000 * attempt, 5000)));
    }
  }
}

/** Cooking history is kept for 2 days (today + yesterday): purge at startup and every hour. */
function startCookingPurge(intervalMs = 3_600_000): () => void {
  const run = () =>
    pool
      .query<{ n: number }>('SELECT purge_old_cooking() AS n')
      .then((r) => r.rows[0].n && console.log(`[cooking] purged ${r.rows[0].n} menu(s) older than yesterday`))
      .catch((err) => console.error('[cooking] purge failed:', err.message));
  void run();
  const t = setInterval(run, intervalMs);
  t.unref();
  return () => clearInterval(t);
}

export async function startServer(opts: { port?: number; host?: string } = {}) {
  assertConfig();
  await waitForDatabase();
  const applied = await migrate();
  if (applied.length) console.log(`[db] applied migrations: ${applied.join(', ')}`);
  await seedMembers();
  await seedPlaces();
  const stopPurge = startCookingPurge();

  const server = createServer(createApp());
  initRealtime(server);
  registerChatSocket();
  const stopCleanup = startSessionCleanup();
  const stopMaintenance = config.isTest ? () => {} : startCleanupSchedule();
  const stopKeepAlive = config.isTest ? null : startKeepAlive();

  const port = opts.port ?? config.port;
  const host = opts.host ?? config.host;
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => ok());
  });
  const actual = (server.address() as { port: number }).port;
  const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${actual}`;

  return {
    url,
    port: actual,
    server,
    async close() {
      stopCleanup();
      stopPurge();
      stopMaintenance();
      stopKeepAlive?.();
      const { getIO } = await import('./realtime.js');
      await new Promise<void>((r) => getIO().close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer()
    .then((s) => {
      console.log(`HomeSweetHome listening on ${config.host}:${s.port} (${config.nodeEnv})`);
      const shutdown = async (sig: string) => {
        console.log(`[server] ${sig} — shutting down`);
        await s.close().catch(() => {});
        await pool.end().catch(() => {});
        process.exit(0);
      };
      process.on('SIGTERM', () => void shutdown('SIGTERM'));
      process.on('SIGINT', () => void shutdown('SIGINT'));
    })
    .catch((err) => {
      console.error('[server] failed to start:', err);
      process.exit(1);
    });
}
