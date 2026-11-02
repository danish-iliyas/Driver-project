import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { collections } from './db';

const COOKIE = 'sid';
const DAY_MS = 24 * 60 * 60 * 1000;
// Drivers stay logged in on their phone; the admin session is short.
const SESSION_MS = { driver: 180 * DAY_MS, admin: DAY_MS / 2 };

const MAX_FAILS = 5;
const LOCK_MS = 10 * 60 * 1000;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export const fail = (status, error) => Response.json({ error }, { status });

export async function isLocked(key) {
  const { loginFails } = await collections();
  const entry = await loginFails.findOne({ _id: key, expiresAt: { $gt: new Date() } });
  return (entry?.count ?? 0) >= MAX_FAILS;
}

export async function recordFail(key) {
  const { loginFails } = await collections();
  await loginFails.updateOne(
    { _id: key },
    { $inc: { count: 1 }, $set: { expiresAt: new Date(Date.now() + LOCK_MS) } },
    { upsert: true },
  );
}

export async function clearFails(key) {
  const { loginFails } = await collections();
  await loginFails.deleteOne({ _id: key });
}

export async function startSession(role, driverId = null) {
  const { sessions } = await collections();
  const token = crypto.randomBytes(32).toString('base64url');
  const maxAge = SESSION_MS[role];
  await sessions.insertOne({
    _id: hashToken(token),
    role,
    driverId,
    expiresAt: new Date(Date.now() + maxAge),
  });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1',
    path: '/',
    maxAge: maxAge / 1000,
  });
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) {
    const { sessions } = await collections();
    await sessions.deleteOne({ _id: hashToken(token) });
  }
  store.delete(COOKIE);
}

export async function endDriverSessions(driverId) {
  const { sessions } = await collections();
  await sessions.deleteMany({ driverId });
}

export async function getSession(role) {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const { sessions } = await collections();
  const session = await sessions.findOne({ _id: hashToken(token), expiresAt: { $gt: new Date() } });
  return session?.role === role ? session : null;
}
