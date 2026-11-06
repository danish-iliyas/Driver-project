import { collections } from '@/lib/db';
import { fail, getSession } from '@/lib/auth';
import { dayOf } from '@/lib/time';
import { daySummary } from '@/lib/work';

const HISTORY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET() {
  const session = await getSession('driver');
  if (!session) return fail(401, 'Please log in');
  const { drivers, photos } = await collections();
  const driverId = session.driverId;
  const driver = await drivers.findOne({ _id: driverId, active: true });
  if (!driver) return fail(401, 'Please log in');

  const now = Date.now();
  const oldest = dayOf(new Date(now - (HISTORY_DAYS - 1) * DAY_MS));
  const entries = await photos
    .find({ driverId, day: { $gte: oldest } }, { projection: { day: 1, type: 1, capturedAt: 1, resolved: 1 } })
    .sort({ capturedAt: 1 })
    .toArray();

  const byDay = new Map();
  for (const entry of entries) byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);

  const joined = dayOf(driver.createdAt);
  const days = [];
  for (let n = 0; n < HISTORY_DAYS; n++) {
    const day = dayOf(new Date(now - n * DAY_MS));
    const own = byDay.get(day) ?? [];
    if (!own.length && day < joined) continue;
    days.push(daySummary(day, own, now));
  }
  return Response.json(days);
}
