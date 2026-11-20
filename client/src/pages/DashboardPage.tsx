import { lazy, Suspense } from 'react';
import { CookingPot, MessagesSquare, WashingMachine } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/Avatar';
import { Widget } from '@/components/ErrorBoundary';
import { Skeleton } from '@/components/ui';
import { greetingFor, roomHour } from '@/components/when';
import { usePresenceSync } from '@/features/chat/chatStore';
import { useMe, useMembers, useMeta } from '@/lib/queries';
import { formatDay } from '@/lib/time';

const TodayMenuCard = lazy(() => import('@/features/cooking/TodayMenuCard'));
const WeekStrip = lazy(() => import('@/features/washing/WeekStrip'));
const RecentMessages = lazy(() => import('@/features/chat/RecentMessages'));

function Slot({ label, children, h = 'h-48' }: { label: string; children: React.ReactNode; h?: string }) {
  const fallback = <Skeleton className={h} />;
  return (
    <Widget label={label} fallback={fallback}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </Widget>
  );
}

export default function DashboardPage() {
  usePresenceSync();
  const me = useMe().data;
  const today = useMeta().data?.today;
  const { members } = useMembers();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-lg text-dusk">{greetingFor(roomHour())},</p>
          <h1 className="text-5xl font-bold tracking-tight [font-variation-settings:'opsz'_96] sm:text-6xl">{me?.name}</h1>
          {today && (
            <p className="mt-3 text-xl">
              <span className="font-semibold text-lamp">{formatDay(today, { weekday: 'long' })}</span>
              <span className="text-dusk">, {formatDay(today, { day: 'numeric', month: 'long', year: 'numeric' })}</span>
            </p>
          )}
        </div>
        <Link to="/members" aria-label="Members" className="flex flex-col gap-2 sm:items-end">
          <ul className="flex gap-1.5">
            {members.map((m) => (
              <li key={m.id}><Avatar member={m} size="md" online={m.online} /></li>
            ))}
          </ul>
          <span className="text-sm text-dusk">{members.filter((m) => m.online).length} of 6 at home right now</span>
        </Link>
      </header>

      <nav aria-label="Quick links" className="grid grid-cols-3 gap-2 sm:hidden">
        {[
          { to: '/cooking', label: 'Cooking', Icon: CookingPot },
          { to: '/washing', label: 'Washing', Icon: WashingMachine },
          { to: '/chat', label: 'Chat', Icon: MessagesSquare },
        ].map(({ to, label, Icon }) => (
          <Link key={to} to={to} className="flex flex-col items-center gap-1 rounded-chip border border-seam bg-room py-3 text-sm font-semibold">
            <Icon className="size-5 text-lamp" aria-hidden /> {label}
          </Link>
        ))}
      </nav>

      <section aria-labelledby="kitchen-title">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="kitchen-title" className="text-2xl font-bold">Today in the kitchen</h2>
          <Link to="/cooking" className="text-sm font-semibold text-lamp hover:underline">All menus</Link>
        </div>
        <Slot label="Today's menu" h="h-64"><TodayMenuCard /></Slot>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Slot label="Washing machine"><WeekStrip /></Slot>
        <Slot label="Group chat"><RecentMessages limit={4} /></Slot>
      </div>
    </div>
  );
}
