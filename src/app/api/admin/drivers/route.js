import bcrypt from 'bcryptjs';
import { collections } from '@/lib/db';
import { fail } from '@/lib/auth';
import {
  adminIdFrom,
  clean,
  driverScope,
  PIN_ROUNDS,
  publicDriver,
  requireAdmin,
  validPhone,
  validPin,
} from '@/lib/admin';
import { normalizePhone } from '@/lib/phone';

export async function GET(request) {
  const { admin, denied } = await requireAdmin();
  if (denied) return denied;
  const { admins, drivers } = await collections();
  const only = request.nextUrl.searchParams.get('admin');
  const list = await drivers.find(driverScope(admin, only)).sort({ active: -1, name: 1 }).toArray();
  if (!admin.isSuper) return Response.json(list.map(publicDriver));
  const names = new Map((await admins.find().toArray()).map((item) => [String(item._id), item.name]));
  return Response.json(list.map((driver) => ({ ...publicDriver(driver), adminName: names.get(String(driver.adminId)) ?? null })));
}

export async function POST(request) {
  const { admin, denied } = await requireAdmin();
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const name = clean(body.name);
  const phone = normalizePhone(body.phone);
  const vehicle = clean(body.vehicle).toUpperCase();
  const pin = String(body.pin ?? '');
  if (!name) return fail(400, 'Name is required');
  if (!validPhone(phone)) return fail(400, 'Enter the mobile number, digits only');
  if (!validPin(pin)) return fail(400, 'PIN must be 4 digits');
  // An admin's new driver is always theirs. The super admin can give it to any admin.
  const adminId = admin.isSuper ? await adminIdFrom(body.adminId) : admin.id;
  if (adminId === undefined) return fail(400, 'Choose the admin');

  const { drivers } = await collections();
  try {
    const pinHash = await bcrypt.hash(pin, PIN_ROUNDS);
    const doc = { name, phone, vehicle, pinHash, adminId, active: true, createdAt: new Date() };
    await drivers.insertOne(doc);
    return Response.json(publicDriver(doc), { status: 201 });
  } catch (err) {
    if (err.code === 11000) return fail(409, 'This mobile number already exists');
    throw err;
  }
}
