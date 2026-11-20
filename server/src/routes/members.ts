// /api/members — the household list, own bio and optional PIN.
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { statusVisible, statusWindowAt } from '../../../shared/statusWindow.js';
import type { Member, MemberLocation, PublicMember } from '../../../shared/types.js';
import { destroyMemberSessions, hashPin, PIN_RE, requireAuth, verifyPin } from '../auth.js';
import { config } from '../config.js';
import { query, type Db } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { broadcast, isOnline, revokeMemberSockets } from '../realtime.js';
import { photoInputSchema, removeMemberPhoto, setMemberPhoto } from '../photos.js';
import { statusNow } from '../time.js';
import { parse, z } from '../validate.js';

// ---- Shared member serialisation (also used by routes/auth.ts) ---------------
interface MemberRow {
  id: number;
  slug: string;
  name: string;
  is_admin: boolean;
  bio: string;
  last_seen_at: Date | null;
  has_pin: boolean;
  location: MemberLocation | null;
  location_updated_at: Date | null;
  location_source: 'manual' | 'gps' | null;
  gps_enabled: boolean;
  photo_v: number | null;
}

const MEMBER_COLUMNS = 'id, slug, name, is_admin, bio, last_seen_at, (pin_hash IS NOT NULL) AS has_pin, location, location_updated_at, location_source, gps_enabled, (SELECT (extract(epoch FROM p.updated_at) * 1000)::float8 FROM member_photos p WHERE p.member_id = members.id) AS photo_v';

const AVATAR_TTL_MS = 60_000;
const avatarCache = new Map<string, { at: number; url: string | null }>();

/** `/avatars/<slug>.webp?v=<mtimeMs>` when the processed photo exists, else null (stat cached ~60 s). */
export async function avatarUrlFor(slug: string): Promise<string | null> {
  const hit = avatarCache.get(slug);
  if (hit && Date.now() - hit.at < AVATAR_TTL_MS) return hit.url;
  let url: string | null = null;
  try {
    const s = await stat(join(config.avatarsDir, `${slug}.webp`));
    if (s.isFile()) url = `/avatars/${slug}.webp?v=${Math.round(s.mtimeMs)}`;
  } catch {
    url = null;
  }
  avatarCache.set(slug, { at: Date.now(), url });
  return url;
}

async function toPublic(r: MemberRow): Promise<PublicMember> {
  // An uploaded picture wins over the default one shipped with the app.
  const avatarUrl = r.photo_v !== null ? `/api/members/${r.id}/photo?v=${Math.round(r.photo_v)}` : await avatarUrlFor(r.slug);
  return { id: r.id, slug: r.slug, name: r.name, avatarUrl, hasPin: r.has_pin };
}

/** Readings less precise than this are ignored (the status is left as it was). */
export const MAX_ACCURACY_M = 500;

/** Great-circle distance in metres (haversine). */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function toMember(r: MemberRow): Promise<Member> {
  return {
    ...(await toPublic(r)),
    isAdmin: r.is_admin,
    bio: r.bio,
    online: isOnline(r.id),
    lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null,
    ...visibleStatus(r),
    gpsEnabled: r.gps_enabled,
  };
}

/** Status is shown only 8 AM – 3 PM IST and only if updated since today's 8 AM. */
export function visibleStatus(r: Pick<MemberRow, 'location' | 'location_updated_at' | 'location_source'>, now = statusNow()) {
  const show = r.location !== null && statusVisible(r.location_updated_at, now);
  return {
    location: show ? r.location : null,
    locationUpdatedAt: show ? r.location_updated_at!.toISOString() : null,
    locationSource: show ? r.location_source : null,
  };
}

export async function listPublicMembers(db?: Db): Promise<PublicMember[]> {
  const { rows } = await query<MemberRow>(`SELECT ${MEMBER_COLUMNS} FROM members ORDER BY id`, [], db);
  return Promise.all(rows.map(toPublic));
}

export async function listMembers(db?: Db): Promise<Member[]> {
  const { rows } = await query<MemberRow>(`SELECT ${MEMBER_COLUMNS} FROM members ORDER BY id`, [], db);
  return Promise.all(rows.map(toMember));
}

export async function getMember(id: number, db?: Db): Promise<Member | null> {
  const { rows } = await query<MemberRow>(`SELECT ${MEMBER_COLUMNS} FROM members WHERE id = $1`, [id], db);
  return rows[0] ? toMember(rows[0]) : null;
}

export async function getMemberOrThrow(id: number, db?: Db): Promise<Member> {
  const m = await getMember(id, db);
  if (!m) throw notFound('That roommate does not exist.');
  return m;
}

// ---- Routes ------------------------------------------------------------------
const bioSchema = z.object({
  bio: z.string().trim().max(280, 'Keep your bio to 280 characters.'),
});

const pinSchema = z.object({
  currentPin: z.string().max(64).optional(),
  newPin: z.string().regex(PIN_RE, 'Your PIN must be 4 to 8 digits.').nullable(),
});

export function membersRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // Guessing your own current PIN from a hijacked session is still guessing: limit it.
  const pinLimiter = rateLimit({
    windowMs: 5 * 60_000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req: Request) => `pin:${req.member?.id ?? 0}`,
    requestWasSuccessful: (_req, res) => res.locals.pinAttemptFailed !== true,
    skipSuccessfulRequests: true,
    handler: (_req, _res, next) =>
      next(new HttpError(429, 'rate_limited', 'Too many PIN attempts. Wait a few minutes and try again.')),
  });

  router.get('/', async (_req, res) => {
    res.json({ members: await listMembers() });
  });

  router.patch('/me', async (req, res) => {
    const { bio } = parse(bioSchema, req.body);
    await query('UPDATE members SET bio = $2 WHERE id = $1', [req.member!.id, bio]);
    res.json({ member: await getMemberOrThrow(req.member!.id) });
  });

  // ---- Home / College status — always the signed-in member's own row (no member id is accepted).
  const windowGuard = () => {
    if (!statusWindowAt(statusNow()).open) {
      throw new HttpError(409, 'status_closed', 'Home / College status is only shared between 8 AM and 3 PM.');
    }
  };

  /** Write a status, broadcasting only when what others can see actually changes. */
  async function applyStatus(memberId: number, location: MemberLocation | null, source: 'manual' | 'gps' | null) {
    const before = await getMemberOrThrow(memberId);
    const at = location === null ? null : statusNow();
    await query('UPDATE members SET location = $2, location_source = $3, location_updated_at = $4 WHERE id = $1', [
      memberId, location, location === null ? null : source, at,
    ]);
    const after = await getMemberOrThrow(memberId);
    if (before.location !== after.location || before.locationSource !== after.locationSource) {
      broadcast('member:location', { memberId, location: after.location, source: after.locationSource, updatedAt: after.locationUpdatedAt });
    }
    return after;
  }

  // Manual pick. With GPS on, this is an override for the rest of today's window.
  router.put('/me/location', async (req, res) => {
    const { location } = parse(z.object({ location: z.enum(['home', 'college', 'away']) }), req.body);
    windowGuard();
    res.json({ member: await applyStatus(req.member!.id, location, 'manual') });
  });

  // Opt in / out of GPS detection. Turning it on (again) also ends a manual override.
  router.put('/me/gps', async (req, res) => {
    const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
    const id = req.member!.id;
    const { rows } = await query<{ location_source: string | null }>(
      'UPDATE members SET gps_enabled = $2 WHERE id = $1 RETURNING location_source',
      [id, enabled],
    );
    // GPS on: clear a manual override so the next reading takes effect. GPS off: drop the GPS-derived status.
    const clear = enabled ? rows[0].location_source === 'manual' : rows[0].location_source === 'gps';
    res.json({ member: clear ? await applyStatus(id, null, null) : await getMemberOrThrow(id) });
  });

  // One GPS reading from the browser. The coordinates are compared against the two places
  // in memory and DISCARDED — never stored, logged or returned. Only the status is saved.
  const readingSchema = z.union([
    z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracy: z.number().nonnegative().max(1e6),
    }),
    z.object({ error: z.enum(['denied', 'unavailable']) }),
  ]);
  router.post('/me/gps/reading', async (req, res) => {
    const reading = parse(readingSchema, req.body);
    const id = req.member!.id;
    windowGuard();
    const { rows } = await query<MemberRow>(`SELECT ${MEMBER_COLUMNS} FROM members WHERE id = $1`, [id]);
    const row = rows[0];
    if (!row.gps_enabled) throw new HttpError(409, 'gps_disabled', 'Turn on GPS detection first.');
    const skip = async (reason: string) => res.json({ applied: false, reason, member: await getMemberOrThrow(id) });
    // A manual pick made during today's window wins until the member turns GPS back on.
    if (row.location_source === 'manual' && statusVisible(row.location_updated_at, statusNow())) return skip('manual_override');
    if ('error' in reading) return res.json({ applied: true, member: await applyStatus(id, 'unavailable', 'gps') });
    if (reading.accuracy > MAX_ACCURACY_M) return skip('inaccurate');
    const places = await query<{ kind: 'home' | 'college'; lat: number; lng: number; radius_m: number }>(
      'SELECT kind, lat, lng, radius_m FROM places',
    );
    if (places.rows.length === 0) return skip('not_configured');
    let best: { kind: 'home' | 'college'; d: number } | null = null;
    for (const p of places.rows) {
      const d = distanceM(reading.lat, reading.lng, p.lat, p.lng);
      if (d <= p.radius_m && (!best || d < best.d)) best = { kind: p.kind, d };
    }
    res.json({ applied: true, member: await applyStatus(id, best?.kind ?? 'away', 'gps') });
  });

  // Own profile picture (Rohit manages anyone's via /api/admin/members/:id/photo).
  router.put('/me/photo', async (req, res) => {
    const { image } = parse(photoInputSchema, req.body);
    await setMemberPhoto(req.member!.id, image, req.member!.id);
    res.json({ member: await getMemberOrThrow(req.member!.id) });
  });
  router.delete('/me/photo', async (req, res) => {
    await removeMemberPhoto(req.member!.id);
    res.json({ member: await getMemberOrThrow(req.member!.id) });
  });

  router.put('/me/pin', pinLimiter, async (req, res) => {
    const { currentPin, newPin } = parse(pinSchema, req.body);
    const me = req.member!;
    const { rows } = await query<{ pin_hash: string | null }>('SELECT pin_hash FROM members WHERE id = $1', [me.id]);
    const current = rows[0]?.pin_hash ?? null;
    if (current) {
      if (!currentPin) {
        res.locals.pinAttemptFailed = true;
        throw new HttpError(401, 'invalid_pin', 'Enter your current PIN first.');
      }
      if (!(await verifyPin(currentPin, current))) {
        res.locals.pinAttemptFailed = true;
        throw new HttpError(401, 'invalid_pin', 'That current PIN isn’t right.');
      }
    }
    const nextHash = newPin === null ? null : await hashPin(newPin);
    await query('UPDATE members SET pin_hash = $2 WHERE id = $1', [me.id, nextHash]);
    if (nextHash) {
      // Setting a PIN locks the account: sign out every other device that got in without it.
      await destroyMemberSessions(me.id, req.sessionTokenHash);
      await revokeMemberSockets(me.id, { exceptTokenHash: req.sessionTokenHash });
    }
    res.status(204).end();
  });

  return router;
}

export default membersRouter;
