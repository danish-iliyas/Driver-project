import crypto from 'node:crypto';
import { clearFails, fail, isLocked, recordFail, startSession } from '@/lib/auth';

const KEY = 'admin';

function sameText(a, b) {
  const hash = (v) => crypto.createHash('sha256').update(String(v)).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

export async function POST(request) {
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (password.length < 10) return fail(503, 'Set ADMIN_PASSWORD on the server first');
  if (await isLocked(KEY)) return fail(429, 'Too many tries. Wait 10 minutes.');

  const body = await request.json().catch(() => ({}));
  const usernameOk = sameText(body.username ?? '', process.env.ADMIN_USERNAME ?? 'admin');
  const passwordOk = sameText(body.password ?? '', password);
  if (!usernameOk || !passwordOk) {
    await recordFail(KEY);
    return fail(401, 'Wrong username or password');
  }
  await clearFails(KEY);
  await startSession('admin');
  return Response.json({ ok: true });
}
