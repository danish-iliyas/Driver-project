import crypto from 'node:crypto';
import { collections } from '@/lib/db';
import { fail } from '@/lib/auth';
import { clean, entryTime, ownDriver, parseId, requireAdmin, validDay } from '@/lib/admin';
import { WORK_LABELS } from '@/lib/work';

// Lets the admin add what a driver forgot. These entries have no photo and no location.
export async function POST(request, { params }) {
  const { admin, denied } = await requireAdmin();
  if (denied) return denied;
  const driver = await ownDriver(admin, parseId((await params).id));
  if (!driver) return fail(404, 'Not found');
  const driverId = driver._id;

  const body = await request.json().catch(() => ({}));
  if (!(body.type in WORK_LABELS)) return fail(400, 'Choose the work');
  if (!validDay(body.day)) return fail(400, 'Enter the time');
  const capturedAt = entryTime(body.day, body.time, body.nextDay);
  if (typeof capturedAt === 'string') return fail(400, capturedAt);

  const { photos } = await collections();
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
    // The shift date, even when the time is after midnight.
    day: body.day,
    size: 0,
  });
  return Response.json({ ok: true }, { status: 201 });
}
