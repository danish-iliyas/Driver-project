import { requireAdmin } from '@/lib/admin';

export async function GET() {
  const { admin, denied } = await requireAdmin();
  if (denied) return denied;
  return Response.json({ name: admin.name, isSuper: admin.isSuper });
}
