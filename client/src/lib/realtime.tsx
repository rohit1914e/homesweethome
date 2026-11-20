// Live updates for a signed-in tab: one socket, generic cache wiring, reconnect recovery.
// Chat events ('chat:message', 'chat:typing') are handled by the chat feature, not here.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { Member } from '@shared/types';
import { api } from './api';
import { qk, queryClient } from './queries';
import { connectSocket, disconnectSocket, getSocket, useSocketEvent } from './socket';
import { useSignOut } from './auth';

export type SocketStatus = 'connecting' | 'connected' | 'reconnecting';

const StatusContext = createContext<SocketStatus>('connecting');

/** 'reconnecting' only after the socket had connected once and then dropped. */
export function useSocketStatus(): SocketStatus {
  return useContext(StatusContext);
}

function patchMembers(fn: (m: Member) => Member) {
  queryClient.setQueryData<Member[]>(qk.members, (prev) => prev?.map(fn));
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const signOut = useSignOut();

  useEffect(() => {
    const s = getSocket();
    let everConnected = false;
    let dropped = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const onConnect = () => {
      setStatus('connected');
      if (everConnected && dropped) {
        // Back after a gap (e.g. the free server slept): anything may have changed.
        queryClient.invalidateQueries();
      }
      everConnected = true;
      dropped = false;
    };
    const onDisconnect = (reason: string) => {
      if (reason === 'io client disconnect') return; // we asked for it (sign-out / unmount)
      dropped = true;
      if (everConnected) setStatus('reconnecting');
      // A server-side disconnect is not retried automatically by socket.io.
      if (reason === 'io server disconnect') retryTimer = setTimeout(() => s.connect(), 2000);
    };
    const onConnectError = (err: Error) => {
      if (everConnected) setStatus('reconnecting');
      if (!s.active) {
        // The server rejected the handshake (usually: session ended). Ask /me — a 401 there
        // signs this tab out via 'hsh:unauthorized'; otherwise try the socket again shortly.
        api
          .get('/api/auth/me')
          .then(() => {
            retryTimer = setTimeout(() => s.connect(), 4000);
          })
          .catch(() => {
            if (err.message !== 'unauthorized') retryTimer = setTimeout(() => s.connect(), 4000);
          });
      }
    };

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onConnectError);
    connectSocket();
    return () => {
      clearTimeout(retryTimer);
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onConnectError);
      disconnectSocket();
    };
  }, []);

  useSocketEvent('menu:changed', () => {
    queryClient.invalidateQueries({ queryKey: ['cooking'] });
  });
  useSocketEvent('booking:changed', () => {
    queryClient.invalidateQueries({ queryKey: ['washing'] });
  });
  useSocketEvent('member:location', ({ memberId, location, source, updatedAt }) => {
    const apply = (m: Member) => (m.id === memberId ? { ...m, location, locationSource: source, locationUpdatedAt: updatedAt } : m);
    queryClient.setQueryData<Member[]>(qk.members, (old) => old?.map(apply));
    queryClient.setQueryData<Member>(qk.me, (old) => (old ? apply(old) : old));
  });
  useSocketEvent('presence:state', ({ online }) => {
    const ids = new Set(online);
    patchMembers((m) => ({ ...m, online: ids.has(m.id) }));
  });
  useSocketEvent('presence:update', ({ memberId, online, lastSeenAt }) => {
    patchMembers((m) => (m.id === memberId ? { ...m, online, lastSeenAt: lastSeenAt ?? m.lastSeenAt } : m));
  });
  useSocketEvent('notification:new', (n) => {
    queryClient.invalidateQueries({ queryKey: qk.notifications });
    if (n.kind === 'chat_message' && pathRef.current.startsWith('/chat')) return;
    toast(n.title, {
      id: `notification-${n.id}`,
      description: n.body || undefined,
      action: n.link
        ? {
            label: 'Open',
            onClick: () => {
              api.post('/api/notifications/read', { ids: [n.id] }).then(
                () => queryClient.invalidateQueries({ queryKey: qk.notifications }),
                () => undefined,
              );
              navigate(n.link);
            },
          }
        : undefined,
    });
  });
  useSocketEvent('session:revoked', () => {
    toast('You were signed out', { description: 'This account was signed out on every device. Tap your photo to come back in.' });
    signOut({ remote: false });
  });

  return <StatusContext.Provider value={status}>{children}</StatusContext.Provider>;
}
