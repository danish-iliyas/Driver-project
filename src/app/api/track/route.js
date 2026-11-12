import { collections } from '@/lib/db';
import { fail, getSession } from '@/lib/auth';
import { isOpen, lastMarker } from '@/lib/shift';

// Points saved on the phone without signal arrive together later.
const MAX_POINTS = 300;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const validPoint = (p) =>
  /^[\w-]{8,64}$/.test(p?.id) &&
  Math.abs(p?.lat) <= 90 &&
  Math.abs(p?.lng) <= 180 &&
  p.accuracy >= 0 &&
  Number.isFinite(p.ageMs) &&
  p.ageMs >= 0 &&
  p.ageMs <= MAX_AGE_MS;

// Live location while a shift is open. Points outside a shift are dropped.
export async function POST(request) {
  const session = await getSession('driver');
  if (!session) return fail(401, 'Please log in');
  const body = await request.json().catch(() => ({}));
  const points = Array.isArray(body.points) ? body.points.slice(0, MAX_POINTS).filter(validPoint) : [];

  const { tracks, photos } = await collections();
  const driverId = session.driverId;
  const now = Date.now();
  const docs = [];
  for (const point of points) {
    // The age is measured by the phone, so a wrong phone clock cannot shift the time.
    const at = new Date(now - point.ageMs);
    const marker = await lastMarker(photos, driverId, at);
    if (!isOpen(marker, at)) continue;
    docs.push({ driverId, pointId: point.id, day: marker.day, lat: point.lat, lng: point.lng, accuracy: point.accuracy, at });
  }
  // A point sent twice (the answer was lost on a weak signal) is saved once.
  if (docs.length) {
    await tracks.insertMany(docs, { ordered: false }).catch((err) => {
      if (![err.writeErrors ?? err].flat().every((e) => e.code === 11000)) throw err;
    });
  }
  return Response.json({ ok: true, saved: docs.length });
}
