export const WORK_LABELS = {
  start: 'Start Work',
  loading: 'Loading',
  unloading: 'Unloading',
  breakdown: 'Breakdown',
  other: 'Other',
  end: 'End Work',
};

export const STATUS_LABELS = {
  absent: 'Absent',
  working: 'Working',
  quiet: 'No photo 3h+',
  breakdown: 'Breakdown',
  finished: 'Finished',
  'start-missing': 'Start missing',
  'end-missing': 'End missing',
};

const QUIET_AFTER_MS = 3 * 60 * 60 * 1000;

// Only Start-to-End time counts, so a gap between two shifts in one day is not paid time.
function workedHours(entries) {
  let open = null;
  let total = 0;
  for (const { type, capturedAt } of entries) {
    const at = new Date(capturedAt).getTime();
    if (type === 'start' && open === null) open = at;
    if (type === 'end' && open !== null) {
      total += at - open;
      open = null;
    }
  }
  return total ? (total / 3600000).toFixed(1) : '';
}

// entries: one driver's entries for one day, oldest first.
export function dayState(entries, isToday) {
  if (!entries.length) return { status: 'absent', hours: '' };
  const last = entries.at(-1);
  const hours = workedHours(entries);
  if (!entries.some((entry) => entry.type === 'start')) return { status: 'start-missing', hours };
  if (last.type === 'end') return { status: 'finished', hours };
  if (!isToday) return { status: 'end-missing', hours };
  if (last.type === 'breakdown' && !last.resolved) return { status: 'breakdown', hours };
  const quiet = Date.now() - new Date(last.capturedAt).getTime() > QUIET_AFTER_MS;
  return { status: quiet ? 'quiet' : 'working', hours };
}

export function daySummary(day, entries, today) {
  return {
    day,
    ...dayState(entries, day === today),
    count: entries.length,
    first: entries[0]?.capturedAt ?? null,
    last: entries.at(-1)?.capturedAt ?? null,
  };
}
