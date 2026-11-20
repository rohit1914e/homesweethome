import { formatDay } from '@/lib/time';

/** "Tue 24 Nov" — the short form used in buttons and toasts. */
export function shortDay(d: string): string {
  const day = formatDay(d, { day: 'numeric' });
  const wd = formatDay(d, { weekday: 'short' });
  const mon = formatDay(d, { month: 'short' });
  return `${wd} ${day} ${mon}`;
}

/** "Saturday, 21 November" — used in confirmations. */
export function longDay(d: string): string {
  return `${formatDay(d, { weekday: 'long' })}, ${formatDay(d, { day: 'numeric' })} ${formatDay(d, { month: 'long' })}`;
}

/** "Today", "Tomorrow", "Yesterday" or the short day. */
export function relativeDay(d: string, today: string | undefined): string {
  if (!today) return shortDay(d);
  const diff = Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return shortDay(d);
}
