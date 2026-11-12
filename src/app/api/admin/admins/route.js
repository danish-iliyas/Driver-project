import bcrypt from 'bcryptjs';
import { collections } from '@/lib/db';
import { fail } from '@/lib/auth';
import {
  clean,
  PASSWORD_ROUNDS,
  publicAdmin,
  requireAdmin,
  superUsername,
  validPassword,
  validUsername,
} from '@/lib/admin';

export async function GET() {
  const { denied } = await requireAdmin({ superOnly: true });
  if (denied) return denied;
  const { admins, drivers } = await collections();
  const [list, counts] = await Promise.all([
    admins.find().sort({ active: -1, name: 1 }).toArray(),
    drivers.aggregate([{ $group: { _id: '$adminId', count: { $sum: 1 } } }]).toArray(),
  ]);
  const byAdmin = new Map(counts.map((row) => [String(row._id), row.count]));
  return Response.json(list.map((admin) => ({ ...publicAdmin(admin), drivers: byAdmin.get(String(admin._id)) ?? 0 })));
}

export async function POST(request) {
  const { denied } = await requireAdmin({ superOnly: true });
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const name = clean(body.name);
  const username = String(body.username ?? '').trim().toLowerCase();
  if (!name) return fail(400, 'Name is required');
  if (!validUsername(username)) return fail(400, 'Username: 3 to 30 small letters or numbers, no spaces');
  if (username === superUsername()) return fail(409, 'This username already exists');
  if (!validPassword(body.password)) return fail(400, 'Password must be at least 8 characters');

  const { admins } = await collections();
  try {
    const passHash = await bcrypt.hash(body.password, PASSWORD_ROUNDS);
    const doc = { name, username, passHash, active: true, createdAt: new Date() };
    await admins.insertOne(doc);
    return Response.json(publicAdmin(doc), { status: 201 });
  } catch (err) {
    if (err.code === 11000) return fail(409, 'This username already exists');
    throw err;
  }
}
