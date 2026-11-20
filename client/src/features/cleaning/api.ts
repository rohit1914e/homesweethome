import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CleaningCategory, CleaningTask } from '@shared/types';
import { api, errorMessage } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';

export const CLEANING_KEY = ['cleaning', 'tasks'] as const;

export const CATEGORY_LABELS: Record<CleaningCategory, string> = {
  floor: 'Floor cleaning',
  wall: 'Wall cleaning',
  bathroom: 'Bathroom cleaning',
  dusting: 'Dusting',
  sweeping: 'Room sweeping',
  mopping: 'Mopping',
  custom: 'Custom task',
};
export const CATEGORIES = Object.keys(CATEGORY_LABELS) as CleaningCategory[];
export const taskTitle = (t: Pick<CleaningTask, 'category' | 'customTitle'>) =>
  t.category === 'custom' ? (t.customTitle ?? 'Custom task') : CATEGORY_LABELS[t.category];

export function useCleaningTasks() {
  const qc = useQueryClient();
  useSocketEvent('cleaning:changed', () => void qc.invalidateQueries({ queryKey: ['cleaning'] }));
  return useQuery({
    queryKey: CLEANING_KEY,
    queryFn: () => api.get<{ tasks: CleaningTask[] }>('/api/cleaning/tasks').then((r) => r.tasks),
  });
}

export interface AssignInput {
  memberId: number;
  date: string;
  categories: CleaningCategory[];
  customTitle?: string;
  instructions?: string;
}

export function useCleaningActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['cleaning'] });
  const onError = (e: unknown) => {
    toast.error(errorMessage(e));
    void refresh();
  };
  const assign = useMutation({
    mutationFn: (b: AssignInput) => api.post<{ tasks: CleaningTask[] }>('/api/cleaning/tasks', b).then((r) => r.tasks),
    onSuccess: (tasks) => {
      toast.success(tasks.length > 1 ? `Assigned ${tasks.length} duties` : 'Assigned the duty');
      void refresh();
    },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, ...b }: Partial<Omit<AssignInput, 'categories'>> & { id: number; category?: CleaningCategory }) =>
      api.patch<{ task: CleaningTask }>(`/api/cleaning/tasks/${id}`, b).then((r) => r.task),
    onSuccess: () => {
      toast.success('Saved changes');
      void refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (t: CleaningTask) => api.del(`/api/cleaning/tasks/${t.id}`).then(() => t),
    onSuccess: (t) => {
      toast.success(`Deleted ${taskTitle(t)}`);
      void refresh();
    },
    onError,
  });
  const setDone = useMutation({
    mutationFn: ({ task, done }: { task: CleaningTask; done: boolean }) =>
      api.post<{ task: CleaningTask }>(`/api/cleaning/tasks/${task.id}/${done ? 'complete' : 'reopen'}`).then((r) => r.task),
    onMutate: ({ task, done }) => {
      qc.setQueryData<CleaningTask[]>(CLEANING_KEY, (old) =>
        old?.map((t) => (t.id === task.id ? { ...t, status: done ? 'done' : 'pending', completedAt: done ? new Date().toISOString() : null } : t)),
      );
    },
    onSuccess: (t) => {
      toast.success(t.status === 'done' ? `Marked ${taskTitle(t)} as done` : `Marked ${taskTitle(t)} as not done`);
      void refresh();
    },
    onError,
  });
  return { assign, update, remove, setDone };
}
