// Restore a backup file into the database at DATABASE_URL (replaces current content).
//   DATABASE_URL=<url> npm run db:restore -- backups/<file>.json --yes
import { readFileSync } from 'node:fs';
import { importData } from '../server/src/backup.js';
import { pool, withTx } from '../server/src/db.js';
import { migrate } from '../server/src/migrate.js';
import { seedMembers } from '../server/src/seed.js';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file || !process.argv.includes('--yes')) {
  console.error('Usage: npm run db:restore -- <backup.json> --yes   (replaces all current data)');
  process.exit(1);
}
await migrate();
await seedMembers();
const counts = await withTx((c) => importData(JSON.parse(readFileSync(file, 'utf8')), c));
console.log('Restored:', counts);
await pool.end();
