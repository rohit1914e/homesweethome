// In-memory presence: a member is online while at least one of their sockets is connected
// (several tabs / devices count once). Single-process by design (Render free = one instance).

const socketsByMember = new Map<number, Set<string>>();

/** Records a socket. Returns true when this is the member's first socket (they just came online). */
export function addSocket(memberId: number, socketId: string): boolean {
  let set = socketsByMember.get(memberId);
  const first = !set || set.size === 0;
  if (!set) {
    set = new Set();
    socketsByMember.set(memberId, set);
  }
  set.add(socketId);
  return first;
}

/** Forgets a socket. Returns true when it was the member's last one (they just went offline). */
export function removeSocket(memberId: number, socketId: string): boolean {
  const set = socketsByMember.get(memberId);
  if (!set || !set.delete(socketId)) return false;
  if (set.size === 0) {
    socketsByMember.delete(memberId);
    return true;
  }
  return false;
}

export function onlineIds(): number[] {
  return [...socketsByMember.keys()].sort((a, b) => a - b);
}

export function isMemberOnline(memberId: number): boolean {
  return (socketsByMember.get(memberId)?.size ?? 0) > 0;
}

export function resetPresence(): void {
  socketsByMember.clear();
}
