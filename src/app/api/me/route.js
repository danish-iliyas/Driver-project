import { collections } from '@/lib/db';
import { fail, getSession } from '@/lib/auth';
import { dayOf } from '@/lib/time';

export async function GET() {
  const session = await getSession('driver');
  if (!session) return fail(401, 'Please log in');
  const { drivers, photos } = await collections();
  const driver = await drivers.findOne({ _id: session.driverId, active: true });
  if (!driver) return fail(401, 'Please log in');
  const today = { driverId: driver._id, day: dayOf(new Date()) };
  const [todayCount, last, shift] = await Promise.all([
    photos.countDocuments(today),
    photos.findOne(today, { sort: { capturedAt: -1 }, projection: { _id: 0, type: 1, capturedAt: 1 } }),
    photos.findOne({ ...today, type: { $in: ['start', 'end'] } }, { sort: { capturedAt: -1 }, projection: { type: 1 } }),
  ]);
  const working = shift?.type === 'start';
  return Response.json({ id: driver._id, name: driver.name, vehicle: driver.vehicle, todayCount, last, working });
}
