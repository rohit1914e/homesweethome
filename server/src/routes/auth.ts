// /api/auth — tap-your-photo login (optional PIN), logout, current member.
import { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  hashToken,
  readCookie,
  requireAuth,
  setSessionCookie,
  verifyPin,
} from '../auth.js';
import { query } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { revokeMemberSockets } from '../realtime.js';
import { parse, z } from '../validate.js';
import { getMemberOrThrow, listPublicMembers } from './members.js';

const loginSchema = z.object({
  memberId: z.number().int().positive(),
  pin: z.string().max(64).optional(),
});

export function authRouter(): Router {
  const router = Router();

  // 10 failed attempts per 5 minutes per (IP, member). Successful logins and the
  // "this member needs a PIN" prompt do not count.
  const loginLimiter = rateLimit({
    windowMs: 5 * 60_000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const id = Number((req.body as { memberId?: unknown } | undefined)?.memberId);
      return `login:${req.ip ?? 'unknown'}:${Number.isInteger(id) ? id : 0}`;
    },
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.locals.loginAttemptFailed !== true,
    handler: (_req, _res, next) =>
      next(new HttpError(429, 'rate_limited', 'Too many tries. Wait a few minutes and try again.')),
  });

  router.get('/members', async (_req, res) => {
    res.json({ members: await listPublicMembers() });
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const { memberId, pin } = parse(loginSchema, req.body);
    const { rows } = await query<{ id: number; name: string; pin_hash: string | null }>(
      'SELECT id, name, pin_hash FROM members WHERE id = $1',
      [memberId],
    );
    const row = rows[0];
    if (!row) {
      res.locals.loginAttemptFailed = true;
      throw notFound('We don’t know that roommate.');
    }
    if (row.pin_hash) {
      if (!pin) throw new HttpError(401, 'pin_required', `Enter ${row.name}’s PIN.`);
      if (!(await verifyPin(pin, row.pin_hash))) {
        res.locals.loginAttemptFailed = true;
        throw new HttpError(401, 'invalid_pin', 'That PIN isn’t right. Try again.');
      }
    }

    // Replace any session this browser already had.
    const previous = readCookie(req.headers.cookie);
    if (previous) await destroySession(hashToken(previous)).catch(() => {});

    const { token } = await createSession(row.id, req.get('user-agent'));
    setSessionCookie(res, token);
    res.json({ member: await getMemberOrThrow(row.id) });
  });

  router.post('/logout', requireAuth, async (req, res) => {
    const tokenHash = req.sessionTokenHash!;
    await destroySession(tokenHash);
    // Other tabs of this browser share the cookie: tell their sockets the session is over.
    await revokeMemberSockets(req.member!.id, { onlyTokenHash: tokenHash });
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.get('/me', requireAuth, async (req, res) => {
    res.json({ member: await getMemberOrThrow(req.member!.id) });
  });

  return router;
}

export default authRouter;
