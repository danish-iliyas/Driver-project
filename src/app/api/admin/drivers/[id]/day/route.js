import { collections } from '@/lib/db';
import { fail } from '@/lib/auth';
import { ownDriver, parseId, publicDriver, requireAdmin, validDay } from '@/lib/admin';
import { fillMissingPlaces } from '@/lib/places';
import { dayOf } from '@/lib/time';

export async function GET(request, { params }) {
  const { admin, denied } = await requireAdmin();
  if (denied) return denied;
  const driver = await ownDriver(admin, parseId((await params).id));
  if (!driver) return fail(404, 'Not found');
  const driverId = driver._id;

  const requested = request.nextUrl.searchParams.get('day');
  const day = validDay(requested) ? requested : dayOf(new Date());
  const { photos, tracks } = await collections();
  await fillMissingPlaces({ driverId, day }, 3);
  const [list, track] = await Promise.all([
    photos.find({ driverId, day }).sort({ capturedAt: 1 }).toArray(),
    tracks.find({ driverId, day }, { projection: { _id: 0, lat: 1, lng: 1, accuracy: 1, at: 1 } }).sort({ at: 1 }).toArray(),
  ]);
  return Response.json({ driver: publicDriver(driver), day, photos: list, track });
}
