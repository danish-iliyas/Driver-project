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

// A shift stays open this long after START, so a night shift keeps its start date after midnight.
export const MAX_SHIFT_MS = 18 * 60 * 60 * 1000;
export const OPEN_STATUSES = ['working', 'quiet', 'breakdown'];
const QUIET_AFTER_MS = 3 * 60 * 60 * 1000;

const isMarker = (entry) => entry.type === 'start' || entry.type === 'end';

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

// entries: one driver's entries for one shift date, oldest first.
export function dayState(entries, now = Date.now()) {
  if (!entries.length) return { status: 'absent', hours: '' };
  const hours = workedHours(entries);
  if (!entries.some((entry) => entry.type === 'start')) return { status: 'start-missing', hours };
  // A photo sent after END does not reopen the day.
  const marker = entries.findLast(isMarker);
  if (marker.type === 'end') return { status: 'finished', hours };
  if (now - new Date(marker.capturedAt).getTime() > MAX_SHIFT_MS) return { status: 'end-missing', hours };
  const last = entries.at(-1);
  if (last.type === 'breakdown' && !last.resolved) return { status: 'breakdown', hours };
  const quiet = now - new Date(last.capturedAt).getTime() > QUIET_AFTER_MS;
  return { status: quiet ? 'quiet' : 'working', hours };
}

export function daySummary(day, entries, now = Date.now()) {
  return {
    day,
    ...dayState(entries, now),
    count: entries.length,
    first: entries[0]?.capturedAt ?? null,
    last: entries.at(-1)?.capturedAt ?? null,
    start: entries.find((entry) => entry.type === 'start')?.capturedAt ?? null,
    end: entries.findLast((entry) => entry.type === 'end')?.capturedAt ?? null,
  };
}
