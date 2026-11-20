// Download a full backup of the database to backups/ (git-ignored).
//   DATABASE_URL=<Render EXTERNAL url> npm run db:backup
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportData } from '../server/src/backup.js';
import { pool } from '../server/src/db.js';

const data = await exportData();
mkdirSync('backups', { recursive: true });
const file = join('backups', `homesweethome-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify(data));
const counts = Object.entries(data.tables).map(([t, rows]) => `${t}=${(rows as unknown[]).length}`).join(' ');
console.log(`Saved ${file}\n${counts}`);
await pool.end();
