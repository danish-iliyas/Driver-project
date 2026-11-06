import { dayOf } from './time';
import { MAX_SHIFT_MS } from './work';

// The latest START or END of a driver at or before a time.
export function lastMarker(photos, driverId, at = new Date()) {
  return photos.findOne(
    { driverId, type: { $in: ['start', 'end'] }, capturedAt: { $lte: at } },
    { sort: { capturedAt: -1 }, projection: { type: 1, day: 1, capturedAt: 1 } },
  );
}

export const isOpen = (marker, at = new Date()) =>
  marker?.type === 'start' && at - marker.capturedAt < MAX_SHIFT_MS;

// Photos after midnight belong to the date the shift started.
export async function shiftDayFor(photos, driverId, type, capturedAt) {
  if (type !== 'start') {
    const marker = await lastMarker(photos, driverId, capturedAt);
    if (isOpen(marker, capturedAt)) return marker.day;
  }
  return dayOf(capturedAt);
}
