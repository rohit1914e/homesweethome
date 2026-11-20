// Rohit-only house settings: PIN resets, remote sign-out, backup & restore.
import { Router } from 'express';
import { destroyMemberSessions, requireAdmin, requireAuth } from '../auth.js';
import { BackupInvalidError, exportData, importData } from '../backup.js';
import { query, withTx } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { MEMBER_IDS } from '../members.js';
import { broadcast, revokeMemberSockets } from '../realtime.js';
import { idParam, parse, z } from '../validate.js';

export function adminRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireAdmin);

  const memberId = (raw: unknown) => {
    const id = parse(idParam, raw);
    if (!MEMBER_IDS.includes(id)) throw notFound('No such member.');
    return id;
  };

  router.delete('/members/:id/pin', async (req, res) => {
    await query('UPDATE members SET pin_hash = NULL WHERE id = $1', [memberId(req.params.id)]);
    res.status(204).end();
  });

  router.post('/members/:id/sign-out', async (req, res) => {
    const id = memberId(req.params.id);
    // Rohit signing himself out everywhere keeps his current session.
    const except = id === req.member!.id ? req.sessionTokenHash : undefined;
    await destroyMemberSessions(id, except);
    await revokeMemberSockets(id, { exceptTokenHash: except });
    res.status(204).end();
  });

  // ---- Places for GPS status (coordinates are visible to Rohit only) ----------
  const placeKind = z.enum(['home', 'college']);
  const placeSchema = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radiusM: z.number().int().min(25, 'Use a radius of at least 25 m.').max(10000, 'Use a radius of at most 10 km.'),
  });
  const toPlace = (r: { kind: 'home' | 'college'; lat: number; lng: number; radius_m: number; updated_at: Date }) => ({
    kind: r.kind, lat: r.lat, lng: r.lng, radiusM: r.radius_m, updatedAt: r.updated_at.toISOString(),
  });
  router.get('/places', async (_req, res) => {
    const { rows } = await query('SELECT kind, lat, lng, radius_m, updated_at FROM places ORDER BY kind DESC');
    res.json({ places: rows.map(toPlace) });
  });
  router.put('/places/:kind', async (req, res) => {
    const kind = parse(placeKind, req.params.kind);
    const p = parse(placeSchema, req.body);
    const { rows } = await query(
      `INSERT INTO places (kind, lat, lng, radius_m, updated_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (kind) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, radius_m = EXCLUDED.radius_m,
         updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING kind, lat, lng, radius_m, updated_at`,
      [kind, p.lat, p.lng, p.radiusM, req.member!.id],
    );
    res.json({ place: toPlace(rows[0]) });
  });
  router.delete('/places/:kind', async (req, res) => {
    await query('DELETE FROM places WHERE kind = $1', [parse(placeKind, req.params.kind)]);
    res.status(204).end();
  });

  router.get('/backup', async (_req, res) => {
    const data = await exportData();
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="homesweethome-backup-${day}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
  });

  router.post('/restore', async (req, res) => {
    const { backup } = parse(z.object({ backup: z.unknown() }), req.body);
    try {
      const restored = await withTx((client) => importData(backup, client));
      broadcast('menu:changed', { menuId: 0, action: 'updated' });
      broadcast('booking:changed', { bookingId: 0, date: '', action: 'created' });
      res.json({ restored });
    } catch (err) {
      if (err instanceof BackupInvalidError) throw new HttpError(422, 'backup_invalid', err.message);
      throw err;
    }
  });
  return router;
}
export default adminRouter;
