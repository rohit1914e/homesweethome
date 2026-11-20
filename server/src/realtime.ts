// Socket.IO core: cookie-authenticated handshake, per-member rooms, presence, typed emit helpers.
// Same origin only: no CORS option, and a handshake whose Origin host differs from Host is refused.
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/types.js';
import { loadSession, readCookie, type AuthMember } from './auth.js';
import { config } from './config.js';
import { query } from './db.js';
import { addSocket, isMemberOnline, onlineIds, removeSocket, resetPresence } from './presence.js';

export interface SocketData {
  member: AuthMember;
  tokenHash: Buffer;
}

export type AppServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type ConnectionHandler = (socket: AppSocket, member: AuthMember) => void;
type EventArgs<E extends keyof ServerToClientEvents> = Parameters<ServerToClientEvents[E]>;

/** Every authenticated socket joins this room; broadcasts never reach anyone else. */
const HOUSEHOLD = 'household';
const memberRoom = (id: number) => `member:${id}`;

let io: AppServer | null = null;
const connectionHandlers: ConnectionHandler[] = [];

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (tests, curl) send none; the cookie still gates access
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const host = (req.headers['x-forwarded-host'] && config.trustProxy ? String(req.headers['x-forwarded-host']) : req.headers.host ?? '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    return originHost === host;
  } catch {
    return false;
  }
}

export function initRealtime(httpServer: HttpServer): AppServer {
  resetPresence();
  const server: AppServer = new Server(httpServer, {
    path: '/socket.io',
    serveClient: false,
    pingInterval: 25_000, // under Render's proxy idle timeout; detects dead phones within ~45 s
    pingTimeout: 20_000,
    maxHttpBufferSize: 16 * 1024, // clients only ever send tiny typing events
    allowRequest: (req, cb) => cb(null, sameOrigin(req)),
  });

  server.use(async (socket, next) => {
    try {
      const session = await loadSession(readCookie(socket.request.headers.cookie));
      if (!session) return next(new Error('unauthorized'));
      socket.data.member = session.member;
      socket.data.tokenHash = session.tokenHash;
      next();
    } catch (err) {
      console.error('[realtime] handshake failed:', (err as Error).message);
      next(new Error('unauthorized'));
    }
  });

  server.on('connection', (socket) => {
    const member = socket.data.member;
    void socket.join([HOUSEHOLD, memberRoom(member.id)]);

    const first = addSocket(member.id, socket.id);
    socket.emit('presence:state', { online: onlineIds() });
    if (first) {
      socket.to(HOUSEHOLD).emit('presence:update', { memberId: member.id, online: true, lastSeenAt: null });
    }

    socket.on('disconnect', () => {
      if (!removeSocket(member.id, socket.id)) return;
      const lastSeenAt = new Date().toISOString();
      server.to(HOUSEHOLD).emit('presence:update', { memberId: member.id, online: false, lastSeenAt });
      query('UPDATE members SET last_seen_at = $2 WHERE id = $1', [member.id, lastSeenAt]).catch((err) =>
        console.error('[realtime] last_seen_at update failed:', (err as Error).message),
      );
    });

    for (const handler of connectionHandlers) {
      try {
        handler(socket, member);
      } catch (err) {
        console.error('[realtime] connection handler failed:', (err as Error).message);
      }
    }
  });

  io = server;
  return server;
}

export function getIO(): AppServer {
  if (!io) throw new Error('Socket.IO is not initialised; call initRealtime() first.');
  return io;
}

/** Forget the current server (used on shutdown). Emits become no-ops afterwards. */
export function resetRealtime(): void {
  io = null;
  resetPresence();
}

/** Register extra per-socket handlers (e.g. chat typing). Applies to sockets connecting afterwards. */
export function onSocketConnection(handler: ConnectionHandler): void {
  if (!connectionHandlers.includes(handler)) connectionHandlers.push(handler);
}

// Emit helpers are no-ops before initRealtime (e.g. createApp() used alone in tests).
export function broadcast<E extends keyof ServerToClientEvents>(event: E, ...args: EventArgs<E>): void {
  (io?.to(HOUSEHOLD) as any)?.emit(event, ...args);
}

export function emitToMember<E extends keyof ServerToClientEvents>(memberId: number, event: E, ...args: EventArgs<E>): void {
  (io?.to(memberRoom(memberId)) as any)?.emit(event, ...args);
}

export function broadcastExcept<E extends keyof ServerToClientEvents>(
  memberId: number,
  event: E,
  ...args: EventArgs<E>
): void {
  (io?.to(HOUSEHOLD).except(memberRoom(memberId)) as any)?.emit(event, ...args);
}

export function onlineMemberIds(): number[] {
  return onlineIds();
}

export function isOnline(memberId: number): boolean {
  return isMemberOnline(memberId);
}

/**
 * Tells a member's sockets their session is gone ('session:revoked') and disconnects them.
 * `onlyTokenHash`: just the sockets of that one session (logout). `exceptTokenHash`: all but that one.
 */
export async function revokeMemberSockets(
  memberId: number,
  opts: { onlyTokenHash?: Buffer; exceptTokenHash?: Buffer } = {},
): Promise<number> {
  if (!io) return 0;
  const sockets = await io.in(memberRoom(memberId)).fetchSockets();
  let n = 0;
  for (const s of sockets) {
    const hash = s.data.tokenHash;
    if (opts.onlyTokenHash && !hash?.equals(opts.onlyTokenHash)) continue;
    if (opts.exceptTokenHash && hash?.equals(opts.exceptTokenHash)) continue;
    s.emit('session:revoked');
    s.disconnect(true);
    n++;
  }
  return n;
}
