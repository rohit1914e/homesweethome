// Real-time "Jagan is typing…" relay. Identity comes from the authenticated socket's member —
// the payload only carries a boolean, and anything else is ignored.
import { broadcastExcept, onSocketConnection } from './realtime.js';

/** Typing auto-clears this long after the last "typing: true" from a socket. */
export const TYPING_TIMEOUT_MS = 5_000;
/** While typing stays true, re-announce at most this often (keeps late joiners in sync). */
const KEEPALIVE_MS = 3_000;
/** Hard cap on incoming typing events per socket per second; extras are dropped. */
const MAX_EVENTS_PER_SECOND = 10;

export function registerChatSocket(): void {
  onSocketConnection((socket, member) => {
    let typing = false;
    let lastAnnounced = 0;
    let clearTimer: ReturnType<typeof setTimeout> | undefined;
    let windowStart = 0;
    let windowCount = 0;

    const announce = (next: boolean) => {
      typing = next;
      lastAnnounced = Date.now();
      broadcastExcept(member.id, 'chat:typing', { memberId: member.id, typing: next });
    };

    const stop = () => {
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = undefined;
      if (typing) announce(false);
    };

    socket.on('chat:typing', (payload: unknown) => {
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        windowCount = 0;
      }
      if (++windowCount > MAX_EVENTS_PER_SECOND) return;

      if (typeof payload !== 'object' || payload === null) return;
      const value = (payload as { typing?: unknown }).typing;
      if (typeof value !== 'boolean') return;

      if (!value) {
        stop();
        return;
      }
      if (!typing || now - lastAnnounced >= KEEPALIVE_MS) announce(true);
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => {
        clearTimer = undefined;
        if (typing) announce(false);
      }, TYPING_TIMEOUT_MS);
    });

    socket.on('disconnect', stop);
  });
}
