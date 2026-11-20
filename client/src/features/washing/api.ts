import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Booking } from '@shared/types';
import { api, ApiError, errorMessage } from '@/lib/api';
import { qk } from '@/lib/queries';
import { useSocketEvent } from '@/lib/socket';
import { formatDay } from '@/lib/time';

export const dayShort = (d: string) => formatDay(d, { weekday: 'short', day: 'numeric', month: 'short' });

/** Active bookings in [from, to]. */
export function useBookings(from: string | undefined, to: string | undefined) {
  return useQuery({
    queryKey: [...qk.washingBookings, from, to],
    enabled: !!from && !!to,
    queryFn: () => api.get<{ bookings: Booking[] }>(`/api/washing/bookings?from=${from}&to=${to}`).then((r) => r.bookings),
  });
}

export function useBookingHistory() {
  return useInfiniteQuery({
    queryKey: qk.washingHistory,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      api.get<{ bookings: Booking[]; nextCursor: number | null }>(`/api/washing/history?limit=15${pageParam ? `&before=${pageParam}` : ''}`),
    getNextPageParam: (p) => p.nextCursor,
  });
}

export function useWashingRealtime() {
  const qc = useQueryClient();
  useSocketEvent('booking:changed', () => void qc.invalidateQueries({ queryKey: ['washing'] }));
}

export function useBookingActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['washing'] });
  const book = useMutation({
    mutationFn: (v: { date: string; memberId?: number }) => api.post<{ booking: Booking }>('/api/washing/bookings', v).then((r) => r.booking),
    onSuccess: (b) => {
      toast.success(`Booked ${dayShort(b.date)}`);
      void refresh();
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      if (err instanceof ApiError && err.status === 409) void refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (b: Booking) => api.del(`/api/washing/bookings/${b.id}`).then(() => b),
    onSuccess: (b) => {
      toast.success(`Cancelled booking for ${dayShort(b.date)}`);
      void refresh();
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      void refresh();
    },
  });
  return { book, cancel };
}
