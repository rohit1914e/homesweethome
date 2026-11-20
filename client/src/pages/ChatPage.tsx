import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, MessagesSquare } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { Button, EmptyState, Spinner } from '@/components/ui';
import { Composer } from '@/features/chat/Composer';
import { MessageList, buildRows, type DisplayMessage } from '@/features/chat/MessageList';
import { loadEarlier, retryMessage, sendMessage, useChatLive, useChatMessages, useOutbox, usePresenceSync } from '@/features/chat/chatStore';
import { roomToday, typingSentence } from '@/features/chat/format';
import { useTypingMembers } from '@/features/chat/useTypingMembers';
import { api } from '@/lib/api';
import { qk, queryClient, useMe, useMembers } from '@/lib/queries';

export default function ChatPage() {
  useChatLive();
  usePresenceSync();
  const me = useMe().data;
  const { members, byId } = useMembers();
  const chat = useChatMessages();
  const outbox = useOutbox();
  const typingIds = useTypingMembers(me?.id);
  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [showPill, setShowPill] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const lastCount = useRef(0);

  const display: DisplayMessage[] = useMemo(() => {
    const sent: DisplayMessage[] = (chat.data?.messages ?? []).map((m) => ({
      key: `m${m.id}`, id: m.id, memberId: m.memberId, body: m.body, createdAt: m.createdAt, status: 'sent', clientId: m.clientId,
    }));
    const pending: DisplayMessage[] = outbox.map((o) => ({
      key: `c${o.clientId}`, id: null, memberId: o.memberId, body: o.body, createdAt: o.createdAt, status: o.status, clientId: o.clientId, error: o.error,
    }));
    return [...sent, ...pending];
  }, [chat.data, outbox]);
  const rows = useMemo(() => buildRows(display, roomToday()), [display]);

  const scrollToBottom = (smooth = false) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setShowPill(false);
  };

  // Stick to the bottom on open and when new messages arrive (if the reader is near the bottom).
  useLayoutEffect(() => {
    const grew = display.length > lastCount.current;
    const first = lastCount.current === 0;
    lastCount.current = display.length;
    if (!grew) return;
    const mineNewest = display[display.length - 1]?.memberId === me?.id;
    if (first || nearBottom.current || mineNewest) scrollToBottom(!first);
    else setShowPill(true);
  }, [display, me?.id]);

  // Mark read while the page is visible.
  const newestId = chat.data?.messages.at(-1)?.id;
  useEffect(() => {
    if (!newestId || document.visibilityState !== 'visible') return;
    const t = setTimeout(() => {
      void api.post('/api/chat/read', { lastMessageId: newestId }).then(() => queryClient.invalidateQueries({ queryKey: qk.notifications }));
    }, 600);
    return () => clearTimeout(t);
  }, [newestId]);

  async function onScroll() {
    const el = scroller.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom.current) setShowPill(false);
    if (el.scrollTop < 40 && chat.data?.hasMore && !loadingEarlier) {
      setLoadingEarlier(true);
      const before = el.scrollHeight;
      try {
        await loadEarlier();
      } finally {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight - before + el.scrollTop;
          setLoadingEarlier(false);
        });
      }
    }
  }

  const typingNames = typingIds.map((id) => byId.get(id)?.name ?? 'Someone');
  const onlineCount = members.filter((m) => m.online).length;

  return (
    <div className="flex h-[calc(100dvh-8.5rem-env(safe-area-inset-bottom))] min-h-0 flex-col sm:pt-4 lg:h-dvh lg:py-6">
      <header className="flex items-center gap-3 border-b border-seam px-4 py-3 sm:rounded-t-tile sm:border sm:bg-room">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">Group chat</h1>
          <p className="text-sm text-dusk">{onlineCount} of 6 online</p>
        </div>
        <ul className="flex -space-x-1.5" aria-label="Members">
          {members.map((m) => (
            <li key={m.id}><Avatar member={m} size="sm" online={m.online} className="rounded-full ring-2 ring-night" /></li>
          ))}
        </ul>
      </header>

      <div className="relative min-h-0 flex-1 sm:border-x sm:border-seam sm:bg-room/50">
        <div ref={scroller} onScroll={() => void onScroll()} className="h-full overflow-y-auto overscroll-contain px-3 py-4 sm:px-5">
          {chat.isPending ? (
            <div className="p-6"><Spinner label="Loading messages" /></div>
          ) : display.length === 0 ? (
            <EmptyState icon={<MessagesSquare />} title="No messages yet" description="Say hi to the room." />
          ) : (
            <>
              {chat.data?.hasMore && (
                <div className="mb-3 flex justify-center">
                  {loadingEarlier ? <Spinner label="Loading earlier messages" /> : (
                    <Button variant="ghost" size="sm" onClick={() => { setLoadingEarlier(true); void loadEarlier().finally(() => setLoadingEarlier(false)); }}>
                      Load earlier messages
                    </Button>
                  )}
                </div>
              )}
              <MessageList rows={rows} meId={me?.id} byId={byId} onRetry={retryMessage} />
            </>
          )}
        </div>
        {showPill && (
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-lamp px-4 py-2 text-sm font-semibold text-lamp-ink shadow-lamp"
          >
            <ArrowDown className="size-4" aria-hidden /> New messages
          </button>
        )}
      </div>

      <div className="border-t border-seam bg-night px-3 pt-1 pb-2 sm:rounded-b-tile sm:border sm:bg-room sm:px-4">
        <p className="h-5 truncate text-xs text-dusk" aria-live="polite">{typingNames.length ? typingSentence(typingNames) : ''}</p>
        <Composer onSend={(body) => (me ? sendMessage(body, me.id) : false)} onFocus={() => nearBottom.current && scrollToBottom()} />
      </div>
    </div>
  );
}
