import { Check, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import type { CleaningTask } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui';
import { useMe, useMembers, useMeta } from '@/lib/queries';
import { formatDay } from '@/lib/time';
import { taskTitle, useCleaningActions } from './api';

export function TaskRow({ task, onEdit, onDelete, compact = false }: { task: CleaningTask; onEdit?: () => void; onDelete?: () => void; compact?: boolean }) {
  const me = useMe().data;
  const today = useMeta().data?.today;
  const who = useMembers().byId.get(task.memberId);
  const { setDone } = useCleaningActions();
  const mine = task.memberId === me?.id;
  const done = task.status === 'done';
  const overdue = !done && !!today && task.date < today;
  const canToggle = mine || me?.isAdmin;
  const day = task.date === today ? 'Today' : formatDay(task.date, { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <Avatar member={who} size={compact ? 'sm' : 'md'} ring={done ? 'want' : 'none'} />
      <div className="min-w-0 flex-1">
        <p className={`font-semibold ${done ? 'text-dusk line-through decoration-haze' : ''}`}>{taskTitle(task)}</p>
        <p className="text-sm text-dusk">
          <span className={overdue ? 'font-semibold text-chili' : ''}>{overdue ? `Overdue, ${day}` : day}</span>
          {', '}
          {mine ? 'you' : who?.name}
          {done && ', done'}
        </p>
        {task.instructions && !compact && <p className="mt-1 text-sm whitespace-pre-line text-dusk">{task.instructions}</p>}
      </div>
      <div className="flex items-center gap-1.5">
        {canToggle &&
          (done ? (
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => setDone.mutate({ task, done: false })}>
              Not done
            </Button>
          ) : (
            <Button size="sm" variant={mine ? 'primary' : 'secondary'} icon={<Check className="size-4" aria-hidden />} onClick={() => setDone.mutate({ task, done: true })}>
              Mark done
            </Button>
          ))}
        {me?.isAdmin && onEdit && (
          <Button size="sm" variant="ghost" aria-label={`Edit ${taskTitle(task)}`} onClick={onEdit} icon={<Pencil className="size-4" aria-hidden />} />
        )}
        {me?.isAdmin && onDelete && (
          <Button size="sm" variant="ghost" aria-label={`Delete ${taskTitle(task)}`} onClick={onDelete} icon={<Trash2 className="size-4" aria-hidden />} />
        )}
      </div>
    </li>
  );
}
