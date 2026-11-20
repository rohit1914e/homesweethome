import { Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, Skeleton } from '@/components/ui';
import { useMe } from '@/lib/queries';
import { TaskRow } from './TaskRow';
import { useCleaningTasks } from './api';

/** Dashboard section: your pending duties (Rohit: everyone's next pending duties). */
export default function CleaningCard() {
  const me = useMe().data;
  const tasks = useCleaningTasks();
  const pending = (tasks.data ?? []).filter((t) => t.status === 'pending');
  return (
    <Card>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold"><Sparkles className="size-5 text-dusk" aria-hidden /> Room cleaning</h2>
        <Link to="/cleaning" className="text-sm font-semibold text-lamp hover:underline">{me?.isAdmin ? 'Manage duties' : 'All duties'}</Link>
      </div>
      {tasks.isPending ? (
        <Skeleton className="h-24" />
      ) : pending.length === 0 ? (
        <p className="py-2 text-sm text-dusk">{me?.isAdmin ? 'No pending duties.' : 'No cleaning duties for you right now.'}</p>
      ) : (
        <>
          <ul className="divide-y divide-seam">
            {pending.slice(0, 4).map((t) => <TaskRow key={t.id} task={t} compact />)}
          </ul>
          {pending.length > 4 && <Link to="/cleaning" className="text-sm font-semibold text-lamp hover:underline">{pending.length - 4} more pending</Link>}
        </>
      )}
    </Card>
  );
}
