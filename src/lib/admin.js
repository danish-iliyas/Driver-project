import { ObjectId } from 'mongodb';
import { fail, getSession } from './auth';
import { addDays, dubaiDate } from './time';

export const PIN_ROUNDS = 10;
// Digits only: UAE numbers (05XXXXXXXX) and home-country numbers both work.
export const validPhone = (v) => /^\d{9,12}$/.test(v);
export const validPin = (v) => /^\d{4}$/.test(v);
export const validDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '');
export const validTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v ?? '');
export const clean = (v) => String(v ?? '').trim().slice(0, 80);
export const publicDriver = ({ pinHash, ...driver }) => driver;
export const parseId = (value) => (ObjectId.isValid(value) ? new ObjectId(value) : null);

// Time of an entry on a shift date. nextDay is for night shift times after midnight.
// Returns an error message when the time is not usable.
export function entryTime(day, time, nextDay) {
  if (!validTime(time)) return 'Enter the time';
  const at = dubaiDate(nextDay ? addDays(day, 1) : day, time);
  if (at > new Date()) return 'Time cannot be in the future';
  return at;
}

export async function adminOnly() {
  return (await getSession('admin')) ? null : fail(401, 'Please log in');
}
