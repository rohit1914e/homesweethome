import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { pool } from '../db.js';
import { statusWindowAt } from '../../../shared/statusWindow.js';
import { BOOKING_WINDOW_DAYS, ROOM_TIMEZONE, roomClock, statusNow } from '../time.js';

export function metaRouter(): Router {
  const router = Router();
  router.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, db: true });
    } catch {
      res.status(503).json({ ok: false, db: false });
    }
  });
  router.get('/meta', requireAuth, async (_req, res) => {
    const c = await roomClock();
    // Only whether each place exists — never its coordinates.
    const places = await pool.query<{ kind: string }>('SELECT kind FROM places');
    const has = (k: string) => places.rows.some((p) => p.kind === k);
    res.json({
      today: c.today,
      timezone: ROOM_TIMEZONE,
      serverTime: c.serverTime,
      bookingWindow: { start: c.today, end: c.windowEnd, days: BOOKING_WINDOW_DAYS },
      statusHours: { open: statusWindowAt(statusNow()).open, start: '08:00', end: '15:00' },
      geofence: { home: has('home'), college: has('college') },
    });
  });
  return router;
}
export default metaRouter;
