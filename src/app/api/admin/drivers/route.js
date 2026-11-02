import bcrypt from 'bcryptjs';
import { collections } from '@/lib/db';
import { fail } from '@/lib/auth';
import { adminOnly, clean, PIN_ROUNDS, publicDriver, validPhone, validPin } from '@/lib/admin';
import { normalizePhone } from '@/lib/phone';

export async function GET() {
  const denied = await adminOnly();
  if (denied) return denied;
  const { drivers } = await collections();
  const list = await drivers.find().sort({ active: -1, name: 1 }).toArray();
  return Response.json(list.map(publicDriver));
}

export async function POST(request) {
  const denied = await adminOnly();
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const name = clean(body.name);
  const phone = normalizePhone(body.phone);
  const vehicle = clean(body.vehicle).toUpperCase();
  const pin = String(body.pin ?? '');
  if (!name) return fail(400, 'Name is required');
  if (!validPhone(phone)) return fail(400, 'Enter the mobile number, digits only');
  if (!validPin(pin)) return fail(400, 'PIN must be 4 digits');

  const { drivers } = await collections();
  try {
    const pinHash = await bcrypt.hash(pin, PIN_ROUNDS);
    const doc = { name, phone, vehicle, pinHash, active: true, createdAt: new Date() };
    await drivers.insertOne(doc);
    return Response.json(publicDriver(doc), { status: 201 });
  } catch (err) {
    if (err.code === 11000) return fail(409, 'This mobile number already exists');
    throw err;
  }
}
