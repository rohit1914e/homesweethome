// One menu, full size: the dish, the two vote buttons, and the six faces.
import { useState } from 'react';
import { Lock, LockOpen, Pencil, Trash2 } from 'lucide-react';
import type { Menu } from '@shared/types';
import { Button, ConfirmDialog } from '@/components/ui';
import { useMe, useMeta } from '@/lib/queries';
import { useMenuAdmin } from './api';
import { relativeDay, longDay } from './format';
import { HouseholdStrip, Tally } from './HouseholdStrip';
import { MenuComposer } from './MenuComposer';
import { VoteButtons } from './VoteButtons';

export function StatusPill({ status }: { status: Menu['status'] }) {
  return status === 'open' ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-leaf-soft px-2.5 py-0.5 text-sm font-semibold text-leaf">
      <span className="size-1.5 rounded-full bg-leaf" aria-hidden />
      Voting open
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-wall px-2.5 py-0.5 text-sm font-semibold text-dusk">
      <Lock className="size-3.5" aria-hidden />
      Voting closed
    </span>
  );
}

export function MenuHero({ menu, compact = false }: { menu: Menu; compact?: boolean }) {
  const me = useMe().data;
  const today = useMeta().data?.today;
  const admin = useMenuAdmin();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const headingId = `menu-${menu.id}-title`;

  return (
    <article aria-labelledby={headingId} className="overflow-hidden rounded-tile border border-seam bg-room">
      <div className={menu.imageUrl && !compact ? 'md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]' : ''}>
        {menu.imageUrl && (
          <img
            src={menu.imageUrl}
            alt={`Photo of ${menu.title}`}
            className={`w-full bg-wall object-cover ${compact ? 'aspect-[21/9]' : 'aspect-[4/3] md:aspect-auto md:h-full'}`}
          />
        )}
        <div className="flex flex-col gap-5 p-5 sm:p-6">
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <time dateTime={menu.menuDate} className="text-sm font-semibold text-lamp" title={longDay(menu.menuDate)}>
                {relativeDay(menu.menuDate, today)}
                {relativeDay(menu.menuDate, today) !== longDay(menu.menuDate) && (
                  <span className="font-normal text-dusk">, {longDay(menu.menuDate)}</span>
                )}
              </time>
              <StatusPill status={menu.status} />
            </div>
            <h2
              id={headingId}
              className={`mt-2 font-bold tracking-tight text-balance text-jasmine [font-variation-settings:'opsz'_96] ${
                compact ? 'text-2xl' : 'text-3xl leading-[1.05] sm:text-[2.75rem]'
              }`}
            >
              {menu.title}
            </h2>
            {menu.description && (
              <p className="mt-2 max-w-prose whitespace-pre-line text-dusk">{menu.description}</p>
            )}
          </div>

          <VoteButtons menu={menu} size={compact ? 'md' : 'lg'} />

          <div className="flex flex-col gap-4 rounded-chip bg-night/50 p-4">
            <Tally menu={menu} />
            <HouseholdStrip menu={menu} myId={me?.id} size={compact ? 'sm' : 'md'} />
          </div>

          {me?.isAdmin && (
            <div className="flex flex-wrap gap-2 border-t border-seam pt-4">
              <Button variant="secondary" size="sm" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              {menu.status === 'open' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Lock className="size-4" aria-hidden />}
                  loading={admin.close.isPending}
                  onClick={() => admin.close.mutate(menu.id)}
                >
                  Close voting
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<LockOpen className="size-4" aria-hidden />}
                  loading={admin.reopen.isPending}
                  onClick={() => admin.reopen.mutate(menu.id)}
                >
                  Reopen voting
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="sm:ml-auto"
                icon={<Trash2 className="size-4" aria-hidden />}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            </div>
          )}
        </div>
      </div>

      {editing && <MenuComposer menu={menu} onClose={() => setEditing(false)} />}
      {confirmDelete && (
        <ConfirmDialog
          open
          tone="danger"
          title={`Delete ${menu.title}?`}
          description="The menu, its photo and everyone’s votes will be removed for the whole flat. This can’t be undone."
          confirmLabel="Delete menu"
          loading={admin.remove.isPending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => admin.remove.mutate(menu, { onSettled: () => setConfirmDelete(false) })}
        />
      )}
    </article>
  );
}
