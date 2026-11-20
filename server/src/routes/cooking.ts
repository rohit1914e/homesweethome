// Cooking menus + votes. Only Rohit publishes/edits/closes; everyone votes once per menu
// (changeable while open). The DB triggers are the second line of defence for both rules.
import { Router, type Request } from 'express';
import type { Menu, MenuAction, Vote, VoteChoice } from '../../../shared/types.js';
import { requireAdmin, requireAuth } from '../auth.js';
import { query, raisedCode, withTx, pgCode, type Db } from '../db.js';
import { conflict, forbidden, notFound } from '../errors.js';
import { parseImageDataUrl } from '../images.js';
import { MEMBER_IDS } from '../members.js';
import { notify } from '../notify.js';
import { broadcast } from '../realtime.js';
import { idParam, isoDate, parse, z } from '../validate.js';

const router = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
/** A YYYY-MM-DD string that is also a real calendar date (rejects 2026-02-30). */
const realDate = isoDate.refine((d) => {
  const x = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(x.getTime()) && x.toISOString().slice(0, 10) === d;
}, 'That date does not exist.');

const title = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, 'Give the menu a title.').max(120, 'Keep the title under 120 characters.'));
const description = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().max(1000, 'Keep the description under 1000 characters.'));
// ~2 MB decoded is ~2.8 MB of base64; images.ts does the real check.
const image = z.string().max(3_000_000, 'That photo is larger than 2 MB. Pick a smaller one.');

const createSchema = z.object({
  title,
  description: description.optional(),
  menuDate: realDate,
  image: image.nullable().optional(),
});

const patchSchema = z
  .object({
    title: title.optional(),
    description: description.optional(),
    menuDate: realDate.optional(),
    image: image.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change.');

const voteSchema = z.object({
  choice: z.enum(['want', 'dont_want'], 'Choose "want" or "dont_want".'),
});

const historySchema = z.object({
  before: idParam.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ---------------------------------------------------------------------------
// Reading menus: one query, votes aggregated in SQL, image bytes never selected.
// ---------------------------------------------------------------------------
interface MenuRow {
  id: number;
  menu_date: string;
  title: string;
  description: string;
  has_image: boolean;
  status: 'open' | 'closed';
  created_by: number;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
  votes: Vote[];
}

const ISO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const MENU_SELECT = `
  SELECT m.id, m.menu_date, m.title, m.description, (m.image IS NOT NULL) AS has_image,
         m.status, m.created_by, m.created_at, m.updated_at, m.closed_at,
         COALESCE(v.votes, '[]'::json) AS votes
    FROM cooking_menus m
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
               'memberId', cv.member_id,
               'choice', cv.choice,
               'updatedAt', to_char(cv.updated_at AT TIME ZONE 'UTC', ${ISO_UTC})
             ) ORDER BY cv.member_id) AS votes
        FROM cooking_votes cv
       WHERE cv.menu_id = m.id
    ) v ON true`;

function toMenu(row: MenuRow, viewerId: number): Menu {
  const want = row.votes.filter((v) => v.choice === 'want').length;
  const dontWant = row.votes.filter((v) => v.choice === 'dont_want').length;
  const mine = row.votes.find((v) => v.memberId === viewerId);
  return {
    id: row.id,
    menuDate: row.menu_date,
    title: row.title,
    description: row.description,
    imageUrl: row.has_image ? `/api/cooking/menus/${row.id}/image?v=${row.updated_at.getTime()}` : null,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    votes: row.votes,
    tally: { want, dontWant, pending: Math.max(0, MEMBER_IDS.length - want - dontWant) },
    myVote: mine ? mine.choice : null,
  };
}

async function loadMenu(id: number, viewerId: number, db?: Db): Promise<Menu> {
  const { rows } = await query<MenuRow>(`${MENU_SELECT} WHERE m.id = $1`, [id], db);
  if (!rows[0]) throw notFound('That menu no longer exists.');
  return toMenu(rows[0], viewerId);
}

const actor = (req: Request) => req.member!;

/** 'YYYY-MM-DD' → "Tue 24 Nov" */
function shortDay(d: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .formatToParts(new Date(`${d}T12:00:00Z`));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}`;
}

function changed(menuId: number, action: MenuAction): void {
  try {
    broadcast('menu:changed', { menuId, action });
  } catch (err) {
    console.error('[cooking] broadcast failed:', (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Everyone
// ---------------------------------------------------------------------------
router.get('/today', async (req, res) => {
  const { rows } = await query<MenuRow>(
    `${MENU_SELECT} WHERE m.menu_date = room_today() ORDER BY m.id DESC`,
  );
  res.json({ menus: rows.map((r) => toMenu(r, actor(req).id)) });
});

router.get('/menus', async (req, res) => {
  const { before, limit } = parse(historySchema, req.query);
  let rows: MenuRow[];
  if (before === undefined) {
    ({ rows } = await query<MenuRow>(`${MENU_SELECT} WHERE m.menu_date >= room_today() - 1 ORDER BY m.menu_date DESC, m.id DESC LIMIT $1`, [limit + 1]));
  } else {
    // Keyset on (menu_date, id). If the cursor menu was deleted meanwhile, fall back to id order.
    const cursor = await query<{ menu_date: string }>('SELECT menu_date FROM cooking_menus WHERE id = $1', [before]);
    ({ rows } = cursor.rows[0]
      ? await query<MenuRow>(
          `${MENU_SELECT} WHERE m.menu_date >= room_today() - 1 AND (m.menu_date, m.id) < ($1::date, $2::int) ORDER BY m.menu_date DESC, m.id DESC LIMIT $3`,
          [cursor.rows[0].menu_date, before, limit + 1],
        )
      : await query<MenuRow>(`${MENU_SELECT} WHERE m.menu_date >= room_today() - 1 AND m.id < $1 ORDER BY m.menu_date DESC, m.id DESC LIMIT $2`, [
          before,
          limit + 1,
        ]));
  }
  const page = rows.slice(0, limit);
  res.json({
    menus: page.map((r) => toMenu(r, actor(req).id)),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  });
});

router.get('/menus/:id', async (req, res) => {
  const id = parse(idParam, req.params.id);
  res.json({ menu: await loadMenu(id, actor(req).id) });
});

router.get('/menus/:id/image', async (req, res) => {
  const id = parse(idParam, req.params.id);
  const { rows } = await query<{ image: Buffer | null; image_mime: string | null }>(
    'SELECT image, image_mime FROM cooking_menus WHERE id = $1',
    [id],
  );
  const row = rows[0];
  if (!row?.image || !row.image_mime) throw notFound('This menu has no photo.');
  res.setHeader('Content-Type', row.image_mime);
  res.setHeader('Content-Length', String(row.image.length));
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(row.image);
});

router.put('/menus/:id/vote', async (req, res) => {
  const id = parse(idParam, req.params.id);
  const { choice } = parse(voteSchema, req.body);
  const me = actor(req);
  let menu: Menu;
  try {
    menu = await withTx(async (db) => {
      await query(
        `INSERT INTO cooking_votes (menu_id, member_id, choice)
         VALUES ($1, $2, $3)
         ON CONFLICT (menu_id, member_id) DO UPDATE SET choice = EXCLUDED.choice, updated_at = now()`,
        [id, me.id, choice],
        db,
      );
      return loadMenu(id, me.id, db);
    });
  } catch (err) {
    const code = raisedCode(err);
    if (code === 'voting_closed') {
      const t = await query<{ title: string }>('SELECT title FROM cooking_menus WHERE id = $1', [id]);
      throw conflict('voting_closed', `Voting on ${t.rows[0]?.title ?? 'this menu'} is closed.`);
    }
    if (code === 'menu_not_found' || pgCode(err) === '23503') throw notFound('That menu no longer exists.');
    throw err;
  }
  changed(id, 'voted');
  if (!me.isAdmin) {
    void notify({
      recipients: 'admin',
      actorId: me.id,
      kind: 'vote_cast',
      title: `New votes on ${menu.title}`,
      body: `${me.name} ${(choice as VoteChoice) === 'want' ? 'wants it' : 'doesn’t want it'}. ${menu.tally.want} want, ${menu.tally.dontWant} don’t, ${menu.tally.pending} yet to reply.`,
      link: '/cooking',
      dedupeKey: `vote_cast:${id}`,
    });
  }
  res.json({ menu });
});

// ---------------------------------------------------------------------------
// Rohit only
// ---------------------------------------------------------------------------
function mapAuthorError(err: unknown): never {
  if (raisedCode(err) === 'menu_author_not_admin') throw forbidden('Only Rohit can publish menus.');
  throw err;
}

router.post('/menus', requireAdmin, async (req, res) => {
  const input = parse(createSchema, req.body);
  const img = input.image ? parseImageDataUrl(input.image) : null;
  const me = actor(req);
  const menu = await withTx(async (db) => {
    const { rows } = await query<{ id: number }>(
      `INSERT INTO cooking_menus (menu_date, title, description, image, image_mime, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [input.menuDate, input.title, input.description ?? '', img?.buffer ?? null, img?.mime ?? null, me.id],
      db,
    );
    return loadMenu(rows[0].id, me.id, db);
  }).catch(mapAuthorError);
  changed(menu.id, 'created');
  void notify({
    recipients: 'everyone-except-actor',
    actorId: me.id,
    kind: 'menu_published',
    title: `New menu: ${menu.title}`,
    body: `For ${shortDay(menu.menuDate)}. Tell Rohit if you want it.`,
    link: '/cooking',
  });
  res.status(201).json({ menu });
});

router.patch('/menus/:id', requireAdmin, async (req, res) => {
  const id = parse(idParam, req.params.id);
  const input = parse(patchSchema, req.body);
  const img = typeof input.image === 'string' ? parseImageDataUrl(input.image) : null;
  const me = actor(req);
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (input.title !== undefined) set('title', input.title);
  if (input.description !== undefined) set('description', input.description);
  if (input.menuDate !== undefined) set('menu_date', input.menuDate);
  if (input.image === null) {
    set('image', null);
    set('image_mime', null);
  } else if (img) {
    set('image', img.buffer);
    set('image_mime', img.mime);
  }
  params.push(id);
  const menu = await withTx(async (db) => {
    const r = await query(
      `UPDATE cooking_menus SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`,
      params,
      db,
    );
    if (r.rowCount === 0) throw notFound('That menu no longer exists.');
    return loadMenu(id, me.id, db);
  });
  changed(id, 'updated');
  void notify({
    recipients: 'everyone-except-actor',
    actorId: me.id,
    kind: 'menu_updated',
    title: `Menu updated: ${menu.title}`,
    body: `Rohit changed the menu for ${shortDay(menu.menuDate)}.`,
    link: '/cooking',
    dedupeKey: `menu_updated:${id}`,
  });
  res.json({ menu });
});

router.delete('/menus/:id', requireAdmin, async (req, res) => {
  const id = parse(idParam, req.params.id);
  const r = await query('DELETE FROM cooking_menus WHERE id = $1', [id]);
  if (r.rowCount === 0) throw notFound('That menu no longer exists.');
  changed(id, 'deleted');
  res.status(204).end();
});

router.post('/menus/:id/close', requireAdmin, async (req, res) => {
  const id = parse(idParam, req.params.id);
  const me = actor(req);
  const { menu, didClose } = await withTx(async (db) => {
    const r = await query(
      `UPDATE cooking_menus SET status = 'closed', closed_at = now()
        WHERE id = $1 AND status = 'open'`,
      [id],
      db,
    );
    return { menu: await loadMenu(id, me.id, db), didClose: r.rowCount === 1 };
  });
  if (didClose) {
    changed(id, 'closed');
    void notify({
      recipients: 'everyone-except-actor',
      actorId: me.id,
      kind: 'menu_closed',
      title: `Voting closed on ${menu.title}`,
      body: `Final count: ${menu.tally.want} want, ${menu.tally.dontWant} don’t.`,
      link: '/cooking',
    });
  }
  res.json({ menu });
});

router.post('/menus/:id/reopen', requireAdmin, async (req, res) => {
  const id = parse(idParam, req.params.id);
  const me = actor(req);
  const { menu, didOpen } = await withTx(async (db) => {
    const r = await query(
      `UPDATE cooking_menus SET status = 'open', closed_at = NULL
        WHERE id = $1 AND status = 'closed'`,
      [id],
      db,
    );
    return { menu: await loadMenu(id, me.id, db), didOpen: r.rowCount === 1 };
  });
  if (didOpen) changed(id, 'reopened');
  res.json({ menu });
});

export default router;
