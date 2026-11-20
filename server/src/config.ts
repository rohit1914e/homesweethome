// All runtime configuration comes from environment variables (see .env.example).
// No secrets are ever shipped to the browser bundle.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Walk up from this file to the directory holding package.json (works from src/ under tsx and from dist/). */
function findProjectRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'server', 'migrations'))) return dir;
    dir = resolve(dir, '..');
  }
  return process.cwd();
}

const env = process.env;
const nodeEnv = env.NODE_ENV ?? 'development';
const isProd = nodeEnv === 'production';
const databaseUrl = env.DATABASE_URL ?? '';

function sslFor(url: string): boolean {
  if (env.DATABASE_SSL === 'true') return true;
  if (env.DATABASE_SSL === 'false') return false;
  // Render *external* URLs (…render.com) require TLS; the internal URL (dpg-…-a) and localhost do not.
  try {
    return new URL(url).hostname.endsWith('.render.com');
  } catch {
    return false;
  }
}

const projectRoot = findProjectRoot();

export const config = {
  nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',
  port: Number(env.PORT ?? 3000),
  host: env.HOST ?? '0.0.0.0',
  databaseUrl,
  databaseSsl: sslFor(databaseUrl),
  sessionDays: Number(env.SESSION_DAYS ?? 30),
  cookieName: 'hsh_session',
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProd,
  /** Render sits behind one proxy hop; needed for correct client IPs (rate limits) and secure cookies. */
  trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) : isProd ? 1 : 0,
  projectRoot,
  migrationsDir: join(projectRoot, 'server', 'migrations'),
  clientDist: join(projectRoot, 'client', 'dist'),
  avatarsDir: join(projectRoot, 'client', isProd ? 'dist' : 'public', 'avatars'),
} as const;

export function assertConfig(): void {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env (local) or link the Render database.');
  }
}
