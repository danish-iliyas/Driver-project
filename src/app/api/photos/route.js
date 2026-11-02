import { after } from 'next/server';
import { Binary, ObjectId } from 'mongodb';
import { collections } from '@/lib/db';
import { fail, getSession } from '@/lib/auth';
import { savePlace } from '@/lib/places';
import { dayOf } from '@/lib/time';
import { WORK_LABELS } from '@/lib/work';

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// A photo sent this long after it was taken is shown to the admin as a late upload.
const LATE_AFTER_MS = 5 * 60 * 1000;
const LOW_ACCURACY_METERS = 100;

const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export async function POST(request) {
  const session = await getSession('driver');
  if (!session) return fail(401, 'Please log in');
  if (Number(request.headers.get('content-length')) > MAX_PHOTO_BYTES) return fail(413, 'Photo is too large');

  const query = request.nextUrl.searchParams;
  const type = query.get('type');
  const clientId = query.get('clientId') ?? '';
  const lat = Number(query.get('lat') ?? NaN);
  const lng = Number(query.get('lng') ?? NaN);
  const accuracy = Number(query.get('accuracy') ?? NaN);
  const ageMs = Math.max(0, Number(query.get('ageMs') ?? NaN));
  const bytes = Buffer.from(await request.arrayBuffer());

  const valid =
    type in WORK_LABELS &&
    /^[\w-]{8,64}$/.test(clientId) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    accuracy >= 0 &&
    Number.isFinite(ageMs) &&
    isJpeg(bytes);
  if (!valid) return fail(400, 'Photo or location is not valid');
  if (bytes.length > MAX_PHOTO_BYTES) return fail(413, 'Photo is too large');
  if (ageMs > MAX_AGE_MS) return fail(400, 'Photo is too old');

  const { photos, photoBlobs } = await collections();
  const driverId = session.driverId;
  if (await photos.findOne({ driverId, clientId }, { projection: { _id: 1 } })) {
    return Response.json({ ok: true });
  }

  // The age is measured by the phone, so a wrong phone clock cannot shift the time.
  const receivedAt = new Date();
  const capturedAt = new Date(receivedAt.getTime() - ageMs);
  const _id = new ObjectId();

  await photoBlobs.insertOne({ _id, contentType: 'image/jpeg', data: new Binary(bytes) });
  try {
    await photos.insertOne({
      _id,
      driverId,
      clientId,
      type,
      note: (query.get('note') ?? '').trim().slice(0, 80),
      lat,
      lng,
      accuracy,
      lowAccuracy: accuracy > LOW_ACCURACY_METERS,
      late: ageMs > LATE_AFTER_MS,
      capturedAt,
      receivedAt,
      day: dayOf(capturedAt),
      size: bytes.length,
    });
  } catch (err) {
    await photoBlobs.deleteOne({ _id });
    if (err.code !== 11000) throw err;
    return Response.json({ ok: true });
  }
  // The driver should not wait for the place name.
  after(() => savePlace({ _id, lat, lng }).catch(() => {}));
  return Response.json({ ok: true });
}
