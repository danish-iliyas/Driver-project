import bcrypt from 'bcryptjs';
import { collections } from '@/lib/db';
import { endAdminSessions, fail } from '@/lib/auth';
import { clean, PASSWORD_ROUNDS, parseId, requireAdmin, validPassword } from '@/lib/admin';

export async function PATCH(request, { params }) {
  const { denied } = await requireAdmin({ superOnly: true });
  if (denied) return denied;
  const _id = parseId((await params).id);
  if (!_id) return fail(404, 'Not found');

  const body = await request.json().catch(() => ({}));
  const set = {};
  if ('name' in body) set.name = clean(body.name);
  if ('active' in body) set.active = Boolean(body.active);
  if ('password' in body) {
    if (!validPassword(body.password)) return fail(400, 'Password must be at least 8 characters');
    set.passHash = await bcrypt.hash(body.password, PASSWORD_ROUNDS);
  }
  if ('name' in set && !set.name) return fail(400, 'Name is required');
  if (!Object.keys(set).length) return fail(400, 'Nothing to change');

  const { admins } = await collections();
  const { matchedCount } = await admins.updateOne({ _id }, { $set: set });
  if (!matchedCount) return fail(404, 'Not found');
  // A new password or a disabled admin logs that admin out everywhere.
  if (set.passHash || set.active === false) await endAdminSessions(_id);
  return Response.json({ ok: true });
}
