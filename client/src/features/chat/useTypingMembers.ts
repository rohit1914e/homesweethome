import { useEffect, useState } from 'react';
import { useSocketEvent } from '@/lib/socket';

/** If a "stopped typing" signal is lost, drop the indicator after this long anyway. */
const STALE_MS = 7_000;

/** Ids of members currently typing (never includes me — the server doesn't echo my own). */
export function useTypingMembers(meId: number | undefined): number[] {
  const [typing, setTyping] = useState<Map<number, number>>(() => new Map());

  useSocketEvent('chat:typing', ({ memberId, typing: on }) => {
    if (memberId === meId) return;
    setTyping((old) => {
      const next = new Map(old);
      if (on) next.set(memberId, Date.now() + STALE_MS);
      else next.delete(memberId);
      return next;
    });
  });

  // Someone who just sent a message has stopped typing.
  useSocketEvent('chat:message', ({ memberId }) => {
    setTyping((old) => {
      if (!old.has(memberId)) return old;
      const next = new Map(old);
      next.delete(memberId);
      return next;
    });
  });

  useEffect(() => {
    if (typing.size === 0) return;
    const t = setInterval(() => {
      const now = Date.now();
      setTyping((old) => {
        const next = new Map([...old].filter(([, exp]) => exp > now));
        return next.size === old.size ? old : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [typing.size]);

  return [...typing.keys()].sort((a, b) => a - b);
}
