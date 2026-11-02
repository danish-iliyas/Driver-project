import { collections } from '@/lib/db';
import { fail } from '@/lib/auth';
import { adminOnly, parseId, publicDriver, validDay } from '@/lib/admin';
import { fillMissingPlaces } from '@/lib/places';
import { dayOf } from '@/lib/time';

export async function GET(request, { params }) {
  const denied = await adminOnly();
  if (denied) return denied;
  const driverId = parseId((await params).id);
  if (!driverId) return fail(404, 'Not found');

  const requested = request.nextUrl.searchParams.get('day');
  const day = validDay(requested) ? requested : dayOf(new Date());
  const { drivers, photos } = await collections();
  const driver = await drivers.findOne({ _id: driverId });
  if (!driver) return fail(404, 'Not found');
  await fillMissingPlaces({ driverId, day }, 3);
  const list = await photos.find({ driverId, day }).sort({ capturedAt: 1 }).toArray();
  return Response.json({ driver: publicDriver(driver), day, photos: list });
}
