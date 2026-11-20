// Home / College status is shared only during college hours, 8 AM – 3 PM in the room's
// timezone (Asia/Kolkata, UTC+5:30, no DST). A status set before today's 08:00 is stale
// and stays hidden until the member updates it again. Used by both server and client.
export const STATUS_START_HOUR = 8;
export const STATUS_END_HOUR = 15;
const IST_OFFSET_MS = 5.5 * 3_600_000;

export interface StatusWindow {
  open: boolean;
  /** Today's 08:00 IST and 15:00 IST as instants. */
  start: Date;
  end: Date;
}

export function statusWindowAt(now: Date): StatusWindow {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const start = new Date(Date.UTC(y, m, d, STATUS_START_HOUR) - IST_OFFSET_MS);
  const end = new Date(Date.UTC(y, m, d, STATUS_END_HOUR) - IST_OFFSET_MS);
  return { open: now >= start && now < end, start, end };
}

/** True when a status updated at `updatedAt` should be shown at `now`. */
export function statusVisible(updatedAt: Date | string | null, now: Date): boolean {
  if (!updatedAt) return false;
  const w = statusWindowAt(now);
  return w.open && new Date(updatedAt) >= w.start;
}
