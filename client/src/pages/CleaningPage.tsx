import { useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import type { CleaningTask } from '@shared/types';
import { Button, Card, ConfirmDialog, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { AssignDialog } from '@/features/cleaning/AssignDialog';
import { TaskRow } from '@/features/cleaning/TaskRow';
import { taskTitle, useCleaningActions, useCleaningTasks } from '@/features/cleaning/api';
import { useMe } from '@/lib/queries';

export default function CleaningPage() {
  const me = useMe().data;
  const tasks = useCleaningTasks();
  const { remove } = useCleaningActions();
  const [editing, setEditing] = useState<CleaningTask | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CleaningTask | null>(null);
  const pending = (tasks.data ?? []).filter((t) => t.status === 'pending');
  const done = (tasks.data ?? []).filter((t) => t.status === 'done');
  const admin = !!me?.isAdmin;

  const list = (items: CleaningTask[]) => (
    <ul className="divide-y divide-seam">
      {items.map((t) => (
        <TaskRow key={t.id} task={t} onEdit={admin ? () => setEditing(t) : undefined} onDelete={admin ? () => setDeleting(t) : undefined} />
      ))}
    </ul>
  );

  return (
    <div>
      <PageHeader
        title="Room cleaning"
        description={admin ? 'Assign cleaning duties and track them.' : 'Your cleaning duties, assigned by Rohit.'}
        actions={admin && <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setEditing('new')}>Assign duties</Button>}
      />
      {tasks.isPending ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card>
            <h2 className="text-lg font-bold">Pending <span className="text-dusk">({pending.length})</span></h2>
            {pending.length ? (
              list(pending)
            ) : (
              <EmptyState
                icon={<Sparkles />}
                title={admin ? 'Nothing pending' : 'No cleaning duties for you'}
                description={admin ? 'Assign duties and they will show up here.' : "You'll get a notification when Rohit assigns you one."}
                action={admin && <Button onClick={() => setEditing('new')}>Assign duties</Button>}
              />
            )}
          </Card>
          <Card>
            <h2 className="text-lg font-bold">Completed <span className="text-dusk">({done.length})</span></h2>
            {done.length ? list(done) : <p className="mt-2 text-sm text-dusk">Finished duties appear here.</p>}
          </Card>
        </div>
      )}
      {editing && <AssignDialog task={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        title={deleting ? `Delete ${taskTitle(deleting)}?` : ''}
        description="The duty will be removed for everyone."
        confirmLabel="Delete duty"
        tone="danger"
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting, { onSettled: () => setDeleting(null) })}
      />
    </div>
  );
}
