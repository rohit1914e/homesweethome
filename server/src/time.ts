// The room clock lives in PostgreSQL (room_today(), booking_window_end() in 001_init.sql)
// so the API, the triggers and the UI can never disagree about what "today" is.
import { query, type Db } from './db.js';

export const ROOM_TIMEZONE = 'Asia/Kolkata';
export const BOOKING_WINDOW_DAYS = 6; // today + next 5 days

export interface RoomClock {
  today: string;
  windowEnd: string;
  serverTime: string;
}

export async function roomClock(db?: Db): Promise<RoomClock> {
  const { rows } = await query<{ today: string; window_end: string; now: Date }>(
    'SELECT room_today() AS today, booking_window_end() AS window_end, now() AS now',
    [],
    db,
  );
  return { today: rows[0].today, windowEnd: rows[0].window_end, serverTime: rows[0].now.toISOString() };
}
