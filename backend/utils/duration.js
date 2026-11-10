/** Formats a minute count as "2h 15m" for quote display. Shared by flight providers. */
export function minutesToDuration(totalMinutes) {
  const mins = Number(totalMinutes) || 0;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h && !m) return '—';
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}
