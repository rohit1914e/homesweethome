import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { query } from '../db.js';
import { NOTIFICATION_COLUMNS, toNotification } from '../notify.js';
import { parse, z } from '../validate.js';

export function notificationsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (req, res) => {
    const id = req.member!.id;
    const [list, unread] = await Promise.all([
      query(`SELECT ${NOTIFICATION_COLUMNS} FROM notifications WHERE member_id = $1 ORDER BY created_at DESC, id DESC LIMIT 30`, [id]),
      query<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE member_id = $1 AND read_at IS NULL', [id]),
    ]);
    res.json({ notifications: list.rows.map(toNotification), unread: unread.rows[0].n });
  });
  router.post('/read', async (req, res) => {
    const { ids } = parse(z.object({ ids: z.array(z.number().int().positive()).max(200).optional() }), req.body);
    if (ids?.length) {
      await query('UPDATE notifications SET read_at = now() WHERE member_id = $1 AND read_at IS NULL AND id = ANY($2)', [req.member!.id, ids]);
    } else {
      await query('UPDATE notifications SET read_at = now() WHERE member_id = $1 AND read_at IS NULL', [req.member!.id]);
    }
    res.status(204).end();
  });
  return router;
}
export default notificationsRouter;
