import { collections } from '@/lib/db';
import { driverScope, parseId, requireAdmin, validDay } from '@/lib/admin';
import { fillMissingPlaces } from '@/lib/places';
import { dayOf, shiftTime } from '@/lib/time';
import { daySummary, STATUS_LABELS, WORK_LABELS } from '@/lib/work';

const MAX_DAYS = 92;
// Each missing name takes a second to look up, so one report fills only a few.
const FILL_LIMIT = 8;

// Keeps spreadsheet apps from treating a typed name as a formula.
function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

const entryFlags = (shot) =>
  [
    shot.manual && 'Added by admin',
    shot.editedAt && 'Edited by admin',
    shot.late && 'Late upload',
    shot.lowAccuracy && 'Weak GPS',
  ].filter(Boolean);

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
  const { admin, denied } = await requireAdmin();
  if (denied) return denied;

  const query = request.nextUrl.searchParams;
  const today = dayOf(new Date());
  const from = validDay(query.get('from')) ? query.get('from') : `${today.slice(0, 7)}-01`;
  const requestedTo = validDay(query.get('to')) ? query.get('to') : today;
  const to = requestedTo > today ? today : requestedTo;
  const driverId = parseId(query.get('driver'));

  const { admins, drivers, photos } = await collections();
  const scope = { ...driverScope(admin, query.get('admin')), ...(driverId && { _id: driverId }) };
  const list = await drivers.find(scope).sort({ name: 1 }).toArray();
  const days = daysBetween(from, to);
  const match = { day: { $gte: from, $lte: days.at(-1) ?? from }, driverId: { $in: list.map((driver) => driver._id) } };
  // The super admin's report says which admin each driver belongs to.
  const adminNames = admin.isSuper
    ? new Map((await admins.find().toArray()).map((item) => [String(item._id), item.name]))
    : null;

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

  const shifts = [];
  for (const driver of list) {
    for (const day of days) {
      const dayShots = byKey.get(`${driver._id}|${day}`) ?? [];
      if (dayShots.length || (day >= dayOf(driver.createdAt) && driver.active)) shifts.push({ driver, day, dayShots });
    }
  }

  // One row per driver per day. Each entry gets its own columns, so a day with more photos is wider.
  const most = Math.max(0, ...shifts.map((shift) => shift.dayShots.length));
  const header = ['Driver', 'Mobile', 'Vehicle', ...(adminNames ? ['Admin'] : []), 'Date', 'Attendance', 'Status', 'Start time', 'End time', 'Hours', 'Photos', 'Flags'];
  for (let n = 1; n <= most; n++) header.push(`Photo ${n}`, `Photo ${n} map`);

  const rows = [header];
  for (const { driver, day, dayShots } of shifts) {
    const summary = daySummary(day, dayShots);
    const flags = new Set(dayShots.flatMap(entryFlags));
    const row = [
      driver.name,
      driver.phone,
      driver.vehicle,
      ...(adminNames ? [adminNames.get(String(driver.adminId)) ?? 'Super Admin'] : []),
      day,
      summary.present ? 'Present' : 'Absent',
      STATUS_LABELS[summary.status],
      shiftTime(summary.start, day),
      shiftTime(summary.end, day),
      summary.hours,
      dayShots.length,
      [...flags].join(', '),
    ];
    for (const shot of dayShots) {
      const located = shot.lat !== null;
      const place = located ? (shot.place ?? `${shot.lat.toFixed(5)}, ${shot.lng.toFixed(5)}`) : '';
      const extra = entryFlags(shot).filter((flag) => flag !== 'Weak GPS' && flag !== 'Late upload');
      row.push(
        [`${shiftTime(shot.capturedAt, day)} ${WORK_LABELS[shot.type]}`, place, shot.note, ...extra].filter(Boolean).join(' | '),
        located ? `https://www.google.com/maps?q=${shot.lat},${shot.lng}` : '',
      );
    }
    rows.push(row);
  }

  const label = driverId && list[0] ? list[0].name.replace(/[^\w-]+/g, '-') : 'all-drivers';
  return new Response(`﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="report-${label}-${from}-to-${to}.csv"`,
    },
  });
}
