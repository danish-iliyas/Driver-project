import { collections } from '@/lib/db';
import { fail, getSession } from '@/lib/auth';
import { validDay } from '@/lib/admin';

export async function GET(request, { params }) {
  const session = await getSession('driver');
  if (!session) return fail(401, 'Please log in');
  const { day } = await params;
  if (!validDay(day)) return fail(404, 'Not found');

  const { photos } = await collections();
  const list = await photos
    .find(
      { driverId: session.driverId, day },
      { projection: { type: 1, note: 1, place: 1, capturedAt: 1, manual: 1 } },
    )
    .sort({ capturedAt: 1 })
    .toArray();
  return Response.json(list);
}
