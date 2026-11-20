import type { ReactNode } from 'react';
import { CookingPot, House, LogOut, MessagesSquare, Settings, Users, WashingMachine } from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Avatar } from '@/components/Avatar';
import { Wordmark } from '@/components/Brand';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { useSignOut } from '@/lib/auth';
import { useMe } from '@/lib/queries';
import { useSocketStatus } from '@/lib/realtime';

const NAV = [
  { to: '/', label: 'Dashboard', short: 'Home', icon: House },
  { to: '/cooking', label: 'Cooking', short: 'Cooking', icon: CookingPot },
  { to: '/washing', label: 'Washing machine', short: 'Washing', icon: WashingMachine },
  { to: '/chat', label: 'Group chat', short: 'Chat', icon: MessagesSquare },
  { to: '/members', label: 'Members', short: 'Members', icon: Users },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const me = useMe().data;
  const signOut = useSignOut();
  const status = useSocketStatus();
  const { pathname } = useLocation();
  const fullHeight = pathname === '/chat';

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-seam bg-room/60 px-4 py-6 lg:flex">
        <Link to="/" className="mb-8 flex items-center gap-2 px-2" aria-label="HomeSweetHome dashboard">
          <Wordmark size="sm" />
        </Link>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
          {[...NAV, { to: '/settings', label: 'Settings', short: 'Settings', icon: Settings }].map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-chip px-3 py-2.5 text-[15px] font-medium transition-colors ${
                  isActive ? 'bg-lamp-soft text-lamp' : 'text-dusk hover:bg-wall hover:text-jasmine'
                }`
              }
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mb-3 px-1">
          <NotificationBell placement="sidebar" />
        </div>
        {me && (
          <div className="flex items-center gap-3 rounded-tile border border-seam bg-room p-3">
            <Avatar member={me} size="sm" />
            <span className="min-w-0 flex-1 truncate font-semibold">{me.name}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-chip p-2 text-dusk hover:bg-wall hover:text-jasmine"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile / tablet top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-seam bg-night/90 px-4 py-3 backdrop-blur lg:hidden">
          <Link to="/" className="flex items-center gap-2" aria-label="HomeSweetHome dashboard">
            <Wordmark size="sm" />
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell placement="topbar" />
            {me && (
              <Link to="/settings" aria-label="Settings" className="rounded-full p-1">
                <Avatar member={me} size="sm" />
              </Link>
            )}
          </div>
        </header>

        {status === 'reconnecting' && (
          <div role="status" className="bg-wall px-4 py-1.5 text-center text-sm text-dusk">
            Reconnecting… live updates will resume in a moment.
          </div>
        )}

        <main
          id="main"
          className={
            fullHeight
              ? 'mx-auto flex w-full max-w-5xl flex-1 flex-col px-0 pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:px-6 lg:h-dvh lg:pb-0'
              : 'mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-10 lg:pt-10 lg:pb-12'
          }
        >
          {children}
        </main>
      </div>

      {/* Mobile bottom tabs */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-seam bg-night/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {NAV.map(({ to, short, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${isActive ? 'text-lamp' : 'text-dusk'}`
            }
          >
            <Icon className="size-5" aria-hidden />
            {short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
