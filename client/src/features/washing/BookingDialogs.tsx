import { useEffect, useState } from 'react';
import type { Booking } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { ConfirmDialog } from '@/components/ui';
import { useMe, useMembers } from '@/lib/queries';
import { formatDay } from '@/lib/time';
import { useBookingActions } from './api';

/** Shared state + dialogs for booking a free date and cancelling a booking. */
export function useBookingFlow() {
  const [bookDate, setBookDate] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Booking | null>(null);
  const actions = useBookingActions();
  const dialogs = (
    <>
      <BookDialog date={bookDate} onClose={() => setBookDate(null)} actions={actions} />
      <ConfirmDialog
        open={!!cancelling}
        title="Cancel this booking?"
        description={cancelling ? `${formatDay(cancelling.date)} will become free for everyone.` : ''}
        confirmLabel="Cancel booking"
        cancelLabel="Keep it"
        tone="danger"
        loading={actions.cancel.isPending}
        onCancel={() => setCancelling(null)}
        onConfirm={() => cancelling && actions.cancel.mutate(cancelling, { onSettled: () => setCancelling(null) })}
      />
    </>
  );
  return { openBook: setBookDate, openCancel: setCancelling, dialogs };
}

function BookDialog({ date, onClose, actions }: { date: string | null; onClose: () => void; actions: ReturnType<typeof useBookingActions> }) {
  const me = useMe().data;
  const { members } = useMembers();
  const [forId, setForId] = useState<number | undefined>(me?.id);
  useEffect(() => setForId(me?.id), [date, me?.id]);
  return (
    <ConfirmDialog
      open={!!date}
      title={date ? `Book ${formatDay(date)}?` : ''}
      description="The washing machine will be yours for the whole day. Others will see it as booked."
      confirmLabel="Book this day"
      loading={actions.book.isPending}
      onCancel={onClose}
      onConfirm={() =>
        date &&
        actions.book.mutate(
          { date, memberId: me?.isAdmin && forId !== me.id ? forId : undefined },
          { onSettled: onClose },
        )
      }
    >
      {me?.isAdmin && (
        <fieldset className="mt-4">
          <legend className="mb-2 text-sm font-semibold text-jasmine">Book for</legend>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => (
              <label
                key={m.id}
                className={`flex cursor-pointer items-center gap-2 rounded-chip border px-2.5 py-1.5 text-sm ${
                  forId === m.id ? 'border-lamp bg-lamp-soft text-jasmine' : 'border-seam text-dusk'
                }`}
              >
                <input type="radio" name="book-for" className="sr-only" checked={forId === m.id} onChange={() => setForId(m.id)} />
                <Avatar member={m} size="xs" />
                {m.id === me.id ? 'Me' : m.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </ConfirmDialog>
  );
}
