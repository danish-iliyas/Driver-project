import { collections } from '@/lib/db';
import { fail } from '@/lib/auth';
import { adminOnly, parseId } from '@/lib/admin';
import { dayOf } from '@/lib/time';
import { daySummary } from '@/lib/work';

export async function GET(request, { params }) {
  const denied = await adminOnly();
  if (denied) return denied;
  const driverId = parseId((await params).id);
  if (!driverId) return fail(404, 'Not found');

  const today = dayOf(new Date());
  const requested = request.nextUrl.searchParams.get('month') ?? '';
  const month = /^\d{4}-\d{2}$/.test(requested) ? requested : today.slice(0, 7);
  const [year, monthNumber] = month.split('-').map(Number);
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

  const { drivers, photos } = await collections();
  const driver = await drivers.findOne({ _id: driverId });
  if (!driver) return fail(404, 'Not found');
  const entries = await photos
    .find(
      { driverId, day: { $gte: `${month}-01`, $lte: `${month}-31` } },
      { projection: { day: 1, type: 1, capturedAt: 1, resolved: 1 } },
    )
    .sort({ capturedAt: 1 })
    .toArray();

  const byDay = new Map();
  for (const entry of entries) byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);

  const days = [];
  const joined = dayOf(driver.createdAt);
  for (let n = dayCount; n >= 1; n--) {
    const day = `${month}-${String(n).padStart(2, '0')}`;
    const own = byDay.get(day) ?? [];
    if (day > today || (!own.length && day < joined)) continue;
    days.push(daySummary(day, own, today));
  }
  return Response.json(days);
}
