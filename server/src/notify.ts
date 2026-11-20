// In-app notifications. Feature routes call notify() AFTER their transaction commits.
// It never throws into the caller: failures are logged and swallowed.
import type { AppNotification, NotificationKind } from '../../shared/types.js';
import { query } from './db.js';
import { ADMIN_ID, MEMBER_IDS } from './members.js';
import { emitToMember } from './realtime.js';

export interface NotifyOptions {
  recipients: number[] | 'everyone-except-actor' | 'admin';
  actorId: number | null;
  kind: NotificationKind;
  /** May contain "{count}", replaced by the (coalesced) row's count, e.g. "{count} new votes on Rice". */
  title: string;
  body?: string;
  link: string;
  /** An unread row with the same (recipient, dedupeKey) is bumped (count+1, fresh text/time) instead of duplicated. */
  dedupeKey?: string;
}

interface NotificationRow {
  id: number;
  member_id: number;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
  actor_id: number | null;
  count: number;
  created_at: Date;
  read_at: Date | null;
}

export const NOTIFICATION_COLUMNS = 'id, member_id, kind, title, body, link, actor_id, count, created_at, read_at';

export function toNotification(r: NotificationRow): AppNotification {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    link: r.link,
    actorId: r.actor_id,
    count: r.count,
    createdAt: r.created_at.toISOString(),
    readAt: r.read_at ? r.read_at.toISOString() : null,
  };
}

export function resolveRecipients(recipients: NotifyOptions['recipients'], actorId: number | null): number[] {
  if (recipients === 'everyone-except-actor') return MEMBER_IDS.filter((id) => id !== actorId);
  if (recipients === 'admin') return actorId === ADMIN_ID ? [] : [ADMIN_ID];
  return [...new Set(recipients)].filter((id) => MEMBER_IDS.includes(id));
}

export async function notify(opts: NotifyOptions): Promise<void> {
  try {
    const ids = resolveRecipients(opts.recipients, opts.actorId);
    if (ids.length === 0) return;
    const { rows } = await query<NotificationRow>(
      `INSERT INTO notifications AS n (member_id, kind, title, body, link, actor_id, dedupe_key)
       SELECT r, $2, replace($3, '{count}', '1'), replace($4, '{count}', '1'), $5, $6, $7
         FROM unnest($1::smallint[]) AS r
       ON CONFLICT (member_id, dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL
       DO UPDATE SET count      = n.count + 1,
                     kind       = EXCLUDED.kind,
                     title      = replace($3, '{count}', (n.count + 1)::text),
                     body       = replace($4, '{count}', (n.count + 1)::text),
                     link       = EXCLUDED.link,
                     actor_id   = EXCLUDED.actor_id,
                     created_at = now()
       RETURNING ${NOTIFICATION_COLUMNS.split(', ').map((c) => `n.${c}`).join(', ')}`,
      [ids, opts.kind, opts.title, opts.body ?? '', opts.link, opts.actorId, opts.dedupeKey ?? null],
    );
    for (const row of rows) {
      try {
        emitToMember(row.member_id, 'notification:new', toNotification(row));
      } catch (err) {
        console.error('[notify] emit failed:', (err as Error).message);
      }
    }
  } catch (err) {
    console.error(`[notify] ${opts.kind} failed:`, (err as Error).message);
  }
}
