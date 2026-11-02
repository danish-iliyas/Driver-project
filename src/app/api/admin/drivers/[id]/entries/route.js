import crypto from 'node:crypto';
import { collections } from '@/lib/db';
import { fail } from '@/lib/auth';
import { adminOnly, clean, parseId, validDay, validTime } from '@/lib/admin';
import { dubaiDate } from '@/lib/time';
import { WORK_LABELS } from '@/lib/work';

// Lets the admin add what a driver forgot. These entries have no photo and no location.
export async function POST(request, { params }) {
  const denied = await adminOnly();
  if (denied) return denied;
  const driverId = parseId((await params).id);
  if (!driverId) return fail(404, 'Not found');

  const body = await request.json().catch(() => ({}));
  if (!(body.type in WORK_LABELS)) return fail(400, 'Choose the work');
  if (!validDay(body.day) || !validTime(body.time)) return fail(400, 'Enter the time');
  const capturedAt = dubaiDate(body.day, body.time);
  if (capturedAt > new Date()) return fail(400, 'Time cannot be in the future');

  const { drivers, photos } = await collections();
  if (!(await drivers.findOne({ _id: driverId }, { projection: { _id: 1 } }))) return fail(404, 'Not found');
  await photos.insertOne({
    driverId,
    clientId: `admin-${crypto.randomUUID()}`,
    type: body.type,
    note: clean(body.note),
    lat: null,
    lng: null,
    accuracy: null,
    lowAccuracy: false,
    late: false,
    manual: true,
    capturedAt,
    receivedAt: new Date(),
    day: body.day,
    size: 0,
  });
  return Response.json({ ok: true }, { status: 201 });
}
