export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Today and yesterday are named rather than dated, because a date someone has
 * to convert in their head is worse than no date at all.
 */
export function formatDay(at: number): string {
  const day = new Date(at);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);

  if (isSameDay(day, today)) return 'Today';
  if (isSameDay(day, yesterday)) return 'Yesterday';

  return day.toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(day.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
