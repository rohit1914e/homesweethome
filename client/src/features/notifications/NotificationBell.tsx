// Bell + panel. Desktop: popover beside the sidebar. Mobile: sheet under the top bar.
import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, CookingPot, MessagesSquare, WashingMachine, X } from 'lucide-react';
import type { AppNotification, NotificationKind } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { Button, EmptyState, Skeleton } from '@/components/ui';
import { relativeTime } from '@/components/when';
import { formatDateTime } from '@/lib/time';
import { useMembers } from '@/lib/queries';
import { errorMessage } from '@/lib/api';
import { useMarkRead, useNotifications } from './useNotifications';

const KIND_ICON: Record<NotificationKind, typeof Bell> = {
  menu_published: CookingPot,
  menu_updated: CookingPot,
  menu_closed: CookingPot,
  vote_cast: CookingPot,
  booking_created: WashingMachine,
  booking_cancelled: WashingMachine,
  chat_message: MessagesSquare,
};

export function NotificationBell({ placement }: { placement: 'sidebar' | 'topbar' }) {
  const [open, setOpen] = useState(false);
  const { data } = useNotifications();
  const unread = data?.unread ?? 0;
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // Close on route change.
  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={`relative inline-flex size-10 items-center justify-center rounded-full text-dusk transition hover:bg-wall hover:text-jasmine ${open ? 'bg-wall text-jasmine' : ''}`}
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 && (
          <span
            aria-hidden
            className="tabular absolute top-0.5 right-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-full bg-lamp px-1 text-[11px] leading-none font-bold text-lamp-ink ring-2 ring-night"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Notifications"
          className={`fixed z-50 flex max-h-[min(36rem,calc(100dvh-6rem))] flex-col overflow-hidden rounded-tile border border-seam bg-room shadow-lift animate-rise ${
            placement === 'sidebar'
              ? 'top-3 left-[calc(var(--sidebar-w)+0.5rem)] w-[24rem]'
              : 'inset-x-2 top-[calc(var(--topbar-h)+env(safe-area-inset-top)+0.25rem)] sm:right-3 sm:left-auto sm:w-[24rem]'
          }`}
        >
          <NotificationPanel onClose={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}

function NotificationPanel({ onClose }: { onClose: () => void }) {
  const { data, isPending, isError, error, refetch } = useNotifications();
  const markRead = useMarkRead();
  const navigate = useNavigate();
  const { byId } = useMembers();
  const items = data?.notifications ?? [];
  const unread = data?.unread ?? 0;

  const openItem = (n: AppNotification) => {
    if (!n.readAt) markRead.mutate([n.id]);
    onClose();
    if (n.link) navigate(n.link);
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-seam py-2 pr-2 pl-4">
        <h2 data-autofocus tabIndex={-1} className="type-title text-lg font-bold focus:outline-none">
          Notifications
        </h2>
        <div className="flex items-center gap-1">
          {unread > 0 && (
            <Button variant="ghost" size="sm" icon={<CheckCheck aria-hidden />} onClick={() => markRead.mutate(undefined)}>
              Mark all as read
            </Button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notifications"
            className="inline-flex size-8 items-center justify-center rounded-full text-dusk hover:bg-wall hover:text-jasmine"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {isPending ? (
          <ul aria-label="Loading notifications" className="flex flex-col gap-3 p-4">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex gap-3">
                <Skeleton className="size-9 rounded-full" />
                <div className="flex flex-1 flex-col gap-2 pt-1">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </li>
            ))}
          </ul>
        ) : isError ? (
          <EmptyState
            title="Notifications didn’t load"
            description={errorMessage(error)}
            action={
              <Button variant="secondary" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState icon={<Bell aria-hidden />} title="Nothing new" description="New menus, washing bookings and chat messages will show up here." />
        ) : (
          <ul className="flex flex-col py-1">
            {items.map((n) => {
              const Icon = KIND_ICON[n.kind] ?? Bell;
              const actor = n.actorId ? byId.get(n.actorId) : undefined;
              const isUnread = !n.readAt;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openItem(n)}
                    className="group flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-wall focus-visible:-outline-offset-2"
                  >
                    <span className="relative mt-0.5">
                      {actor ? (
                        <Avatar member={actor} size="sm" />
                      ) : (
                        <span className="inline-flex size-9 items-center justify-center rounded-full bg-wall text-dusk">
                          <Icon className="size-4" aria-hidden />
                        </span>
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-start gap-2">
                        <span className={`min-w-0 flex-1 leading-snug ${isUnread ? 'font-semibold text-jasmine' : 'text-dusk'}`}>{n.title}</span>
                        {n.count > 1 && (
                          <span className="tabular mt-0.5 shrink-0 rounded-full bg-wall px-1.5 text-xs font-semibold text-dusk">
                            {n.count}
                            <span className="sr-only"> updates</span>
                          </span>
                        )}
                      </span>
                      {n.body && <span className={`mt-0.5 line-clamp-2 text-sm ${isUnread ? 'text-dusk' : 'text-haze'}`}>{n.body}</span>}
                      <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)} className="mt-1 text-xs text-haze">
                        {relativeTime(n.createdAt)}
                      </time>
                    </span>
                    {isUnread && (
                      <span className="mt-2 size-2 shrink-0 rounded-full bg-lamp">
                        <span className="sr-only">Unread</span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
