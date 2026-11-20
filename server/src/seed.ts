// Idempotent upsert of the six roommates — the ONLY way accounts come into existence.
// Existing rows keep their pin_hash, bio and last_seen_at.
import { pool, type Db } from './db.js';
import { MEMBERS } from './members.js';

export async function seedMembers(db: Db = pool): Promise<void> {
  await db.query(
    `INSERT INTO members (id, slug, name, is_admin)
     SELECT * FROM unnest($1::smallint[], $2::text[], $3::text[], $4::boolean[])
     ON CONFLICT (id) DO UPDATE
       SET slug = EXCLUDED.slug, name = EXCLUDED.name, is_admin = EXCLUDED.is_admin
       WHERE (members.slug, members.name, members.is_admin)
             IS DISTINCT FROM (EXCLUDED.slug, EXCLUDED.name, EXCLUDED.is_admin)`,
    [MEMBERS.map((m) => m.id), MEMBERS.map((m) => m.slug), MEMBERS.map((m) => m.name), MEMBERS.map((m) => m.isAdmin)],
  );
}
