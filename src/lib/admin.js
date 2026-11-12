import { ObjectId } from 'mongodb';
import { fail, getSession } from './auth';
import { collections } from './db';
import { addDays, dubaiDate } from './time';

export const PIN_ROUNDS = 10;
export const PASSWORD_ROUNDS = 10;
// Digits only: UAE numbers (05XXXXXXXX) and home-country numbers both work.
export const validPhone = (v) => /^\d{9,12}$/.test(v);
export const validPin = (v) => /^\d{4}$/.test(v);
export const validDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '');
export const validTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v ?? '');
export const validUsername = (v) => /^[a-z0-9._-]{3,30}$/.test(v);
export const validPassword = (v) => typeof v === 'string' && v.length >= 8 && v.length <= 100;
export const clean = (v) => String(v ?? '').trim().slice(0, 80);
export const publicDriver = ({ pinHash, ...driver }) => driver;
export const publicAdmin = ({ passHash, ...admin }) => admin;
export const parseId = (value) => (ObjectId.isValid(value) ? new ObjectId(value) : null);
export const superUsername = () => (process.env.ADMIN_USERNAME ?? 'admin').trim().toLowerCase();

// The super admin is the login in .env and sees everything.
// Other admins are in the admins collection and see only their own drivers.
export async function currentAdmin() {
  const session = await getSession('admin');
  if (!session) return null;
  if (!session.adminId) return { id: null, name: 'Super Admin', isSuper: true };
  const { admins } = await collections();
  const admin = await admins.findOne({ _id: session.adminId, active: true });
  return admin ? { id: admin._id, name: admin.name, isSuper: false } : null;
}

export async function requireAdmin({ superOnly = false } = {}) {
  const admin = await currentAdmin();
  if (!admin) return { denied: fail(401, 'Please log in') };
  if (superOnly && !admin.isSuper) return { denied: fail(403, 'Only the super admin can do this') };
  return { admin };
}

// Filter for the drivers an admin may see. The super admin can narrow it to one admin,
// or to "none" for drivers that belong to no admin.
export function driverScope(admin, only) {
  if (!admin.isSuper) return { adminId: admin.id };
  if (only === 'none') return { adminId: null };
  const id = parseId(only);
  return id ? { adminId: id } : {};
}

export async function ownDriver(admin, driverId) {
  if (!driverId) return null;
  const { drivers } = await collections();
  return drivers.findOne({ _id: driverId, ...driverScope(admin) });
}

export async function ownPhoto(admin, photoId) {
  if (!photoId) return null;
  const { photos } = await collections();
  const photo = await photos.findOne({ _id: photoId });
  return photo && (await ownDriver(admin, photo.driverId)) ? photo : null;
}

// Owner for a driver: null for the super admin, or an admin that exists.
export async function adminIdFrom(value) {
  if (!value || value === 'none') return null;
  const id = parseId(value);
  const { admins } = await collections();
  if (!id || !(await admins.findOne({ _id: id }, { projection: { _id: 1 } }))) return undefined;
  return id;
}

// Time of an entry on a shift date. nextDay is for night shift times after midnight.
// Returns an error message when the time is not usable.
export function entryTime(day, time, nextDay) {
  if (!validTime(time)) return 'Enter the time';
  const at = dubaiDate(nextDay ? addDays(day, 1) : day, time);
  if (at > new Date()) return 'Time cannot be in the future';
  return at;
}
