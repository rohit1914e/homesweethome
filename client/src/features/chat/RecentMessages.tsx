import { MessagesSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/Avatar';
import { Card, Skeleton } from '@/components/ui';
import { useMe, useMembers } from '@/lib/queries';
import { formatTime } from '@/lib/time';
import { useChatLive, useChatMessages } from './chatStore';
import { snippet } from './format';

export default function RecentMessages({ limit = 4 }: { limit?: number }) {
  useChatLive();
  const chat = useChatMessages();
  const { byId } = useMembers();
  const me = useMe().data;
  const recent = (chat.data?.messages ?? []).slice(-limit).reverse();
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold"><MessagesSquare className="size-5 text-dusk" aria-hidden /> Group chat</h2>
        <Link to="/chat" className="text-sm font-semibold text-lamp hover:underline">Open chat</Link>
      </div>
      {chat.isPending ? (
        <Skeleton className="h-32" />
      ) : recent.length === 0 ? (
        <p className="text-sm text-dusk">No messages yet. <Link to="/chat" className="text-lamp hover:underline">Say hi to the room.</Link></p>
      ) : (
        <ul className="flex flex-col gap-3">
          {recent.map((m) => {
            const who = byId.get(m.memberId);
            return (
              <li key={m.id}>
                <Link to="/chat" className="flex items-start gap-3 rounded-chip p-1 hover:bg-wall">
                  <Avatar member={who} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-semibold">{m.memberId === me?.id ? 'You' : who?.name}</span>
                      <time className="shrink-0 text-xs text-haze" dateTime={m.createdAt}>{formatTime(m.createdAt)}</time>
                    </p>
                    <p className="truncate text-sm text-dusk">{snippet(m.body)}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
