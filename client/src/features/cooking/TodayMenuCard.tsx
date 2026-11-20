import { ChefHat } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, EmptyState, Skeleton } from '@/components/ui';
import { useMe } from '@/lib/queries';
import { MenuHero } from './MenuHero';
import { useCookingRealtime, useTodayMenus } from './api';

export default function TodayMenuCard() {
  useCookingRealtime();
  const me = useMe().data;
  const menus = useTodayMenus();
  if (menus.isPending) return <Skeleton className="h-64" />;
  const menu = menus.data?.[0];
  if (!menu) {
    return (
      <Card>
        <EmptyState
          icon={<ChefHat />}
          title={me?.isAdmin ? 'No menu for today yet' : "Rohit hasn't posted today's menu yet"}
          action={<Link to="/cooking" className="font-semibold text-lamp hover:underline">Open cooking</Link>}
        />
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <MenuHero menu={menu} compact />
      {(menus.data?.length ?? 0) > 1 && (
        <Link to="/cooking" className="self-start text-sm font-semibold text-lamp hover:underline">
          {(menus.data?.length ?? 1) - 1} more menu today
        </Link>
      )}
    </div>
  );
}
