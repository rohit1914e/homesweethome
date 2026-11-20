// Chat data layer: the qk.chatMessages cache, the optimistic outbox, and live updates.
// Shared by ChatPage and the dashboard's RecentMessages so both stay in sync.
import { useEffect, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ChatMessage, Member } from '@shared/types';
import { api, ApiError, errorMessage } from '@/lib/api';
import { queryClient, qk } from '@/lib/queries';
import { getSocket, useSocketEvent } from '@/lib/socket';

export const CHAT_MAX_LENGTH = 2000;
export const PAGE_SIZE = 50;

export interface ChatCache {
  messages: ChatMessage[];
  hasMore: boolean;
}

interface Page {
  messages: ChatMessage[];
  hasMore: boolean;
}

/** Union by id, ascending. Later entries win (fresher copy of the same row). */
function unionById(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const map = new Map<number, ChatMessage>();
  for (const m of a) map.set(m.id, m);
  for (const m of b) map.set(m.id, m);
  return [...map.values()].sort((x, y) => x.id - y.id);
}

/**
 * Fetch the newest page and fold it into whatever is already cached, so a refetch
 * (focus, reconnect) never throws away earlier pages the user scrolled back to.
 * If the gap between the cache and the new page can't be bridged, start over from the new page.
 */
async function fetchLatest(): Promise<ChatCache> {
  const page = await api.get<Page>(`/api/chat/messages?limit=${PAGE_SIZE}`);
  const prev = queryClient.getQueryData<ChatCache>(qk.chatMessages);
  if (!prev || prev.messages.length === 0 || page.messages.length === 0) return page;
  const prevNewest = prev.messages[prev.messages.length - 1]!.id;
  const pageOldest = page.messages[0]!.id;
  // Ids are not contiguous (a skipped insert still uses a sequence value), so any page that starts
  // after our newest row while older ones exist might hide a gap — take the fresh page alone.
  if (page.hasMore && pageOldest > prevNewest) return page;
  // Drop cached rows inside the fetched range that the server no longer has (e.g. after a restore).
  const fetchedIds = new Set(page.messages.map((m) => m.id));
  const kept = prev.messages.filter((m) => m.id < pageOldest || fetchedIds.has(m.id));
  return { messages: unionById(kept, page.messages), hasMore: prev.hasMore };
}

export function useChatMessages() {
  return useQuery({ queryKey: qk.chatMessages, queryFn: fetchLatest });
}

/** Insert or refresh one message in the cache (socket echo, POST response). */
export function mergeMessage(message: ChatMessage): void {
  queryClient.setQueryData<ChatCache>(qk.chatMessages, (old) =>
    old ? { ...old, messages: unionById(old.messages, [message]) } : old,
  );
  outbox.resolve(message);
}

/** Keyset "load earlier": prepend the page before the oldest cached message. */
export async function loadEarlier(): Promise<void> {
  const cache = queryClient.getQueryData<ChatCache>(qk.chatMessages);
  const oldest = cache?.messages[0]?.id;
  if (!cache || !oldest || !cache.hasMore) return;
  const page = await api.get<Page>(`/api/chat/messages?before=${oldest}&limit=${PAGE_SIZE}`);
  queryClient.setQueryData<ChatCache>(qk.chatMessages, (old) =>
    old ? { messages: unionById(page.messages, old.messages), hasMore: page.hasMore } : old,
  );
}

// ---- Outbox: optimistic messages not yet confirmed by the server --------------------------
export interface OutboxMessage {
  clientId: string;
  memberId: number;
  body: string;
  createdAt: string;
  status: 'pending' | 'failed';
  error?: string;
}

type Listener = () => void;

const outbox = (() => {
  let items: OutboxMessage[] = [];
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((l) => l());
  return {
    subscribe(l: Listener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    get: () => items,
    add(item: OutboxMessage) {
      items = [...items, item];
      emit();
    },
    update(clientId: string, patch: Partial<OutboxMessage>) {
      items = items.map((m) => (m.clientId === clientId ? { ...m, ...patch } : m));
      emit();
    },
    /** A confirmed message replaces its optimistic copy. */
    resolve(message: ChatMessage) {
      if (!message.clientId || !items.some((m) => m.clientId === message.clientId && m.memberId === message.memberId)) return;
      items = items.filter((m) => !(m.clientId === message.clientId && m.memberId === message.memberId));
      emit();
    },
    clear() {
      items = [];
      emit();
    },
  };
})();

export function useOutbox(): OutboxMessage[] {
  return useSyncExternalStore(outbox.subscribe, outbox.get, outbox.get);
}

function newClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for very old browsers / insecure contexts: RFC 4122 v4 from getRandomValues.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function deliver(item: OutboxMessage): Promise<void> {
  try {
    const { message } = await api.post<{ message: ChatMessage }>('/api/chat/messages', {
      body: item.body,
      clientId: item.clientId,
    });
    mergeMessage(message);
  } catch (err) {
    const msg = err instanceof ApiError && err.status !== 0 ? err.message : errorMessage(err);
    outbox.update(item.clientId, { status: 'failed', error: msg });
    // Network failures speak for themselves in the bubble; server refusals (rate limit, length) get a reason.
    if (err instanceof ApiError && err.status !== 0) toast.error(msg);
  }
}

/** Optimistically append, then POST. Returns false when there is nothing to send. */
export function sendMessage(body: string, memberId: number): boolean {
  const text = body.trim();
  if (!text || text.length > CHAT_MAX_LENGTH) return false;
  const item: OutboxMessage = {
    clientId: newClientId(),
    memberId,
    body: text,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  outbox.add(item);
  void deliver(item);
  return true;
}

/** Same clientId, so a send that actually landed is not duplicated. */
export function retryMessage(clientId: string): void {
  const item = outbox.get().find((m) => m.clientId === clientId);
  if (!item || item.status === 'pending') return;
  outbox.update(clientId, { status: 'pending', error: undefined });
  void deliver({ ...item, status: 'pending' });
}

/** Signing out / switching member must not leak drafts between accounts. */
export function clearOutbox(): void {
  outbox.clear();
}

// ---- Live updates --------------------------------------------------------------------------
/** Merge pushed messages, and refetch after a reconnect so nothing sent meanwhile is missed. */
export function useChatLive(): void {
  useSocketEvent('chat:message', (m) => {
    if (queryClient.getQueryData(qk.chatMessages)) mergeMessage(m);
    else void queryClient.invalidateQueries({ queryKey: qk.chatMessages });
  });
  useEffect(() => {
    const s = getSocket();
    const onConnect = () => void queryClient.invalidateQueries({ queryKey: qk.chatMessages });
    s.on('connect', onConnect);
    return () => {
      s.off('connect', onConnect);
    };
  }, []);
}

/** Keep Member.online in the members cache current from presence events. */
export function usePresenceSync(): void {
  useSocketEvent('presence:update', (p) => {
    queryClient.setQueryData<Member[]>(qk.members, (old) =>
      old?.map((m) => (m.id === p.memberId ? { ...m, online: p.online, lastSeenAt: p.lastSeenAt ?? m.lastSeenAt } : m)),
    );
  });
  useSocketEvent('presence:state', (p) => {
    const online = new Set(p.online);
    queryClient.setQueryData<Member[]>(qk.members, (old) => old?.map((m) => ({ ...m, online: online.has(m.id) })));
  });
}
