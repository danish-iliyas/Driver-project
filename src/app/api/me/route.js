import { collections } from '@/lib/db';
import { fail, getSession } from '@/lib/auth';
import { isOpen, lastMarker } from '@/lib/shift';
import { dayOf } from '@/lib/time';

export async function GET() {
  const session = await getSession('driver');
  if (!session) return fail(401, 'Please log in');
  const { drivers, photos } = await collections();
  const driver = await drivers.findOne({ _id: session.driverId, active: true });
  if (!driver) return fail(401, 'Please log in');

  const now = new Date();
  const today = dayOf(now);
  const marker = await lastMarker(photos, driver._id, now);
  const working = isOpen(marker, now);
  // An open night shift, or one that ended this morning, still shows its own photos.
  const endedToday = marker?.type === 'end' && dayOf(marker.capturedAt) === today;
  const shift = { driverId: driver._id, day: working || endedToday ? marker.day : today };
  const [todayCount, last] = await Promise.all([
    photos.countDocuments(shift),
    photos.findOne(shift, { sort: { capturedAt: -1 }, projection: { _id: 0, type: 1, capturedAt: 1 } }),
  ]);
  return Response.json({
    id: driver._id,
    name: driver.name,
    vehicle: driver.vehicle,
    todayCount,
    last,
    working,
    shiftStartedAt: working ? marker.capturedAt : null,
  });
}
