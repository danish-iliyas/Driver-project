import bcrypt from 'bcryptjs';
import { collections } from '@/lib/db';
import { endDriverSessions, fail } from '@/lib/auth';
import { adminIdFrom, clean, ownDriver, parseId, PIN_ROUNDS, requireAdmin, validPhone, validPin } from '@/lib/admin';
import { normalizePhone } from '@/lib/phone';

export async function PATCH(request, { params }) {
  const { admin, denied } = await requireAdmin();
  if (denied) return denied;
  const _id = parseId((await params).id);
  if (!(await ownDriver(admin, _id))) return fail(404, 'Not found');

  const body = await request.json().catch(() => ({}));
  const set = {};
  if ('name' in body) set.name = clean(body.name);
  if ('vehicle' in body) set.vehicle = clean(body.vehicle).toUpperCase();
  if ('phone' in body) set.phone = normalizePhone(body.phone);
  if ('active' in body) set.active = Boolean(body.active);
  if ('adminId' in body) {
    if (!admin.isSuper) return fail(403, 'Only the super admin can do this');
    set.adminId = await adminIdFrom(body.adminId);
    if (set.adminId === undefined) return fail(400, 'Choose the admin');
  }
  if ('pin' in body) {
    if (!validPin(String(body.pin))) return fail(400, 'PIN must be 4 digits');
    set.pinHash = await bcrypt.hash(String(body.pin), PIN_ROUNDS);
  }
  if ('name' in set && !set.name) return fail(400, 'Name is required');
  if ('phone' in set && !validPhone(set.phone)) return fail(400, 'Enter the mobile number, digits only');
  if (!Object.keys(set).length) return fail(400, 'Nothing to change');

  const { drivers } = await collections();
  try {
    const { matchedCount } = await drivers.updateOne({ _id }, { $set: set });
    if (!matchedCount) return fail(404, 'Not found');
  } catch (err) {
    if (err.code === 11000) return fail(409, 'This mobile number already exists');
    throw err;
  }
  // A new PIN or a disabled account logs the driver out everywhere.
  if (set.pinHash || set.active === false) await endDriverSessions(_id);
  return Response.json({ ok: true });
}
