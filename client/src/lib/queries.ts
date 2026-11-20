// Shared React Query keys + hooks. Feature code invalidates these keys on socket events.
import { QueryClient, useQuery } from '@tanstack/react-query';
import type { Member, Meta } from '@shared/types';
import { api } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: 0 },
  },
});

export const qk = {
  me: ['me'] as const,
  members: ['members'] as const,
  meta: ['meta'] as const,
  cookingToday: ['cooking', 'today'] as const,
  cookingHistory: ['cooking', 'history'] as const,
  cookingMenu: (id: number) => ['cooking', 'menu', id] as const,
  washingBookings: ['washing', 'bookings'] as const,
  washingHistory: ['washing', 'history'] as const,
  chatMessages: ['chat', 'messages'] as const,
  notifications: ['notifications'] as const,
};

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => api.get<{ member: Member }>('/api/auth/me').then((r) => r.member),
    retry: false,
  });
}

export function useMembers() {
  const q = useQuery({
    queryKey: qk.members,
    queryFn: () => api.get<{ members: Member[] }>('/api/members').then((r) => r.members),
  });
  const byId = new Map<number, Member>((q.data ?? []).map((m) => [m.id, m]));
  return { ...q, members: q.data ?? [], byId };
}

export function useMeta() {
  return useQuery({
    queryKey: qk.meta,
    queryFn: () => api.get<Meta>('/api/meta'),
    refetchInterval: 60_000, // the booking window rolls over at midnight IST
  });
}
