import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, History } from 'lucide-react';
import type { Booking } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { Button, Card, PageHeader, Skeleton } from '@/components/ui';
import { useBookingFlow } from '@/features/washing/BookingDialogs';
import { dayShort, useBookingHistory, useBookings, useWashingRealtime } from '@/features/washing/api';
import { useMe, useMembers, useMeta } from '@/lib/queries';
import { addDays, formatDateTime, formatDay } from '@/lib/time';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function monthGrid(month: string) {
  // month = 'YYYY-MM'; Monday-first grid of 'YYYY-MM-DD' | null
  const first = `${month}-01`;
  const dow = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const [y, m] = month.split('-').map(Number);
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array(dow).fill(null);
  for (let d = 0; d < daysIn; d++) cells.push(addDays(first, d));
  while (cells.length % 7) cells.push(null);
  return cells;
}

function shiftMonth(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export default function WashingPage() {
  useWashingRealtime();
  const meta = useMeta().data;
  const me = useMe().data;
  const { byId } = useMembers();
  const today = meta?.today;
  const win = meta?.bookingWindow;
  const [month, setMonth] = useState<string | null>(null);
  const shown = month ?? today?.slice(0, 7);
  const cells = useMemo(() => (shown ? monthGrid(shown) : []), [shown]);
  const from = cells.find(Boolean) ?? undefined;
  const to = [...cells].reverse().find(Boolean) ?? undefined;
  const bookings = useBookings(from, to);
  const upcoming = useBookings(today, win?.end);
  const history = useBookingHistory();
  const flow = useBookingFlow();

  if (!meta || !shown || !win) return <Skeleton className="h-96" />;
  const byDate = new Map((bookings.data ?? []).map((b) => [b.date, b]));
  const mine = (upcoming.data ?? []).filter((b) => b.memberId === me?.id);
  const canCancel = (b: Booking) => (b.memberId === me?.id || me?.isAdmin) && b.date >= meta.today;
  const windowCrossesMonth = win.end.slice(0, 7) !== today!.slice(0, 7);

  return (
    <div>
      <PageHeader title="Washing machine" description={`One machine, one person per day. Book from today up to ${formatDay(win.end, { weekday: 'short', day: 'numeric', month: 'short' })}.`} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold">{formatDay(`${shown}-15`, { month: 'long', year: 'numeric' })}</h2>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" aria-label="Previous month" onClick={() => setMonth(shiftMonth(shown, -1))} icon={<ChevronLeft className="size-4" aria-hidden />} />
              {shown !== today!.slice(0, 7) && (
                <Button variant="ghost" size="sm" onClick={() => setMonth(null)}>This month</Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                aria-label="Next month"
                onClick={() => setMonth(shiftMonth(shown, 1))}
                icon={<ChevronRight className="size-4" aria-hidden />}
              />
            </div>
          </div>
          {windowCrossesMonth && shown === today!.slice(0, 7) && (
            <p className="mb-3 text-sm text-dusk">Some bookable days are next month — use the arrow to see them.</p>
          )}

          <div className="grid grid-cols-7 gap-1 sm:gap-2" role="grid" aria-label="Washing machine calendar">
            {WEEKDAYS.map((w) => (
              <div key={w} role="columnheader" className="pb-1 text-center text-xs font-semibold text-haze">{w}</div>
            ))}
            {cells.map((d, i) => {
              if (!d) return <div key={`x${i}`} aria-hidden />;
              const b = byDate.get(d);
              const holder = b ? byId.get(b.memberId) : undefined;
              const inWindow = d >= win.start && d <= win.end;
              const isToday = d === today;
              const dayNum = Number(d.slice(8));
              const base = `relative flex aspect-square min-h-11 flex-col items-center justify-center gap-0.5 rounded-chip border text-sm sm:aspect-[4/3.4] ${isToday ? 'outline-2 outline-offset-1 outline-lamp' : ''}`;
              if (b) {
                const mineB = b.memberId === me?.id;
                const content = (
                  <>
                    <span className="font-semibold">{dayNum}</span>
                    <Avatar member={holder} size="xs" />
                    <span className="hidden max-w-full truncate px-1 text-[11px] sm:block">{mineB ? 'You' : holder?.name}</span>
                  </>
                );
                return canCancel(b) ? (
                  <button
                    key={d}
                    type="button"
                    onClick={() => flow.openCancel(b)}
                    className={`${base} border-chili/50 bg-chili-soft hover:border-chili`}
                    aria-label={`${formatDay(d)}: booked by ${mineB ? 'you' : holder?.name}. Cancel booking`}
                  >
                    {content}
                  </button>
                ) : (
                  <div key={d} role="gridcell" className={`${base} border-chili/40 bg-chili-soft`} aria-label={`${formatDay(d)}: booked by ${holder?.name}`}>
                    {content}
                  </div>
                );
              }
              if (inWindow) {
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => flow.openBook(d)}
                    className={`${base} border-leaf/50 bg-leaf-soft font-semibold text-leaf transition hover:border-leaf hover:bg-leaf/25`}
                    aria-label={`Book ${formatDay(d)}`}
                  >
                    {dayNum}
                    <span className="hidden text-[11px] font-medium sm:block">Free</span>
                  </button>
                );
              }
              return (
                <div key={d} role="gridcell" aria-disabled className={`${base} border-transparent bg-ash/25 text-haze`} aria-label={`${formatDay(d)}: not bookable`}>
                  {dayNum}
                </div>
              );
            })}
          </div>

          <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-dusk" aria-label="Legend">
            <li className="flex items-center gap-2"><span className="size-3 rounded bg-leaf" aria-hidden /> Available</li>
            <li className="flex items-center gap-2"><span className="size-3 rounded bg-chili" aria-hidden /> Booked</li>
            <li className="flex items-center gap-2"><span className="size-3 rounded bg-ash" aria-hidden /> Past or not open yet</li>
            <li className="flex items-center gap-2"><span className="size-3 rounded outline-2 outline-lamp" aria-hidden /> Today</li>
          </ul>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <h2 className="mb-3 text-lg font-bold">Your upcoming bookings</h2>
            {mine.length === 0 ? (
              <p className="text-sm text-dusk">You have no bookings. Tap a green day to book.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {mine.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2 rounded-chip bg-wall px-3 py-2">
                    <span className="font-semibold">{dayShort(b.date)}</span>
                    <Button variant="danger" size="sm" onClick={() => flow.openCancel(b)}>Cancel booking</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><History className="size-5 text-dusk" aria-hidden /> Booking history</h2>
            {history.isPending ? (
              <Skeleton className="h-24" />
            ) : (
              <ul className="flex flex-col divide-y divide-seam">
                {history.data?.pages.flatMap((p) => p.bookings).map((b) => {
                  const who = byId.get(b.memberId);
                  return (
                    <li key={b.id} className="flex items-center gap-3 py-2.5">
                      <Avatar member={who} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className={`font-semibold ${b.cancelledAt ? 'text-haze line-through' : ''}`}>{dayShort(b.date)}</p>
                        <p className="truncate text-xs text-dusk">
                          {who?.name}
                          {b.bookedBy !== b.memberId && `, booked by ${byId.get(b.bookedBy)?.name}`}
                          {b.cancelledAt && `, cancelled ${formatDateTime(b.cancelledAt)}`}
                        </p>
                      </div>
                    </li>
                  );
                })}
                {history.data?.pages[0]?.bookings.length === 0 && <li className="py-2 text-sm text-dusk">No bookings yet.</li>}
              </ul>
            )}
            {history.hasNextPage && (
              <Button variant="secondary" size="sm" className="mt-3" loading={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
                Show older
              </Button>
            )}
          </Card>
        </div>
      </div>
      {flow.dialogs}
    </div>
  );
}
