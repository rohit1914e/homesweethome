// /api/members — the household list, own bio and optional PIN.
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Member, PublicMember } from '../../../shared/types.js';
import { destroyMemberSessions, hashPin, PIN_RE, requireAuth, verifyPin } from '../auth.js';
import { config } from '../config.js';
import { query, type Db } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { isOnline, revokeMemberSockets } from '../realtime.js';
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
}

const MEMBER_COLUMNS = 'id, slug, name, is_admin, bio, last_seen_at, (pin_hash IS NOT NULL) AS has_pin';

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
  return { id: r.id, slug: r.slug, name: r.name, avatarUrl: await avatarUrlFor(r.slug), hasPin: r.has_pin };
}

async function toMember(r: MemberRow): Promise<Member> {
  return {
    ...(await toPublic(r)),
    isAdmin: r.is_admin,
    bio: r.bio,
    online: isOnline(r.id),
    lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null,
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
