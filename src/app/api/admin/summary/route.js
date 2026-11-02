import { collections, imageStorageBytes } from '@/lib/db';
import { adminOnly, validDay } from '@/lib/admin';
import { dayOf } from '@/lib/time';
import { dayState } from '@/lib/work';

const MAX_ALERTS = 20;

export async function GET(request) {
  const denied = await adminOnly();
  if (denied) return denied;

  const today = dayOf(new Date());
  const requested = request.nextUrl.searchParams.get('day');
  const day = validDay(requested) ? requested : today;
  const { drivers, photos } = await collections();

  const [list, entries, breakdowns, storageBytes] = await Promise.all([
    drivers.find().sort({ name: 1 }).toArray(),
    photos
      .find({ day }, { projection: { driverId: 1, type: 1, capturedAt: 1, resolved: 1, lat: 1, lng: 1, place: 1, late: 1, lowAccuracy: 1 } })
      .sort({ capturedAt: 1 })
      .toArray(),
    photos.find({ type: 'breakdown', resolved: { $ne: true } }).sort({ capturedAt: -1 }).limit(MAX_ALERTS).toArray(),
    imageStorageBytes(),
  ]);

  const byDriver = new Map();
  for (const entry of entries) {
    const key = entry.driverId.toString();
    byDriver.set(key, [...(byDriver.get(key) ?? []), entry]);
  }

  const rows = list
    .filter((driver) => {
      const key = driver._id.toString();
      return byDriver.has(key) || (driver.active && dayOf(driver.createdAt) <= day);
    })
    .map((driver) => {
      const own = byDriver.get(driver._id.toString()) ?? [];
      const located = own.findLast((entry) => entry.lat !== null);
      return {
        id: driver._id,
        name: driver.name,
        phone: driver.phone,
        vehicle: driver.vehicle,
        status: dayState(own, day === today).status,
        count: own.length,
        first: own[0]?.capturedAt ?? null,
        last: own.at(-1)?.capturedAt ?? null,
        lat: located?.lat ?? null,
        lng: located?.lng ?? null,
        place: located?.place ?? null,
        flagged: own.filter((entry) => entry.late || entry.lowAccuracy).length,
      };
    });

  const names = new Map(list.map((driver) => [driver._id.toString(), driver.name]));
  const alerts = breakdowns.map((entry) => ({
    id: entry._id,
    driverId: entry.driverId,
    driver: names.get(entry.driverId.toString()) ?? '',
    day: entry.day,
    capturedAt: entry.capturedAt,
    place: entry.place ?? null,
  }));
  return Response.json({ day, today, rows, alerts, storageBytes });
}
