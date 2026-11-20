import { describe, expect, it } from 'vitest';
import { parseHours, shouldPing, startKeepAlive } from '../src/keepalive.js';

const ist = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 20, h, m) - 5.5 * 3_600_000);

describe('keep-awake ping', () => {
  it('only pings during the configured IST hours (default 07:00–23:00)', () => {
    const hours = parseHours(undefined);
    expect(hours).toEqual([7, 23]);
    expect(shouldPing(ist(6, 59), hours)).toBe(false);
    expect(shouldPing(ist(7, 0), hours)).toBe(true);
    expect(shouldPing(ist(22, 59), hours)).toBe(true);
    expect(shouldPing(ist(23, 0), hours)).toBe(false);
    expect(shouldPing(ist(3), hours)).toBe(false);
    expect(parseHours('8-15')).toEqual([8, 15]);
    expect(parseHours('garbage')).toEqual([7, 23]);
    expect(parseHours('20-5')).toEqual([7, 23]);
  });

  it('is disabled without a public URL or with KEEP_AWAKE=off', () => {
    expect(startKeepAlive({}, {})).toBeNull();
    expect(startKeepAlive({}, { RENDER_EXTERNAL_URL: 'https://x.onrender.com', KEEP_AWAKE: 'off' })).toBeNull();
  });

  it('pings <url>/api/health on the interval inside hours, and never outside them', async () => {
    const calls: string[] = [];
    const fake = (async (u: string) => {
      calls.push(String(u));
      return new Response('{"ok":true}');
    }) as unknown as typeof fetch;
    const stopDay = startKeepAlive({ intervalMs: 20, now: () => ist(10), fetchImpl: fake }, { RENDER_EXTERNAL_URL: 'https://hsh.onrender.com' })!;
    await new Promise((r) => setTimeout(r, 110));
    stopDay();
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(new Set(calls)).toEqual(new Set(['https://hsh.onrender.com/api/health']));
    calls.length = 0;
    const stopNight = startKeepAlive({ intervalMs: 20, now: () => ist(2), fetchImpl: fake }, { RENDER_EXTERNAL_URL: 'https://hsh.onrender.com' })!;
    await new Promise((r) => setTimeout(r, 110));
    stopNight();
    expect(calls).toEqual([]);
  });

  it('a failing ping is logged and never throws', async () => {
    const boom = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const stop = startKeepAlive({ intervalMs: 10, now: () => ist(12), fetchImpl: boom }, { RENDER_EXTERNAL_URL: 'https://hsh.onrender.com' })!;
    await new Promise((r) => setTimeout(r, 50));
    stop();
  });
});
