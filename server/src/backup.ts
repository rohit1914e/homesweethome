// Full-content backup and restore (Settings page for Rohit, scripts/backup.ts, scripts/restore.ts).
// Sessions and PIN hashes are never exported. Restore validates the whole file first, then
// replaces all content inside the caller's transaction.
import type pg from 'pg';
import { pool, type Db } from './db.js';
import { MEMBERS } from './members.js';
import { z } from './validate.js';

export const BACKUP_APP = 'homesweethome';
export const BACKUP_VERSION = 1;

/** Content tables in insert order (parents first). */
export const BACKUP_TABLES = [
  'members',
  'cooking_menus',
  'cooking_votes',
  'washing_bookings',
  'chat_messages',
  'chat_reads',
  'notifications',
  'cleaning_tasks',
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

// ---- Shape -----------------------------------------------------------------
const ts = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Expected a timestamp.');
const tsNull = ts.nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date.');
const memberId = z.number().int().min(1).max(6);
const id = z.number().int().positive();

const schemas = {
  members: z.object({
    id: memberId,
    bio: z.string().max(280).default(''),
    last_seen_at: tsNull.default(null),
    created_at: ts.optional(),
  }),
  cooking_menus: z.object({
    id,
    menu_date: date,
    title: z.string().min(1).max(120),
    description: z.string().max(1000).default(''),
    image: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Expected base64 image data.').nullable().default(null),
    image_mime: z.enum(['image/jpeg', 'image/png', 'image/webp']).nullable().default(null),
    status: z.enum(['open', 'closed']),
    created_by: memberId,
    created_at: ts,
    updated_at: ts,
    closed_at: tsNull,
  }),
  cooking_votes: z.object({
    menu_id: id,
    member_id: memberId,
    choice: z.enum(['want', 'dont_want']),
    created_at: ts,
    updated_at: ts,
  }),
  washing_bookings: z.object({
    id,
    booking_date: date,
    member_id: memberId,
    booked_by: memberId,
    created_at: ts,
    cancelled_at: tsNull,
    cancelled_by: memberId.nullable(),
  }),
  cleaning_tasks: z.object({
    id,
    member_id: memberId,
    task_date: date,
    category: z.enum(['floor', 'wall', 'bathroom', 'dusting', 'sweeping', 'mopping', 'custom']),
    custom_title: z.string().max(120).nullable(),
    instructions: z.string().max(1000),
    status: z.enum(['pending', 'done']),
    completed_at: tsNull,
    created_by: memberId,
    created_at: ts,
    updated_at: ts,
  }),
  chat_messages: z.object({
    id,
    member_id: memberId,
    body: z.string().min(1).max(2000),
    client_id: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Expected a UUID.')
      .nullable()
      .default(null),
    created_at: ts,
  }),
  chat_reads: z.object({
    member_id: memberId,
    last_read_message_id: z.number().int().min(0),
    updated_at: ts,
  }),
  notifications: z.object({
    id,
    member_id: memberId,
    kind: z.enum([
      'menu_published',
      'menu_updated',
      'menu_closed',
      'vote_cast',
      'booking_created',
      'booking_cancelled',
      'chat_message',
      'cleaning_assigned',
      'cleaning_completed',
    ]),
    title: z.string(),
    body: z.string().default(''),
    link: z.string().default('/'),
    actor_id: memberId.nullable(),
    dedupe_key: z.string().nullable().default(null),
    count: z.number().int().min(1).default(1),
    created_at: ts,
    read_at: tsNull,
  }),
} satisfies Record<BackupTable, z.ZodTypeAny>;

export const backupSchema = z.object({
  app: z.literal(BACKUP_APP, { message: 'This is not a HomeSweetHome backup file.' }),
  version: z.literal(BACKUP_VERSION, { message: 'This backup was made by an unsupported version.' }),
  exportedAt: ts,
  tables: z.object({
    members: z.array(schemas.members).default([]),
    cooking_menus: z.array(schemas.cooking_menus).default([]),
    cooking_votes: z.array(schemas.cooking_votes).default([]),
    washing_bookings: z.array(schemas.washing_bookings).default([]),
    chat_messages: z.array(schemas.chat_messages).default([]),
    chat_reads: z.array(schemas.chat_reads).default([]),
    notifications: z.array(schemas.notifications).default([]),
    cleaning_tasks: z.array(schemas.cleaning_tasks).default([]), // absent in older backups
  }),
});

export type BackupFile = z.infer<typeof backupSchema>;

export class BackupInvalidError extends Error {}

/** Validates an untrusted backup object. Throws BackupInvalidError with a readable message. */
export function parseBackup(data: unknown): BackupFile {
  const result = backupSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path?.length ? ` (${issue.path.join('.')})` : '';
    throw new BackupInvalidError(`${issue?.message ?? 'Invalid backup file.'}${where}`);
  }
  return result.data;
}

// ---- Export ----------------------------------------------------------------
const EXPORT_SQL: Record<BackupTable, string> = {
  members: 'SELECT id, slug, name, is_admin, bio, last_seen_at, created_at FROM members ORDER BY id',
  cooking_menus: `SELECT id, menu_date, title, description, image, image_mime, status, created_by,
                         created_at, updated_at, closed_at FROM cooking_menus ORDER BY id`,
  cooking_votes: 'SELECT menu_id, member_id, choice, created_at, updated_at FROM cooking_votes ORDER BY menu_id, member_id',
  washing_bookings: `SELECT id, booking_date, member_id, booked_by, created_at, cancelled_at, cancelled_by
                       FROM washing_bookings ORDER BY id`,
  chat_messages: 'SELECT id, member_id, body, client_id, created_at FROM chat_messages ORDER BY id',
  chat_reads: 'SELECT member_id, last_read_message_id, updated_at FROM chat_reads ORDER BY member_id',
  notifications: `SELECT id, member_id, kind, title, body, link, actor_id, dedupe_key, count, created_at, read_at
                    FROM notifications ORDER BY id`,
  cleaning_tasks: `SELECT id, member_id, task_date, category, custom_title, instructions, status, completed_at,
                          created_by, created_at, updated_at FROM cleaning_tasks ORDER BY id`,
};

function jsonValue(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return v.toString('base64');
  return v;
}

async function readAll(db: Db): Promise<Record<BackupTable, Record<string, unknown>[]>> {
  const out = {} as Record<BackupTable, Record<string, unknown>[]>;
  for (const table of BACKUP_TABLES) {
    const { rows } = await db.query(EXPORT_SQL[table]);
    out[table] = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, jsonValue(v)])));
  }
  return out;
}

/** Consistent snapshot of every content table (one REPEATABLE READ transaction when given the pool). */
export async function exportData(db: Db = pool) {
  let tables: Record<BackupTable, Record<string, unknown>[]>;
  if (db === pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      tables = await readAll(client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } else {
    tables = await readAll(db);
  }
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), tables };
}

// ---- Import ----------------------------------------------------------------
/** Insert rows via json_populate_recordset so PostgreSQL does all the type conversion. */
async function insertJson(client: pg.PoolClient, table: BackupTable, columns: string[], rows: object[]): Promise<void> {
  if (rows.length === 0) return;
  const cols = columns.join(', ');
  const CHUNK = 2000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await client.query(
      `INSERT INTO ${table} (${cols}) SELECT ${cols} FROM json_populate_recordset(NULL::${table}, $1::json)`,
      [JSON.stringify(rows.slice(i, i + CHUNK))],
    );
  }
}

async function resetSequence(client: pg.PoolClient, table: string): Promise<void> {
  await client.query(
    `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT max(id) FROM ${table}), 0) + 1, false)`,
    [table],
  );
}

/**
 * Replaces all content with the backup. MUST be called inside a transaction (`withTx`), so any
 * failure leaves the database exactly as it was. Members are upserted: names/slugs/admin come
 * from members.ts, bios and last-seen from the backup, PIN hashes are kept as they are.
 * Returns the number of rows restored per table.
 */
export async function importData(data: unknown, client: pg.PoolClient): Promise<Record<BackupTable, number>> {
  const backup = parseBackup(data); // validate everything before touching anything
  const t = backup.tables;

  const known = new Map<number, (typeof MEMBERS)[number]>(MEMBERS.map((m) => [m.id, m]));
  const members = t.members.filter((m) => known.has(m.id));
  for (const m of members) {
    const ref = known.get(m.id)!;
    await client.query(
      `INSERT INTO members (id, slug, name, is_admin, bio, last_seen_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))
       ON CONFLICT (id) DO UPDATE SET bio = EXCLUDED.bio, last_seen_at = EXCLUDED.last_seen_at`,
      [m.id, ref.slug, ref.name, ref.isAdmin, m.bio, m.last_seen_at, m.created_at ?? null],
    );
  }

  // Historical rows legitimately break "live" rules (past booking dates, votes on closed menus).
  await client.query('ALTER TABLE washing_bookings DISABLE TRIGGER washing_bookings_in_window');
  await client.query('ALTER TABLE cooking_votes DISABLE TRIGGER cooking_votes_require_open_menu');

  await client.query(
    'TRUNCATE cleaning_tasks, notifications, chat_reads, chat_messages, washing_bookings, cooking_votes, cooking_menus RESTART IDENTITY',
  );

  for (const m of t.cooking_menus) {
    await client.query(
      `INSERT INTO cooking_menus (id, menu_date, title, description, image, image_mime, status, created_by,
                                  created_at, updated_at, closed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        m.id,
        m.menu_date,
        m.title,
        m.description,
        m.image === null ? null : Buffer.from(m.image, 'base64'),
        m.image === null ? null : m.image_mime,
        m.status,
        m.created_by,
        m.created_at,
        m.updated_at,
        m.closed_at,
      ],
    );
  }
  await insertJson(client, 'cooking_votes', ['menu_id', 'member_id', 'choice', 'created_at', 'updated_at'], t.cooking_votes);
  await insertJson(
    client,
    'washing_bookings',
    ['id', 'booking_date', 'member_id', 'booked_by', 'created_at', 'cancelled_at', 'cancelled_by'],
    t.washing_bookings,
  );
  await insertJson(client, 'chat_messages', ['id', 'member_id', 'body', 'client_id', 'created_at'], t.chat_messages);
  await insertJson(client, 'chat_reads', ['member_id', 'last_read_message_id', 'updated_at'], t.chat_reads);
  await insertJson(
    client,
    'notifications',
    ['id', 'member_id', 'kind', 'title', 'body', 'link', 'actor_id', 'dedupe_key', 'count', 'created_at', 'read_at'],
    t.notifications,
  );

  await insertJson(
    client,
    'cleaning_tasks',
    ['id', 'member_id', 'task_date', 'category', 'custom_title', 'instructions', 'status', 'completed_at', 'created_by', 'created_at', 'updated_at'],
    t.cleaning_tasks,
  );

  await client.query('ALTER TABLE washing_bookings ENABLE TRIGGER washing_bookings_in_window');
  await client.query('ALTER TABLE cooking_votes ENABLE TRIGGER cooking_votes_require_open_menu');

  for (const table of ['cooking_menus', 'washing_bookings', 'chat_messages', 'notifications', 'cleaning_tasks']) {
    await resetSequence(client, table);
  }

  return {
    members: members.length,
    cooking_menus: t.cooking_menus.length,
    cooking_votes: t.cooking_votes.length,
    washing_bookings: t.washing_bookings.length,
    chat_messages: t.chat_messages.length,
    chat_reads: t.chat_reads.length,
    notifications: t.notifications.length,
    cleaning_tasks: t.cleaning_tasks.length,
  };
}
