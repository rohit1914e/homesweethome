import { Link } from 'react-router-dom';
import { WashingMachine } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { Card, Skeleton } from '@/components/ui';
import { useMe, useMembers, useMeta } from '@/lib/queries';
import { addDays, formatDay } from '@/lib/time';
import { useBookingFlow } from './BookingDialogs';
import { useBookings, useWashingRealtime } from './api';

/** The six bookable days as one strip. Tap a free day to book it. */
export default function WeekStrip() {
  useWashingRealtime();
  const meta = useMeta().data;
  const me = useMe().data;
  const { byId } = useMembers();
  const win = meta?.bookingWindow;
  const bookings = useBookings(win?.start, win?.end);
  const flow = useBookingFlow();
  if (!win || bookings.isPending) return <Skeleton className="h-40" />;
  const byDate = new Map((bookings.data ?? []).map((b) => [b.date, b]));
  const days = Array.from({ length: win.days }, (_, i) => addDays(win.start, i));

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <WashingMachine className="size-5 text-dusk" aria-hidden /> Washing machine
        </h2>
        <Link to="/washing" className="text-sm font-semibold text-lamp hover:underline">Open calendar</Link>
      </div>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {days.map((d, i) => {
          const b = byDate.get(d);
          const holder = b ? byId.get(b.memberId) : undefined;
          const label = `${formatDay(d, { weekday: 'short' })} ${formatDay(d, { day: 'numeric' })}`;
          return (
            <li key={d}>
              {b ? (
                <div
                  className={`flex h-full flex-col items-center gap-1.5 rounded-chip border p-2.5 text-center ${
                    b.memberId === me?.id ? 'border-lamp/60 bg-lamp-soft' : 'border-chili/40 bg-chili-soft'
                  }`}
                  aria-label={`${formatDay(d)}: booked by ${holder?.name ?? 'someone'}`}
                >
                  <span className="text-xs font-semibold text-dusk">{i === 0 ? 'Today' : label}</span>
                  <Avatar member={holder} size="sm" />
                  <span className="max-w-full truncate text-xs font-semibold">{b.memberId === me?.id ? 'You' : holder?.name}</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => flow.openBook(d)}
                  className="flex h-full w-full flex-col items-center gap-1.5 rounded-chip border border-leaf/40 bg-leaf-soft p-2.5 text-center transition hover:border-leaf"
                  aria-label={`Book ${formatDay(d)}`}
                >
                  <span className="text-xs font-semibold text-dusk">{i === 0 ? 'Today' : label}</span>
                  <span className="grid size-9 place-items-center rounded-full border border-dashed border-leaf/60 text-leaf">+</span>
                  <span className="text-xs font-semibold text-leaf">Free</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {flow.dialogs}
    </Card>
  );
}
