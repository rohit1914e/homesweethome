// Keep-awake ping for Render's free tier, used sparingly.
// Render spins a free web service down after 15 min without INBOUND traffic. While the service is
// awake, a request to its own public URL every 10 min comes back in through Render's edge and keeps
// it up. It cannot wake a sleeping service (a sleeping server runs no code), and it only runs during
// daytime hours (IST) so the workspace's shared 750 free hours/month are not burnt overnight.
//   KEEP_AWAKE=off                   disable
//   KEEP_AWAKE_URL=<url>             defaults to RENDER_EXTERNAL_URL (set by Render automatically)
//   KEEP_AWAKE_HOURS=7-23            IST hours [start, end) during which pings are sent
const IST_OFFSET_MS = 5.5 * 3_600_000;
export const KEEP_AWAKE_INTERVAL_MS = 10 * 60_000; // < 15 min idle timeout

export function parseHours(v: string | undefined): [number, number] {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(v?.trim() ?? '');
  const start = m ? Number(m[1]) : 7;
  const end = m ? Number(m[2]) : 23;
  return start >= 0 && end <= 24 && start < end ? [start, end] : [7, 23];
}

export function istHour(now: Date): number {
  return new Date(now.getTime() + IST_OFFSET_MS).getUTCHours();
}

export function shouldPing(now: Date, [start, end]: [number, number]): boolean {
  const h = istHour(now);
  return h >= start && h < end;
}

export interface KeepAliveOptions {
  url?: string;
  intervalMs?: number;
  hours?: [number, number];
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

/** Returns a stop function, or null when disabled (no public URL, or KEEP_AWAKE=off). */
export function startKeepAlive(opts: KeepAliveOptions = {}, env = process.env): (() => void) | null {
  if (env.KEEP_AWAKE === 'off') return null;
  const base = opts.url ?? env.KEEP_AWAKE_URL ?? env.RENDER_EXTERNAL_URL;
  if (!base) return null;
  const url = new URL('/api/health', base).toString();
  const hours = opts.hours ?? parseHours(env.KEEP_AWAKE_HOURS);
  const now = opts.now ?? (() => new Date());
  const doFetch = opts.fetchImpl ?? fetch;
  const tick = async () => {
    if (!shouldPing(now(), hours)) return;
    try {
      const res = await doFetch(url, { headers: { 'User-Agent': 'homesweethome-keepalive' }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) console.warn(`[keepalive] ${url} answered ${res.status}`);
    } catch (err) {
      console.warn('[keepalive] ping failed:', (err as Error).message);
    }
  };
  const t = setInterval(() => void tick(), opts.intervalMs ?? KEEP_AWAKE_INTERVAL_MS);
  t.unref();
  console.log(`[keepalive] pinging ${url} every ${Math.round((opts.intervalMs ?? KEEP_AWAKE_INTERVAL_MS) / 60000)} min, ${hours[0]}:00-${hours[1]}:00 IST`);
  return () => clearInterval(t);
}
