import type { Member } from '@shared/types';
import { addDays, formatDay, roomDateOf } from '@/lib/time';

/** "Today", "Yesterday", or "Mon 16 Nov" for a room-timezone date. */
export function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  const label = formatDay(day, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/,/g, '');
  return day.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${day.slice(0, 4)}`;
}

export function roomToday(): string {
  return roomDateOf(new Date().toISOString());
}

/** "Jagan is typing…", "Jagan and Surya are typing…", "Jagan, Surya and Dharun are typing…". */
export function typingSentence(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length > 3) return 'Several people are typing…';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are typing…`;
}

export function nameOf(byId: Map<number, Member>, id: number): string {
  return byId.get(id)?.name ?? 'Someone';
}

/** One-line preview for lists. */
export function snippet(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}
