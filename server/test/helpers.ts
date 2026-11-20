// Shared test harness: in-process server, cookie-bearing HTTP clients, DB reset, sockets.
// Written against docs/CONTRACT.md, not against the implementation.
import { createHash } from 'node:crypto';
import pg from 'pg';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, Meta, ServerToClientEvents } from '../../shared/types.js';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const MEMBER = { rohit: 1, jagan: 2, bharath: 3, surya: 4, bazith: 5, dharun: 6 } as const;
export const MEMBER_NAMES = ['Rohit', 'Jagan', 'Bharath', 'Surya', 'Bazith', 'Dharun'];
export const ALL_IDS = [1, 2, 3, 4, 5, 6];
export const COOKIE = 'hsh_session';

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------
export interface Running {
  url: string;
  port: number;
  close(): Promise<void>;
}

let current: Running | null = null;

/** Starts the real server on a random port (migrations + seed run inside startServer). */
export async function startTestServer(): Promise<Running> {
  const mod = await import('../src/index.js');
  current = await mod.startServer({ port: 0, host: '127.0.0.1' });
  return current;
}

export function server(): Running {
  if (!current) throw new Error('server not started — call startTestServer() in beforeAll');
  return current;
}

export async function stopTestServer(): Promise<void> {
  const s = current;
  current = null;
  if (s) await s.close();
}

// ---------------------------------------------------------------------------
// Direct DB access (test-owned pool, independent from the app's pool so a server
// restart that ends the app pool does not break the harness)
// ---------------------------------------------------------------------------
let testPool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (!testPool) {
    const url = process.env.DATABASE_URL;
    if (!url || !/_test(\?|$)/.test(url)) throw new Error(`Refusing to use non-test DATABASE_URL: ${url}`);
    testPool = new pg.Pool({ connectionString: url, max: 4 });
    testPool.on('error', () => {});
  }
  return testPool;
}

export async function sql<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await db().query<T>(text, params);
  return res.rows;
}

export async function closeDb(): Promise<void> {
  const p = testPool;
  testPool = null;
  if (p) await p.end();
}

/** Wipe all content + sessions; keep the six members but clear their PINs and bios. */
export async function resetData(): Promise<void> {
  await sql(
    `TRUNCATE cleaning_tasks, cooking_votes, cooking_menus, washing_bookings, chat_messages, chat_reads, notifications, sessions
     RESTART IDENTITY CASCADE`,
  );
  await sql(`UPDATE members SET pin_hash = NULL, bio = '', location = NULL, location_updated_at = NULL, location_source = NULL, gps_enabled = false`);
  await sql('DELETE FROM places');
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------
export interface Res<T = any> {
  status: number;
  body: T;
  text: string;
  headers: Headers;
  setCookies: string[];
}

export interface ReqOpts {
  /** Send X-HSH-Client: 1 on non-GET (default true). */
  csrf?: boolean;
  headers?: Record<string, string>;
  /** Raw body string instead of JSON.stringify(body). */
  raw?: string;
  /** Override the cookie header for this request (null = none). */
  cookie?: string | null;
}

export class Client {
  cookie: string | null = null;
  member: any = null;

  constructor(public base: string = server().url) {}

  get token(): string | null {
    if (!this.cookie) return null;
    const m = this.cookie.match(new RegExp(`${COOKIE}=([^;]+)`));
    return m ? decodeURIComponent(m[1]) : null;
  }

  async req<T = any>(method: string, path: string, body?: unknown, opts: ReqOpts = {}): Promise<Res<T>> {
    const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
    if (method !== 'GET' && method !== 'HEAD' && opts.csrf !== false) headers['X-HSH-Client'] = '1';
    let payload: string | undefined;
    if (opts.raw !== undefined) {
      payload = opts.raw;
      headers['Content-Type'] ??= 'application/json';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    const cookie = opts.cookie === undefined ? this.cookie : opts.cookie;
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(this.base + path, { method, headers, body: payload, redirect: 'manual' });
    const text = await res.text();
    let parsed: any = undefined;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const pair = sc.split(';')[0];
      if (pair.startsWith(`${COOKIE}=`)) {
        const value = pair.slice(COOKIE.length + 1);
        // Cleared cookie (logout) → forget it.
        this.cookie = value && !/max-age=0|expires=thu, 01 jan 1970/i.test(sc) ? pair : null;
      }
    }
    return { status: res.status, body: parsed as T, text, headers: res.headers, setCookies };
  }

  get<T = any>(path: string, opts?: ReqOpts) {
    return this.req<T>('GET', path, undefined, opts);
  }
  post<T = any>(path: string, body: unknown = {}, opts?: ReqOpts) {
    return this.req<T>('POST', path, body, opts);
  }
  put<T = any>(path: string, body: unknown = {}, opts?: ReqOpts) {
    return this.req<T>('PUT', path, body, opts);
  }
  patch<T = any>(path: string, body: unknown = {}, opts?: ReqOpts) {
    return this.req<T>('PATCH', path, body, opts);
  }
  del<T = any>(path: string, opts?: ReqOpts) {
    return this.req<T>('DELETE', path, undefined, opts);
  }
}

/** Anonymous client (no cookie). */
export function anon(): Client {
  return new Client();
}

/** Log in as a member (tap-to-enter, optional PIN). Throws unless 200 + cookie. */
export async function login(memberId: number, pin?: string): Promise<Client> {
  const c = new Client();
  const res = await c.post('/api/auth/login', pin === undefined ? { memberId } : { memberId, pin });
  if (res.status !== 200 || !c.cookie) {
    throw new Error(`login(${memberId}) failed: ${res.status} ${res.text} cookie=${c.cookie}`);
  }
  c.member = res.body?.member;
  return c;
}

export async function loginAll(): Promise<Record<number, Client>> {
  const out: Record<number, Client> = {};
  for (const id of ALL_IDS) out[id] = await login(id);
  return out;
}

export function sha256(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}

// ---------------------------------------------------------------------------
// Room clock (always from the server, never the local clock)
// ---------------------------------------------------------------------------
export async function meta(client: Client): Promise<Meta> {
  const res = await client.get<Meta>('/api/meta');
  if (res.status !== 200) throw new Error(`GET /api/meta → ${res.status} ${res.text}`);
  return res.body;
}

/** Pure calendar arithmetic on a YYYY-MM-DD string (timezone-free). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Sockets
// ---------------------------------------------------------------------------
const openSockets = new Set<AppSocket>();

/** Connects with the client's session cookie; resolves once connected (rejects on connect_error). */
export function connectSocket(client: Client | null, opts: { cookie?: string } = {}): Promise<AppSocket> {
  const cookie = opts.cookie ?? client?.cookie ?? undefined;
  const socket: AppSocket = io(server().url, {
    path: '/socket.io',
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    timeout: 5000,
    extraHeaders: cookie ? { cookie } : {},
  });
  openSockets.add(socket);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 6000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Resolves with the first `event` payload matching `predicate`, or rejects after `timeout` ms. */
export function waitForEvent<T = any>(
  socket: AppSocket,
  event: string,
  timeout = 2000,
  predicate: (payload: T) => boolean = () => true,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const s = socket as unknown as Socket;
    const handler = (payload: T) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      s.off(event, handler);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      s.off(event, handler);
      reject(new Error(`timed out after ${timeout} ms waiting for socket event "${event}"`));
    }, timeout);
    s.on(event, handler);
  });
}

/** Collect every `event` payload received during `ms` milliseconds. */
export function collectEvents<T = any>(socket: AppSocket, event: string, ms: number): Promise<T[]> {
  return new Promise((resolve) => {
    const s = socket as unknown as Socket;
    const got: T[] = [];
    const handler = (p: T) => got.push(p);
    s.on(event, handler);
    setTimeout(() => {
      s.off(event, handler);
      resolve(got);
    }, ms);
  });
}

export function closeSockets(): void {
  for (const s of openSockets) s.disconnect();
  openSockets.clear();
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A real 1×1 PNG. */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
export const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

/** Standard error envelope check. */
export function expectError(res: Res, status: number, code?: string): void {
  const detail = `${res.status} ${res.text.slice(0, 300)}`;
  if (res.status !== status) throw new Error(`expected HTTP ${status}${code ? ` ${code}` : ''}, got ${detail}`);
  if (typeof res.body?.error?.message !== 'string' || typeof res.body?.error?.code !== 'string') {
    throw new Error(`error body is not { error: { code, message } }: ${detail}`);
  }
  if (code && res.body.error.code !== code) throw new Error(`expected error code "${code}", got ${detail}`);
}

/** Standard per-file hooks. */
export async function setupFile(): Promise<void> {
  await startTestServer();
  await resetData();
}

export async function teardownFile(): Promise<void> {
  closeSockets();
  await stopTestServer();
  await closeDb();
}
