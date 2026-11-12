import bcrypt from 'bcryptjs';
import { collections } from '@/lib/db';
import { clearFails, fail, isLocked, recordFail, startSession } from '@/lib/auth';
import { normalizePhone } from '@/lib/phone';

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const phone = normalizePhone(body.phone);
  const pin = String(body.pin ?? '');
  const key = `driver:${phone}`;
  if (await isLocked(key)) return fail(429, 'Too many tries. Wait 10 minutes.');

  const { drivers } = await collections();
  const driver = await drivers.findOne({ phone });
  if (!driver?.active || !(await bcrypt.compare(pin, driver.pinHash))) {
    await recordFail(key);
    return fail(401, 'Wrong mobile number or PIN. Forgot PIN? Ask admin.');
  }
  await clearFails(key);
  await startSession('driver', { driverId: driver._id });
  return Response.json({ id: driver._id, name: driver.name, vehicle: driver.vehicle });
}
