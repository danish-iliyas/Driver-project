import { ObjectId } from 'mongodb';
import { fail, getSession } from './auth';

export const PIN_ROUNDS = 10;
// Digits only: UAE numbers (05XXXXXXXX) and home-country numbers both work.
export const validPhone = (v) => /^\d{9,12}$/.test(v);
export const validPin = (v) => /^\d{4}$/.test(v);
export const validDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '');
export const validTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v ?? '');
export const clean = (v) => String(v ?? '').trim().slice(0, 80);
export const publicDriver = ({ pinHash, ...driver }) => driver;
export const parseId = (value) => (ObjectId.isValid(value) ? new ObjectId(value) : null);

export async function adminOnly() {
  return (await getSession('admin')) ? null : fail(401, 'Please log in');
}
