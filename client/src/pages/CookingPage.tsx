import { useState } from 'react';
import { ChefHat, History, Plus } from 'lucide-react';
import { HouseholdStrip, Tally } from '@/features/cooking/HouseholdStrip';
import { MenuComposer } from '@/features/cooking/MenuComposer';
import { MenuHero, StatusPill } from '@/features/cooking/MenuHero';
import { useCookingRealtime, useMenuHistory, useTodayMenus } from '@/features/cooking/api';
import { longDay } from '@/features/cooking/format';
import { Button, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { useMe, useMeta } from '@/lib/queries';

export default function CookingPage() {
  useCookingRealtime();
  const me = useMe().data;
  const today = useMeta().data?.today;
  const menus = useTodayMenus();
  const history = useMenuHistory(10);
  const [composing, setComposing] = useState(false);
  const past = (history.data?.pages.flatMap((p) => p.menus) ?? []).filter((m) => m.menuDate !== today);

  return (
    <div>
      <PageHeader
        title="Cooking"
        description="Today's menu and who's eating."
        actions={
          me?.isAdmin && (
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setComposing(true)}>
              Publish a menu
            </Button>
          )
        }
      />

      <section aria-label="Today's menu" className="flex flex-col gap-6">
        {menus.isPending ? (
          <Skeleton className="h-72" />
        ) : menus.data?.length ? (
          menus.data.map((m) => <MenuHero key={m.id} menu={m} />)
        ) : (
          <Card>
            <EmptyState
              icon={<ChefHat />}
              title={me?.isAdmin ? 'No menu for today yet' : "Rohit hasn't posted today's menu yet"}
              description={me?.isAdmin ? 'Publish one and everyone can say whether they want it.' : "You'll get a notification as soon as it's up."}
              action={me?.isAdmin && <Button onClick={() => setComposing(true)}>Publish a menu</Button>}
            />
          </Card>
        )}
      </section>

      <section aria-labelledby="history-title" className="mt-12">
        <h2 id="history-title" className="mb-4 flex items-center gap-2 text-xl font-bold">
          <History className="size-5 text-dusk" aria-hidden /> Cooking history
        </h2>
        {history.isPending ? (
          <Skeleton className="h-40" />
        ) : past.length === 0 ? (
          <p className="text-dusk">Earlier menus and their results will show up here.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-seam rounded-tile border border-seam bg-room">
            {past.map((m) => (
              <li key={m.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-6">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-dusk">{longDay(m.menuDate)}</p>
                  <p className="truncate text-lg font-semibold">{m.title}</p>
                  <div className="mt-1 flex items-center gap-3">
                    <Tally menu={m} />
                    <StatusPill status={m.status} />
                  </div>
                </div>
                <HouseholdStrip menu={m} size="xs" showWords={false} myId={me?.id} />
              </li>
            ))}
          </ul>
        )}
        {history.hasNextPage && (
          <Button variant="secondary" className="mt-4" loading={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
            Show older
          </Button>
        )}
      </section>

      {composing && <MenuComposer onClose={() => setComposing(false)} />}
    </div>
  );
}
