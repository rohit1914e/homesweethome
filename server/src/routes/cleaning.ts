// /api/cleaning — room cleaning duties. Only Rohit assigns, edits, reassigns or deletes.
// Members see their own duties and mark their own tasks done; Rohit sees everyone's.
import { Router } from 'express';
import type { CleaningCategory, CleaningTask } from '../../../shared/types.js';
import { requireAdmin, requireAuth } from '../auth.js';
import { query, withTx } from '../db.js';
import { forbidden, notFound } from '../errors.js';
import { MEMBERS, MEMBER_IDS } from '../members.js';
import { notify } from '../notify.js';
import { broadcast } from '../realtime.js';
import { idParam, isoDate, parse, z } from '../validate.js';

export const CLEANING_LABELS: Record<CleaningCategory, string> = {
  floor: 'Floor cleaning',
  wall: 'Wall cleaning',
  bathroom: 'Bathroom cleaning',
  dusting: 'Dusting',
  sweeping: 'Room sweeping',
  mopping: 'Mopping',
  custom: 'Custom task',
};
const CATEGORIES = Object.keys(CLEANING_LABELS) as [CleaningCategory, ...CleaningCategory[]];

const memberId = z.number().int().refine((id) => MEMBER_IDS.includes(id), 'Choose one of the six members.');
const customTitle = z.string().trim().min(1, 'Describe the custom task.').max(120);
const instructions = z.string().max(1000);

const createSchema = z
  .object({
    memberId,
    date: isoDate,
    categories: z.array(z.enum(CATEGORIES)).min(1, 'Pick at least one task.').max(7),
    customTitle: customTitle.optional(),
    instructions: instructions.optional(),
  })
  .refine((b) => !b.categories.includes('custom') || !!b.customTitle, { message: 'Describe the custom task.', path: ['customTitle'] });

const updateSchema = z.object({
  memberId: memberId.optional(),
  date: isoDate.optional(),
  category: z.enum(CATEGORIES).optional(),
  customTitle: customTitle.nullable().optional(),
  instructions: instructions.optional(),
});

const listSchema = z.object({ status: z.enum(['pending', 'done']).optional() });

interface Row {
  id: number;
  member_id: number;
  task_date: string;
  category: CleaningCategory;
  custom_title: string | null;
  instructions: string;
  status: 'pending' | 'done';
  completed_at: Date | null;
  created_by: number;
  created_at: Date;
  updated_at: Date;
}
const COLS = 'id, member_id, task_date, category, custom_title, instructions, status, completed_at, created_by, created_at, updated_at';

const toTask = (r: Row): CleaningTask => ({
  id: r.id,
  memberId: r.member_id,
  date: r.task_date,
  category: r.category,
  customTitle: r.custom_title,
  instructions: r.instructions,
  status: r.status,
  completedAt: r.completed_at?.toISOString() ?? null,
  createdBy: r.created_by,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const taskName = (t: Pick<CleaningTask, 'category' | 'customTitle'>) =>
  t.category === 'custom' ? (t.customTitle ?? 'Custom task') : CLEANING_LABELS[t.category];
const nameOf = (id: number) => MEMBERS.find((m) => m.id === id)?.name ?? 'Someone';
const dayLabel = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));

async function getTask(id: number): Promise<CleaningTask> {
  const { rows } = await query<Row>(`SELECT ${COLS} FROM cleaning_tasks WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound('That cleaning task no longer exists.');
  return toTask(rows[0]);
}

const router = Router();
router.use(requireAuth);

router.get('/tasks', async (req, res) => {
  const { status } = parse(listSchema, req.query);
  const me = req.member!;
  const where: string[] = [];
  const params: unknown[] = [];
  if (!me.isAdmin) {
    params.push(me.id);
    where.push(`member_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  // Pending: soonest first. Done: most recently completed first.
  const { rows } = await query<Row>(
    `SELECT ${COLS} FROM cleaning_tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY status = 'done', CASE WHEN status = 'pending' THEN task_date END ASC,
              completed_at DESC NULLS LAST, id DESC
     LIMIT 300`,
    params,
  );
  res.json({ tasks: rows.map(toTask) });
});

router.post('/tasks', requireAdmin, async (req, res) => {
  const b = parse(createSchema, req.body);
  const actor = req.member!.id;
  const tasks = await withTx(async (client) => {
    const out: CleaningTask[] = [];
    for (const category of [...new Set(b.categories)]) {
      const { rows } = await client.query<Row>(
        `INSERT INTO cleaning_tasks (member_id, task_date, category, custom_title, instructions, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLS}`,
        [b.memberId, b.date, category, category === 'custom' ? b.customTitle : null, b.instructions ?? '', actor],
      );
      out.push(toTask(rows[0]));
    }
    return out;
  });
  for (const t of tasks) broadcast('cleaning:changed', { taskId: t.id, action: 'created' });
  if (b.memberId !== actor) {
    await notify({
      recipients: [b.memberId],
      actorId: actor,
      kind: 'cleaning_assigned',
      title: tasks.length > 1 ? `${tasks.length} cleaning duties for you` : 'New cleaning duty for you',
      body: `${tasks.map(taskName).join(', ')} on ${dayLabel(b.date)}`,
      link: '/cleaning',
    });
  }
  res.status(201).json({ tasks });
});

router.patch('/tasks/:id', requireAdmin, async (req, res) => {
  const id = parse(idParam, req.params.id);
  const b = parse(updateSchema, req.body);
  const before = await getTask(id);
  const category = b.category ?? before.category;
  const custom = category === 'custom' ? (b.customTitle !== undefined ? b.customTitle : before.customTitle) : null;
  if (category === 'custom' && !custom) parse(customTitle, '');
  const { rows } = await query<Row>(
    `UPDATE cleaning_tasks SET member_id = $2, task_date = $3, category = $4, custom_title = $5,
            instructions = $6, updated_at = now()
     WHERE id = $1 RETURNING ${COLS}`,
    [id, b.memberId ?? before.memberId, b.date ?? before.date, category, custom, b.instructions ?? before.instructions],
  );
  if (!rows[0]) throw notFound('That cleaning task no longer exists.');
  const task = toTask(rows[0]);
  broadcast('cleaning:changed', { taskId: id, action: 'updated' });
  if (task.memberId !== before.memberId && task.memberId !== req.member!.id) {
    await notify({
      recipients: [task.memberId],
      actorId: req.member!.id,
      kind: 'cleaning_assigned',
      title: 'Cleaning duty reassigned to you',
      body: `${taskName(task)} on ${dayLabel(task.date)}`,
      link: '/cleaning',
    });
  }
  res.json({ task });
});

router.delete('/tasks/:id', requireAdmin, async (req, res) => {
  const id = parse(idParam, req.params.id);
  const { rowCount } = await query('DELETE FROM cleaning_tasks WHERE id = $1', [id]);
  if (!rowCount) throw notFound('That cleaning task no longer exists.');
  broadcast('cleaning:changed', { taskId: id, action: 'deleted' });
  res.status(204).end();
});

/** Mark done / not done: the assigned member (or Rohit). */
async function setStatus(id: number, memberIdActor: number, isAdmin: boolean, done: boolean) {
  const task = await getTask(id);
  if (task.memberId !== memberIdActor && !isAdmin) throw forbidden('You can only update your own cleaning tasks.');
  const { rows } = await query<Row>(
    `UPDATE cleaning_tasks SET status = $2, completed_at = ${done ? 'COALESCE(completed_at, now())' : 'NULL'}, updated_at = now()
     WHERE id = $1 RETURNING ${COLS}`,
    [id, done ? 'done' : 'pending'],
  );
  return { before: task, task: toTask(rows[0]) };
}

router.post('/tasks/:id/complete', async (req, res) => {
  const me = req.member!;
  const { before, task } = await setStatus(parse(idParam, req.params.id), me.id, me.isAdmin, true);
  broadcast('cleaning:changed', { taskId: task.id, action: 'completed' });
  if (before.status === 'pending' && !me.isAdmin) {
    await notify({
      recipients: 'admin',
      actorId: me.id,
      kind: 'cleaning_completed',
      title: `${nameOf(me.id)} finished a cleaning task`,
      body: `${taskName(task)} on ${dayLabel(task.date)}`,
      link: '/cleaning',
    });
  }
  res.json({ task });
});

router.post('/tasks/:id/reopen', async (req, res) => {
  const me = req.member!;
  const { task } = await setStatus(parse(idParam, req.params.id), me.id, me.isAdmin, false);
  broadcast('cleaning:changed', { taskId: task.id, action: 'reopened' });
  res.json({ task });
});

export default router;
