// Sign-in / sign-out flows and the global "you're signed out" listener.
import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type { Member } from '@shared/types';
import { api } from './api';
import { qk, queryClient } from './queries';
import { disconnectSocket } from './socket';

export type LoginState = { from?: string };

/** Where to go after signing in; never back to /login itself. */
export function safeFrom(state: unknown): string {
  const from = (state as LoginState | null)?.from;
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/login') ? from : '/';
}

/** Drop everything this tab knows about the signed-in member. */
function forgetSession() {
  disconnectSocket();
  queryClient.cancelQueries();
  queryClient.clear();
}

export function useLogin() {
  return useMutation({
    mutationFn: (vars: { memberId: number; pin?: string }) => api.post<{ member: Member }>('/api/auth/login', vars).then((r) => r.member),
    onSuccess: (member) => {
      queryClient.clear();
      queryClient.setQueryData(qk.me, member);
    },
  });
}

/**
 * Sign out of this device. `remote: false` skips the server call (used when the server
 * already ended the session, e.g. "session:revoked").
 */
export function useSignOut() {
  const navigate = useNavigate();
  return useCallback(
    async (opts: { remote?: boolean } = {}) => {
      if (opts.remote !== false) {
        try {
          await api.post('/api/auth/logout');
        } catch {
          // Cookie may already be gone or the server asleep; signing out locally is still right.
        }
      }
      navigate('/login', { replace: true });
      // Let the signed-in tree unmount before the cache empties, so nothing refetches /me.
      setTimeout(forgetSession, 0);
    },
    [navigate],
  );
}

/** api.ts fires 'hsh:unauthorized' on any 401 → send this tab to the login screen. */
export function useUnauthorizedRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const locRef = useRef(location);
  locRef.current = location;
  useEffect(() => {
    const onUnauthorized = () => {
      const loc = locRef.current;
      if (loc.pathname === '/login') return; // expected there (the login screen asks /me)
      const from = loc.pathname + loc.search + loc.hash;
      navigate('/login', { replace: true, state: { from } satisfies LoginState });
      setTimeout(forgetSession, 0);
    };
    window.addEventListener('hsh:unauthorized', onUnauthorized);
    return () => window.removeEventListener('hsh:unauthorized', onUnauthorized);
  }, [navigate]);
}
