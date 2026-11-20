// Deletes ALL content (menus, votes, bookings, chat, cleaning duties, notifications, sessions)
// but keeps the six member accounts, their PINs and bios.
//   DATABASE_URL=<url> npm run db:clear -- --yes
import { pool } from '../server/src/db.js';

if (!process.argv.includes('--yes')) {
  console.error('Usage: npm run db:clear -- --yes   (deletes all content; keeps the six accounts)');
  process.exit(1);
}
await pool.query(
  `TRUNCATE cleaning_tasks, cooking_votes, cooking_menus, washing_bookings, chat_messages, chat_reads, notifications, sessions
   RESTART IDENTITY CASCADE`,
);
const { rows } = await pool.query('SELECT count(*)::int AS n FROM members');
console.log(`Cleared all content. Members kept: ${rows[0].n}`);
await pool.end();
