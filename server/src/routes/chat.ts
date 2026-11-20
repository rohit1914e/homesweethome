// Group chat: history (keyset pagination), idempotent send, read receipts.
// Identity is ALWAYS req.member (set by requireAuth) — a sender id in the body is never read.
import { Router } from 'express';
import type { ChatMessage } from '../../../shared/types.js';
import { requireAuth } from '../auth.js';
import { query, withTx } from '../db.js';
import { HttpError } from '../errors.js';
import { notify } from '../notify.js';
import { broadcast } from '../realtime.js';
import { parse, z } from '../validate.js';

export const CHAT_MAX_LENGTH = 2000;
const RATE_LIMIT_COUNT = 20;
const RATE_LIMIT_WINDOW_MS = 10_000;

interface ChatRow {
  id: number;
  member_id: number;
  body: string;
  client_id: string | null;
  created_at: Date;
}

const COLUMNS = 'id, member_id, body, client_id, created_at';

function toMessage(r: ChatRow): ChatMessage {
  return {
    id: Number(r.id),
    memberId: Number(r.member_id),
    body: r.body,
    createdAt: new Date(r.created_at).toISOString(),
    clientId: r.client_id,
  };
}

// ---- Per-member send rate limit (in memory; one Node process serves everything) ----
const sendLog = new Map<number, number[]>();

function takeSendSlot(memberId: number): boolean {
  const now = Date.now();
  const recent = (sendLog.get(memberId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_COUNT) {
    sendLog.set(memberId, recent);
    return false;
  }
  recent.push(now);
  sendLog.set(memberId, recent);
  return true;
}

/** Test helper: forget all rate-limit history. */
export function resetChatRateLimit(): void {
  sendLog.clear();
}

// ---- Schemas ----
const listQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const sendBody = z.object({
  body: z
    .string({ error: 'Write a message first.' })
    .trim()
    .min(1, 'Write a message first.')
    .max(CHAT_MAX_LENGTH, `Keep messages under ${CHAT_MAX_LENGTH} characters.`),
  clientId: z.uuid('clientId must be a UUID.'),
});

const readBody = z.object({
  lastMessageId: z.coerce.number().int().nonnegative(),
});

function snippet(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

const router = Router();
router.use(requireAuth);

router.get('/messages', async (req, res) => {
  const { before, limit } = parse(listQuery, req.query);
  const { rows } = await query<ChatRow>(
    `SELECT ${COLUMNS} FROM chat_messages
      WHERE ($1::bigint IS NULL OR id < $1::bigint)
      ORDER BY id DESC
      LIMIT $2`,
    [before ?? null, limit + 1],
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse().map(toMessage);
  res.json({ messages: page, hasMore });
});

router.post('/messages', async (req, res) => {
  const me = req.member!;
  const { body, clientId } = parse(sendBody, req.body);

  // A retry of a message that already landed is answered from the DB and never rate limited.
  const existing = await query<ChatRow>(
    `SELECT ${COLUMNS} FROM chat_messages WHERE member_id = $1 AND client_id = $2`,
    [me.id, clientId],
  );
  if (existing.rows[0]) {
    res.status(200).json({ message: toMessage(existing.rows[0]) });
    return;
  }

  if (!takeSendSlot(me.id)) {
    throw new HttpError(429, 'rate_limited', 'Slow down a little — try again in a few seconds.');
  }

  const inserted = await query<ChatRow>(
    `INSERT INTO chat_messages (member_id, body, client_id)
     VALUES ($1, $2, $3)
     ON CONFLICT ON CONSTRAINT chat_messages_client_unique DO NOTHING
     RETURNING ${COLUMNS}`,
    [me.id, body, clientId],
  );

  if (!inserted.rows[0]) {
    // Lost a race with a concurrent retry of the same clientId: return the winner's row.
    const again = await query<ChatRow>(
      `SELECT ${COLUMNS} FROM chat_messages WHERE member_id = $1 AND client_id = $2`,
      [me.id, clientId],
    );
    res.status(200).json({ message: toMessage(again.rows[0]!) });
    return;
  }

  // The single INSERT has committed (autocommit) — now tell everyone.
  const message = toMessage(inserted.rows[0]);
  broadcast('chat:message', message);
  try {
    await notify({
      recipients: 'everyone-except-actor',
      actorId: me.id,
      kind: 'chat_message',
      title: 'New messages',
      body: `${me.name}: ${snippet(body)}`,
      link: '/chat',
      dedupeKey: 'chat_message',
    });
  } catch (err) {
    console.error('[chat] notify failed:', (err as Error).message);
  }
  res.status(201).json({ message });
});

router.post('/read', async (req, res) => {
  const me = req.member!;
  const { lastMessageId } = parse(readBody, req.body);
  await withTx(async (db) => {
    // Clamp to a real message id and never move the marker backwards.
    await query(
      `INSERT INTO chat_reads (member_id, last_read_message_id, updated_at)
       VALUES ($1, LEAST($2::bigint, (SELECT COALESCE(MAX(id), 0) FROM chat_messages)), now())
       ON CONFLICT (member_id) DO UPDATE
         SET last_read_message_id = GREATEST(chat_reads.last_read_message_id, EXCLUDED.last_read_message_id),
             updated_at = now()`,
      [me.id, lastMessageId],
      db,
    );
    await query(
      `UPDATE notifications SET read_at = now()
        WHERE member_id = $1 AND kind = 'chat_message' AND read_at IS NULL`,
      [me.id],
      db,
    );
  });
  res.status(204).end();
});

export default router;
