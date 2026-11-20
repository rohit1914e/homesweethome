// Cooking data: queries, mutations (optimistic votes) and the live 'menu:changed' subscription.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Menu, MenuInput, Vote, VoteChoice } from '@shared/types';
import { api, ApiError, errorMessage } from '@/lib/api';
import { qk } from '@/lib/queries';
import { useSocketEvent } from '@/lib/socket';

export const HOUSEHOLD_SIZE = 6;

type MenusPage = { menus: Menu[]; nextCursor: number | null };

export function useTodayMenus() {
  return useQuery({
    queryKey: qk.cookingToday,
    queryFn: () => api.get<{ menus: Menu[] }>('/api/cooking/today').then((r) => r.menus),
  });
}

export function useMenuHistory(limit = 10) {
  return useInfiniteQuery({
    queryKey: qk.cookingHistory,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      api.get<MenusPage>(`/api/cooking/menus?limit=${limit}${pageParam ? `&before=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Everyone's cooking views refetch the moment anything changes on the server. */
export function useCookingRealtime() {
  const qc = useQueryClient();
  useSocketEvent('menu:changed', () => {
    void qc.invalidateQueries({ queryKey: ['cooking'] });
  });
}

// ---------------------------------------------------------------------------
// Cache helpers: apply one menu change to every cached list that contains it.
// ---------------------------------------------------------------------------
function patchMenuEverywhere(qc: QueryClient, id: number, fn: (m: Menu) => Menu) {
  qc.setQueryData<Menu[]>(qk.cookingToday, (old) => old?.map((m) => (m.id === id ? fn(m) : m)));
  qc.setQueryData<InfiniteData<MenusPage>>(qk.cookingHistory, (old) =>
    old
      ? { ...old, pages: old.pages.map((p) => ({ ...p, menus: p.menus.map((m) => (m.id === id ? fn(m) : m)) })) }
      : old,
  );
}

export function withVote(menu: Menu, memberId: number, choice: VoteChoice): Menu {
  const vote: Vote = { memberId, choice, updatedAt: new Date().toISOString() };
  const votes = [...menu.votes.filter((v) => v.memberId !== memberId), vote].sort((a, b) => a.memberId - b.memberId);
  const want = votes.filter((v) => v.choice === 'want').length;
  const dontWant = votes.length - want;
  return { ...menu, votes, myVote: choice, tally: { want, dontWant, pending: Math.max(0, HOUSEHOLD_SIZE - want - dontWant) } };
}

export function useVote(myId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ menuId, choice }: { menuId: number; choice: VoteChoice }) =>
      api.put<{ menu: Menu }>(`/api/cooking/menus/${menuId}/vote`, { choice }).then((r) => r.menu),
    onMutate: async ({ menuId, choice }) => {
      await qc.cancelQueries({ queryKey: ['cooking'] });
      const prevToday = qc.getQueryData<Menu[]>(qk.cookingToday);
      const prevHistory = qc.getQueryData<InfiniteData<MenusPage>>(qk.cookingHistory);
      if (myId !== undefined) patchMenuEverywhere(qc, menuId, (m) => withVote(m, myId, choice));
      return { prevToday, prevHistory };
    },
    onError: (err, _vars, ctx) => {
      if (ctx) {
        qc.setQueryData(qk.cookingToday, ctx.prevToday);
        qc.setQueryData(qk.cookingHistory, ctx.prevHistory);
      }
      toast.error(errorMessage(err));
    },
    onSuccess: (menu) => patchMenuEverywhere(qc, menu.id, () => menu),
    onSettled: () => qc.invalidateQueries({ queryKey: ['cooking'] }),
  });
}

/** Rohit's menu actions. Each toast repeats its button label in the past tense. */
export function useMenuAdmin() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['cooking'] });
  const onError = (err: unknown) => {
    toast.error(errorMessage(err));
    if (err instanceof ApiError && err.status === 404) void refresh();
  };

  const publish = useMutation({
    mutationFn: (input: MenuInput) => api.post<{ menu: Menu }>('/api/cooking/menus', input).then((r) => r.menu),
    onSuccess: (m) => {
      toast.success(`Published ${m.title}`);
      void refresh();
    },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: number; input: Partial<MenuInput> }) =>
      api.patch<{ menu: Menu }>(`/api/cooking/menus/${id}`, input).then((r) => r.menu),
    onSuccess: (m) => {
      toast.success('Saved changes');
      patchMenuEverywhere(qc, m.id, () => m);
      void refresh();
    },
    onError,
  });
  const close = useMutation({
    mutationFn: (id: number) => api.post<{ menu: Menu }>(`/api/cooking/menus/${id}/close`).then((r) => r.menu),
    onSuccess: (m) => {
      toast.success(`Closed voting on ${m.title}`);
      patchMenuEverywhere(qc, m.id, () => m);
      void refresh();
    },
    onError,
  });
  const reopen = useMutation({
    mutationFn: (id: number) => api.post<{ menu: Menu }>(`/api/cooking/menus/${id}/reopen`).then((r) => r.menu),
    onSuccess: (m) => {
      toast.success(`Reopened voting on ${m.title}`);
      patchMenuEverywhere(qc, m.id, () => m);
      void refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (menu: Menu) => api.del(`/api/cooking/menus/${menu.id}`).then(() => menu),
    onSuccess: (m) => {
      toast.success(`Deleted ${m.title}`);
      void refresh();
    },
    onError,
  });
  return { publish, update, close, reopen, remove };
}
