import { collections, imageStorageBytes } from '@/lib/db';
import { driverScope, requireAdmin, validDay } from '@/lib/admin';
import { addDays, dayOf } from '@/lib/time';
import { dayState, OPEN_STATUSES } from '@/lib/work';

const MAX_ALERTS = 20;

export async function GET(request) {
  const { admin, denied } = await requireAdmin();
  if (denied) return denied;

  const query = request.nextUrl.searchParams;
  const today = dayOf(new Date());
  const day = validDay(query.get('day')) ? query.get('day') : today;
  // Today also looks at yesterday, for night shifts that are still running.
  const yesterday = addDays(today, -1);
  const days = day === today ? [yesterday, today] : [day];
  const { drivers, photos, tracks } = await collections();

  const list = await drivers.find(driverScope(admin, query.get('admin'))).sort({ name: 1 }).toArray();
  const driverId = { $in: list.map((driver) => driver._id) };
  const [entries, breakdowns, lastPoints, storageBytes] = await Promise.all([
    photos
      .find({ driverId, day: { $in: days } }, { projection: { day: 1, driverId: 1, type: 1, capturedAt: 1, resolved: 1, lat: 1, lng: 1, place: 1, late: 1, lowAccuracy: 1 } })
      .sort({ capturedAt: 1 })
      .toArray(),
    photos.find({ driverId, type: 'breakdown', resolved: { $ne: true } }).sort({ capturedAt: -1 }).limit(MAX_ALERTS).toArray(),
    tracks
      .aggregate([
        { $match: { driverId, day: { $in: days } } },
        { $sort: { at: -1 } },
        { $group: { _id: { driverId: '$driverId', day: '$day' }, lat: { $first: '$lat' }, lng: { $first: '$lng' }, at: { $first: '$at' } } },
      ])
      .toArray(),
    admin.isSuper ? imageStorageBytes() : null,
  ]);

  const byDriver = new Map();
  for (const entry of entries) {
    const key = `${entry.driverId}|${entry.day}`;
    byDriver.set(key, [...(byDriver.get(key) ?? []), entry]);
  }
  const lastPoint = new Map(lastPoints.map((point) => [`${point._id.driverId}|${point._id.day}`, point]));

  const rows = list
    .filter((driver) => {
      const key = `${driver._id}|${day}`;
      return byDriver.has(key) || (driver.active && dayOf(driver.createdAt) <= day);
    })
    .map((driver) => {
      const dayEntries = byDriver.get(`${driver._id}|${day}`) ?? [];
      const night = byDriver.get(`${driver._id}|${yesterday}`) ?? [];
      const fromNight = day === today && !dayEntries.length && OPEN_STATUSES.includes(dayState(night).status);
      const own = fromNight ? night : dayEntries;
      const shiftDay = fromNight ? yesterday : day;
      const { status } = dayState(own);
      const photo = own.findLast((entry) => entry.lat !== null);
      const point = lastPoint.get(`${driver._id}|${shiftDay}`);
      // The newest known location: a live tracking point or a photo.
      const seen = point && (!photo || point.at > photo.capturedAt)
        ? { lat: point.lat, lng: point.lng, at: point.at }
        : photo && { lat: photo.lat, lng: photo.lng, at: photo.capturedAt };
      return {
        id: driver._id,
        name: driver.name,
        phone: driver.phone,
        vehicle: driver.vehicle,
        day: shiftDay,
        status,
        count: own.length,
        first: own[0]?.capturedAt ?? null,
        last: own.at(-1)?.capturedAt ?? null,
        lat: seen?.lat ?? null,
        lng: seen?.lng ?? null,
        seenAt: seen?.at ?? null,
        place: photo?.place ?? null,
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
