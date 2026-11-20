// Session-cookie authentication.
// - The cookie holds a random 32-byte token (base64url); the DB stores only sha256(token).
// - 30-day sliding expiry, refreshed at most once per hour per session.
// - Identity for every route comes from req.member, set here — never from a request body.
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { pool, query } from './db.js';
import { forbidden, HttpError, unauthorized } from './errors.js';
import type { AuthMember } from './types/express.js';

export type { AuthMember };

const DAY_MS = 86_400_000;
const REFRESH_AFTER_SQL = `interval '1 hour'`;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url, no padding
export const PIN_BCRYPT_COST = 10;

export interface SessionInfo {
  member: AuthMember;
  tokenHash: Buffer;
  /** True when this lookup slid the expiry forward (the cookie should be re-sent). */
  refreshed: boolean;
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/** Minimal RFC 6265 cookie-header reader (no dependency on cookie-parser being mounted). */
export function readCookie(cookieHeader: string | undefined, name: string = config.cookieName): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: config.sessionDays * DAY_MS,
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(config.cookieName, token, cookieOptions());
}

export function clearSessionCookie(res: Response): void {
  const { maxAge: _ignored, ...opts } = cookieOptions();
  res.clearCookie(config.cookieName, opts);
}

/** Creates a session row and returns the raw token (to be put in the cookie — never stored). */
export async function createSession(
  memberId: number,
  userAgent?: string | null,
): Promise<{ token: string; tokenHash: Buffer; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const { rows } = await query<{ expires_at: Date }>(
    `INSERT INTO sessions (token_hash, member_id, expires_at, user_agent)
     VALUES ($1, $2, now() + make_interval(days => $3), $4)
     RETURNING expires_at`,
    [tokenHash, memberId, config.sessionDays, userAgent ? userAgent.slice(0, 300) : null],
  );
  return { token, tokenHash, expiresAt: rows[0].expires_at };
}

export async function destroySession(tokenHash: Buffer): Promise<void> {
  await query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

/** Deletes every session of a member, optionally keeping one. Returns how many were removed. */
export async function destroyMemberSessions(memberId: number, exceptTokenHash?: Buffer): Promise<number> {
  const res = exceptTokenHash
    ? await query('DELETE FROM sessions WHERE member_id = $1 AND token_hash <> $2', [memberId, exceptTokenHash])
    : await query('DELETE FROM sessions WHERE member_id = $1', [memberId]);
  return res.rowCount ?? 0;
}

/** Resolves a raw token to its session + member, sliding the expiry if it is over an hour old. */
export async function loadSession(token: string | null | undefined): Promise<SessionInfo | null> {
  if (!token || !TOKEN_RE.test(token)) return null;
  const tokenHash = hashToken(token);
  const { rows } = await query<{ id: number; slug: string; name: string; is_admin: boolean; stale: boolean }>(
    `SELECT m.id, m.slug, m.name, m.is_admin, s.last_used_at < now() - ${REFRESH_AFTER_SQL} AS stale
       FROM sessions s JOIN members m ON m.id = s.member_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.stale) {
    await query(
      `UPDATE sessions SET last_used_at = now(), expires_at = now() + make_interval(days => $2)
        WHERE token_hash = $1`,
      [tokenHash, config.sessionDays],
    );
  }
  return {
    member: { id: row.id, slug: row.slug, name: row.name, isAdmin: row.is_admin },
    tokenHash,
    refreshed: row.stale,
  };
}

/** Used by the Socket.IO handshake: cookie header → member, or null. */
export async function loadSessionMember(cookieHeader: string | undefined): Promise<AuthMember | null> {
  return (await loadSession(readCookie(cookieHeader)))?.member ?? null;
}

/** Sets req.member when the cookie is valid. Returns whether the request is authenticated. */
async function authenticate(req: Request, res: Response): Promise<boolean> {
  if (req.member) return true;
  const token = readCookie(req.headers.cookie);
  if (!token) return false;
  const session = await loadSession(token);
  if (!session) {
    clearSessionCookie(res); // stale/forged cookie: stop the browser from sending it
    return false;
  }
  req.member = session.member;
  req.sessionTokenHash = session.tokenHash;
  if (session.refreshed) setSessionCookie(res, token);
  return true;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!(await authenticate(req, res))) throw unauthorized();
  next();
}

/** Rohit only. Authenticates by itself if requireAuth has not run yet. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!(await authenticate(req, res))) throw unauthorized();
  if (!req.member!.isAdmin) throw forbidden();
  next();
}

/** Every state-changing /api request must carry X-HSH-Client: 1 (a simple-request CSRF barrier). */
export function csrfGuard(req: Request, _res: Response, next: NextFunction): void {
  const m = req.method;
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
  if (req.get('x-hsh-client') !== '1') {
    throw new HttpError(403, 'csrf', 'This request was blocked. Reload the page and try again.');
  }
  next();
}

// ---- PINs ------------------------------------------------------------------
export const PIN_RE = /^\d{4,8}$/;

export function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, PIN_BCRYPT_COST);
}

export function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

// ---- Housekeeping ----------------------------------------------------------
export async function cleanupExpiredSessions(): Promise<number> {
  const res = await pool.query('DELETE FROM sessions WHERE expires_at <= now()');
  return res.rowCount ?? 0;
}

/** Deletes expired sessions now and then every hour. Returns a stop function. */
export function startSessionCleanup(intervalMs = 3_600_000): () => void {
  const run = () =>
    cleanupExpiredSessions().catch((err) => console.error('[auth] session cleanup failed:', (err as Error).message));
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
