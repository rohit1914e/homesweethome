// Starts a disposable local PostgreSQL cluster for development and tests.
// Uses the PostgreSQL binaries already installed on this machine; it never
// touches any existing PostgreSQL service. Data lives in ./.pgdata (git-ignored).
//
//   npm run db:local          -> init (first time) + start on port 55432
//   npm run db:local -- stop  -> stop it
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = process.env.LOCAL_PG_PORT ?? '55432';
const DATA = resolve('.pgdata');

function findBin() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const roots = ['C:/Program Files/PostgreSQL', '/usr/lib/postgresql', '/opt/homebrew/opt'];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const versions = readdirSync(root).sort().reverse();
    for (const v of versions) {
      const bin = join(root, v, 'bin');
      if (existsSync(join(bin, process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl'))) return bin;
    }
  }
  return ''; // rely on PATH
}

const bin = findBin();
const tool = (name) => (bin ? join(bin, name) : name);
const run = (name, args) => execFileSync(tool(name), args, { stdio: 'inherit' });

if (process.argv[2] === 'stop') {
  run('pg_ctl', ['-D', DATA, 'stop', '-m', 'fast']);
  process.exit(0);
}

if (!existsSync(join(DATA, 'PG_VERSION'))) {
  console.log(`Initialising local cluster in ${DATA}`);
  run('initdb', ['-D', DATA, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale']);
}

const status = spawnSync(tool('pg_ctl'), ['-D', DATA, 'status']);
if (status.status !== 0) {
  // stdio 'ignore': the postmaster would otherwise inherit our stdout and keep the caller's pipe open.
  const started = spawnSync(tool('pg_ctl'), ['-D', DATA, '-l', join(DATA, 'server.log'), '-o', `-p ${PORT} -c listen_addresses=localhost`, '-w', 'start'], { stdio: 'ignore' });
  if (started.status !== 0) throw new Error(`pg_ctl start failed; see ${join(DATA, 'server.log')}`);
}

for (const db of ['homesweethome', 'homesweethome_test']) {
  const exists = spawnSync(tool('psql'), ['-h', 'localhost', '-p', PORT, '-U', 'postgres', '-tAc', `SELECT 1 FROM pg_database WHERE datname='${db}'`], { encoding: 'utf8' });
  if (!exists.stdout.includes('1')) run('createdb', ['-h', 'localhost', '-p', PORT, '-U', 'postgres', db]);
}
console.log(`Local PostgreSQL ready: postgres://postgres@localhost:${PORT}/homesweethome`);
