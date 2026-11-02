import { collections } from '@/lib/db';
import { adminOnly, parseId, validDay } from '@/lib/admin';
import { fillMissingPlaces } from '@/lib/places';
import { dayOf, timeOf } from '@/lib/time';
import { dayState, STATUS_LABELS, WORK_LABELS } from '@/lib/work';

const MAX_DAYS = 92;
// Each missing name takes a second to look up, so one report fills only a few.
const FILL_LIMIT = 8;

// Keeps spreadsheet apps from treating a typed name as a formula.
function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function daysBetween(from, to) {
  const days = [];
  const date = new Date(`${from}T12:00:00Z`);
  while (days.length < MAX_DAYS) {
    const day = date.toISOString().slice(0, 10);
    if (day > to) break;
    days.push(day);
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return days;
}

export async function GET(request) {
  const denied = await adminOnly();
  if (denied) return denied;

  const query = request.nextUrl.searchParams;
  const today = dayOf(new Date());
  const from = validDay(query.get('from')) ? query.get('from') : `${today.slice(0, 7)}-01`;
  const requestedTo = validDay(query.get('to')) ? query.get('to') : today;
  const to = requestedTo > today ? today : requestedTo;
  const driverId = parseId(query.get('driver'));

  const { drivers, photos } = await collections();
  const list = await drivers.find(driverId ? { _id: driverId } : {}).sort({ name: 1 }).toArray();
  const days = daysBetween(from, to);
  const match = { day: { $gte: from, $lte: days.at(-1) ?? from }, ...(driverId && { driverId }) };

  await fillMissingPlaces(match, FILL_LIMIT);
  const shots = await photos
    .find(match)
    .sort({ capturedAt: 1 })
    .toArray();

  const byKey = new Map();
  for (const shot of shots) {
    const key = `${shot.driverId}|${shot.day}`;
    byKey.set(key, [...(byKey.get(key) ?? []), shot]);
  }

  const rows = [['Driver', 'Mobile', 'Vehicle', 'Date', 'Status', 'Day hours', 'Entry no.', 'Time', 'Work', 'Driver note', 'Place', 'Map link', 'Flags']];
  for (const driver of list) {
    for (const day of days) {
      const dayShots = byKey.get(`${driver._id}|${day}`);
      const base = [driver.name, driver.phone, driver.vehicle, day];
      if (!dayShots) {
        if (day >= dayOf(driver.createdAt) && driver.active) rows.push([...base, 'Absent', '', '', '', '', '', '', '', '']);
        continue;
      }
      const { status, hours } = dayState(dayShots, day === today);
      dayShots.forEach((shot, index) => {
        const flags = [
          shot.manual && 'Added by admin',
          shot.editedAt && 'Edited by admin',
          shot.late && 'Late upload',
          shot.lowAccuracy && 'Weak GPS',
        ].filter(Boolean);
        const located = shot.lat !== null;
        rows.push([
          ...base,
          STATUS_LABELS[status],
          hours,
          index + 1,
          timeOf(shot.capturedAt),
          WORK_LABELS[shot.type],
          shot.note,
          located ? (shot.place ?? `${shot.lat.toFixed(5)}, ${shot.lng.toFixed(5)}`) : '',
          located ? `https://www.google.com/maps?q=${shot.lat},${shot.lng}` : '',
          flags.join(', '),
        ]);
      });
    }
  }

  const label = driverId && list[0] ? list[0].name.replace(/[^\w-]+/g, '-') : 'all-drivers';
  return new Response(`﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="report-${label}-${from}-to-${to}.csv"`,
    },
  });
}
