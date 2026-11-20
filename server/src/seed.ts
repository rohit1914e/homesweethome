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

/**
 * Initial GPS places from env (kept OUT of the public repo): HOME_PLACE / COLLEGE_PLACE = "lat,lng[,radiusM]".
 * Inserted only if that place doesn't exist yet, so Rohit's later edits in Settings always win.
 */
export function parsePlaceEnv(value: string | undefined): { lat: number; lng: number; radiusM: number } | null {
  if (!value?.trim()) return null;
  const [lat, lng, radius] = value.split(',').map((x) => Number(x.trim()));
  const radiusM = Number.isFinite(radius) ? Math.round(radius) : 150;
  const ok = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && radiusM >= 25 && radiusM <= 10000;
  if (!ok) {
    console.warn('[seed] ignoring a malformed place setting (expected "lat,lng[,radiusM]")');
    return null;
  }
  return { lat, lng, radiusM };
}

export async function seedPlaces(db: Db = pool, env = process.env): Promise<void> {
  for (const [kind, raw] of [['home', env.HOME_PLACE], ['college', env.COLLEGE_PLACE]] as const) {
    const p = parsePlaceEnv(raw);
    if (!p) continue;
    await db.query(
      'INSERT INTO places (kind, lat, lng, radius_m) VALUES ($1, $2, $3, $4) ON CONFLICT (kind) DO NOTHING',
      [kind, p.lat, p.lng, p.radiusM],
    );
  }
}
