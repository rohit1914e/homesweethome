// Rohit only: the automatic 6-day cleanup log.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eraser } from 'lucide-react';
import { toast } from 'sonner';
import type { MaintenanceRun } from '@shared/types';
import { Button, Card, ConfirmDialog } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/time';
import { useState } from 'react';

const LABELS: Record<string, string> = {
  chat_messages: 'chat messages',
  notifications: 'notifications',
  cooking_menus: 'old menus',
  cooking_votes: 'old votes',
  expired_sessions: 'expired sign-ins',
};

export function CleanupCard() {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const log = useQuery({
    queryKey: ['admin', 'maintenance'],
    queryFn: () => api.get<{ runs: MaintenanceRun[]; nextDueAt: string | null }>('/api/admin/maintenance'),
  });
  const run = useMutation({
    mutationFn: () => api.post<{ deleted: Record<string, number> }>('/api/admin/maintenance/run'),
    onSuccess: (r) => {
      const total = Object.values(r.deleted).reduce((a, b) => a + b, 0);
      toast.success(total ? `Cleaned up ${total} old items` : 'Cleaned up: nothing was old enough to remove');
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => setConfirm(false),
  });
  const runs = log.data?.runs ?? [];
  return (
    <Card>
      <h2 className="flex items-center gap-2 text-xl font-bold"><Eraser className="size-5 text-dusk" aria-hidden /> Automatic cleanup</h2>
      <p className="mt-1 text-sm text-dusk">
        Every 6 days, chat messages and notifications older than 6 days, expired sign-ins and menus older than yesterday are removed.
        Accounts, photos, status, bookings, cleaning duties and settings are never touched. What was removed is saved first; the last 3 are kept here.
      </p>
      <p className="mt-2 text-sm">
        {log.data?.nextDueAt ? `Next cleanup due ${formatDateTime(log.data.nextDueAt)}.` : 'The first cleanup runs shortly after the server starts.'}
      </p>
      {runs.length > 0 && (
        <ul className="mt-3 flex flex-col divide-y divide-seam text-sm">
          {runs.slice(0, 5).map((r) => {
            const parts = Object.entries(r.deleted).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${LABELS[k] ?? k}`);
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-semibold">{formatDateTime(r.startedAt)}</span>
                  <span className="text-dusk">, {r.status === 'succeeded' ? (parts.length ? parts.join(', ') : 'nothing to remove') : `failed (nothing removed)`}</span>
                </span>
                {r.hasBackup && (
                  <a href={`/api/admin/maintenance/${r.id}/backup`} download className="inline-flex items-center gap-1 font-semibold text-lamp hover:underline">
                    <Download className="size-4" aria-hidden /> Removed items
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Button className="mt-3" size="sm" variant="secondary" onClick={() => setConfirm(true)}>Run cleanup now</Button>
      <ConfirmDialog
        open={confirm}
        title="Run the cleanup now?"
        description="Removes chat messages and notifications older than 6 days, expired sign-ins and menus older than yesterday. A copy of what's removed is saved here first."
        confirmLabel="Run cleanup"
        loading={run.isPending}
        onCancel={() => setConfirm(false)}
        onConfirm={() => run.mutate()}
      />
    </Card>
  );
}
