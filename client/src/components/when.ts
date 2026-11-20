// Human time phrases in the room timezone ("just now", "12 min ago", "Yesterday, 9:40 pm").
import { formatDateTime, formatTime, roomDateOf, addDays, ROOM_TZ } from '@/lib/time';

export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  const diff = Math.round((now.getTime() - t.getTime()) / 1000);
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} min ago`;
  const today = roomDateOf(now.toISOString());
  const day = roomDateOf(iso);
  if (day === today) return `${Math.round(diff / 3600)} h ago`;
  if (day === addDays(today, -1)) return `Yesterday, ${formatTime(iso)}`;
  return formatDateTime(iso);
}

/** "today at 9:40 pm" / "yesterday at 9:40 pm" / "18 Nov, 9:40 pm" */
export function lastSeenPhrase(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'Not seen yet';
  const today = roomDateOf(now.toISOString());
  const day = roomDateOf(iso);
  if (day === today) return `Last seen today at ${formatTime(iso)}`;
  if (day === addDays(today, -1)) return `Last seen yesterday at ${formatTime(iso)}`;
  return `Last seen ${formatDateTime(iso)}`;
}

/** Current hour (0–23) in the room timezone. */
export function roomHour(now: Date = new Date()): number {
  const h = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: ROOM_TZ }).format(now);
  return Number(h) % 24;
}

export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 23) return 'Good evening';
  return 'Up late';
}
