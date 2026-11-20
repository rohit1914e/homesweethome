// All display formatting uses the room timezone so every member sees the same day.
export const ROOM_TZ = 'Asia/Kolkata';

/** 'YYYY-MM-DD' → Date at noon UTC (safe for weekday/month formatting in any zone). */
export function dateFromISO(d: string): Date {
  return new Date(`${d}T12:00:00Z`);
}

export function addDays(d: string, n: number): string {
  const x = dateFromISO(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

export function formatDay(d: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }): string {
  return new Intl.DateTimeFormat('en-IN', { ...opts, timeZone: 'UTC' }).format(dateFromISO(d));
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: ROOM_TZ }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: ROOM_TZ }).format(new Date(iso));
}

/** 'YYYY-MM-DD' of an ISO timestamp in the room timezone. */
export function roomDateOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ROOM_TZ }).format(new Date(iso));
}
