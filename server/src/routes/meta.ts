import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { pool } from '../db.js';
import { BOOKING_WINDOW_DAYS, ROOM_TIMEZONE, roomClock } from '../time.js';

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
    res.json({
      today: c.today,
      timezone: ROOM_TIMEZONE,
      serverTime: c.serverTime,
      bookingWindow: { start: c.today, end: c.windowEnd, days: BOOKING_WINDOW_DAYS },
    });
  });
  return router;
}
export default metaRouter;
