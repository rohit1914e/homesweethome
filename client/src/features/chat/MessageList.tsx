// The conversation itself: day separators, sender groups, own vs others' bubbles,
// optimistic states. Pure rendering — scrolling lives in ChatPage.
import { memo } from 'react';
import type { Member } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { formatDateTime, formatTime, roomDateOf } from '@/lib/time';
import { dayLabel, nameOf } from './format';
import { MessageBody } from './MessageBody';

export interface DisplayMessage {
  key: string;
  id: number | null;
  memberId: number;
  body: string;
  createdAt: string;
  status: 'sent' | 'pending' | 'failed';
  clientId: string | null;
  error?: string;
}

export type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'msg'; key: string; msg: DisplayMessage; head: boolean; tail: boolean };

const GROUP_GAP_MS = 5 * 60 * 1000;

export function buildRows(messages: DisplayMessage[], today: string): Row[] {
  const rows: Row[] = [];
  let prev: DisplayMessage | null = null;
  let prevDay = '';
  for (const msg of messages) {
    const day = roomDateOf(msg.createdAt);
    if (day !== prevDay) {
      rows.push({ kind: 'day', key: `day:${day}`, label: dayLabel(day, today) });
      prev = null;
      prevDay = day;
    }
    const continues =
      prev !== null &&
      prev.memberId === msg.memberId &&
      Date.parse(msg.createdAt) - Date.parse(prev.createdAt) < GROUP_GAP_MS;
    if (!continues) {
      const last = rows[rows.length - 1];
      if (last?.kind === 'msg') last.tail = true;
    }
    rows.push({ kind: 'msg', key: msg.key, msg, head: !continues, tail: false });
    prev = msg;
  }
  const last = rows[rows.length - 1];
  if (last?.kind === 'msg') last.tail = true;
  return rows;
}

export const MessageList = memo(function MessageList({
  rows,
  meId,
  byId,
  onRetry,
}: {
  rows: Row[];
  meId: number | undefined;
  byId: Map<number, Member>;
  onRetry: (clientId: string) => void;
}) {
  return (
    <ol className="flex flex-col" aria-label="Messages">
      {rows.map((row) =>
        row.kind === 'day' ? (
          <li key={row.key} className="sticky top-0 z-10 flex justify-center py-3" aria-label={row.label}>
            <span className="rounded-full border border-seam bg-night/90 px-3 py-0.5 text-xs font-medium text-dusk backdrop-blur-sm">
              {row.label}
            </span>
          </li>
        ) : (
          <MessageRow
            key={row.key}
            msg={row.msg}
            head={row.head}
            tail={row.tail}
            own={row.msg.memberId === meId}
            member={byId.get(row.msg.memberId)}
            name={nameOf(byId, row.msg.memberId)}
            onRetry={onRetry}
          />
        ),
      )}
    </ol>
  );
});

function MessageRow({
  msg,
  head,
  tail,
  own,
  member,
  name,
  onRetry,
}: {
  msg: DisplayMessage;
  head: boolean;
  tail: boolean;
  own: boolean;
  member: Member | undefined;
  name: string;
  onRetry: (clientId: string) => void;
}) {
  const time = formatTime(msg.createdAt);
  const failed = msg.status === 'failed';
  const pending = msg.status === 'pending';

  const bubble = own
    ? `bg-lamp-soft text-jasmine border border-lamp/25 ${head ? 'rounded-tr-md' : ''}`
    : `bg-wall text-jasmine ${head ? 'rounded-tl-md' : ''}`;

  return (
    <li className={`flex gap-2.5 ${head ? 'mt-3' : 'mt-0.5'} ${tail ? 'mb-0.5' : ''} ${own ? 'flex-row-reverse' : ''}`}>
      {!own && (
        <div className="w-9 shrink-0">{head && <Avatar member={member} size="sm" />}</div>
      )}
      <div className={`flex min-w-0 max-w-[min(34rem,82%)] flex-col ${own ? 'items-end' : 'items-start'}`}>
        {head && (
          <p className={`mb-1 flex items-baseline gap-2 px-1 text-xs ${own ? 'flex-row-reverse' : ''}`}>
            {!own && <span className="text-[13px] font-semibold text-jasmine">{name}</span>}
            <time dateTime={msg.createdAt} title={formatDateTime(msg.createdAt)} className="text-haze tabular-nums">
              {time}
            </time>
          </p>
        )}
        <div
          className={`rounded-[1.15rem] px-3.5 py-2 text-[15px] leading-[1.45] transition-opacity duration-200 ${bubble} ${pending ? 'opacity-60' : ''} ${failed ? 'border-chili/60 opacity-80' : ''}`}
          title={head ? undefined : `${own ? 'You' : name}, ${formatDateTime(msg.createdAt)}`}
        >
          {!head && <span className="sr-only">{own ? 'You' : name}, {time}: </span>}
          {head && own && <span className="sr-only">You: </span>}
          <MessageBody text={msg.body} />
          {pending && <span className="sr-only"> (sending)</span>}
        </div>
        {failed && msg.clientId && (
          <button
            type="button"
            onClick={() => onRetry(msg.clientId!)}
            title={msg.error}
            className="mt-1 rounded-chip px-1 text-xs font-semibold text-chili underline-offset-2 hover:underline"
          >
            Not sent — tap to retry
          </button>
        )}
      </div>
    </li>
  );
}
