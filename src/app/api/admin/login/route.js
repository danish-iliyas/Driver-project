import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { collections } from '@/lib/db';
import { clearFails, fail, isLocked, recordFail, startSession } from '@/lib/auth';
import { superUsername } from '@/lib/admin';

function sameText(a, b) {
  const hash = (v) => crypto.createHash('sha256').update(String(v)).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

// Returns { adminId } for a correct login: null for the super admin, the admin's id otherwise.
async function check(username, password) {
  if (username === superUsername()) {
    return sameText(password, process.env.ADMIN_PASSWORD) ? { adminId: null } : null;
  }
  const { admins } = await collections();
  const admin = await admins.findOne({ username, active: true });
  return admin && (await bcrypt.compare(password, admin.passHash)) ? { adminId: admin._id } : null;
}

export async function POST(request) {
  if ((process.env.ADMIN_PASSWORD ?? '').length < 10) return fail(503, 'Set ADMIN_PASSWORD on the server first');
  const body = await request.json().catch(() => ({}));
  const username = String(body.username ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const key = `admin:${username}`;
  if (await isLocked(key)) return fail(429, 'Too many tries. Wait 10 minutes.');

  const login = await check(username, password);
  if (!login) {
    await recordFail(key);
    return fail(401, 'Wrong username or password');
  }
  await clearFails(key);
  await startSession('admin', login);
  return Response.json({ ok: true });
}
