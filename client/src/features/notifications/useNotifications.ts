import { useMutation, useQuery } from '@tanstack/react-query';
import type { AppNotification } from '@shared/types';
import { api } from '@/lib/api';
import { qk, queryClient } from '@/lib/queries';

type NotificationsResponse = { notifications: AppNotification[]; unread: number };

export function useNotifications() {
  return useQuery({
    queryKey: qk.notifications,
    queryFn: () => api.get<NotificationsResponse>('/api/notifications'),
  });
}

/** Unread chat notifications (one coalesced row) → badge on the Chat tab. */
export function useUnreadChatCount(): number {
  const { data } = useNotifications();
  return (data?.notifications ?? []).filter((n) => n.kind === 'chat_message' && !n.readAt).reduce((sum, n) => sum + Math.max(1, n.count), 0);
}

/** Mark some (ids) or all (no ids) notifications read, optimistically. */
export function useMarkRead() {
  return useMutation({
    mutationFn: (ids?: number[]) => api.post<void>('/api/notifications/read', ids ? { ids } : {}),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: qk.notifications });
      const prev = queryClient.getQueryData<NotificationsResponse>(qk.notifications);
      if (prev) {
        const now = new Date().toISOString();
        const hit = (n: AppNotification) => !n.readAt && (!ids || ids.includes(n.id));
        const marked = prev.notifications.filter(hit).length;
        queryClient.setQueryData<NotificationsResponse>(qk.notifications, {
          notifications: prev.notifications.map((n) => (hit(n) ? { ...n, readAt: now } : n)),
          unread: Math.max(0, prev.unread - marked),
        });
      }
      return { prev };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(qk.notifications, ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.notifications }),
  });
}
