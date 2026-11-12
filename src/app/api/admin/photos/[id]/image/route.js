import { collections } from '@/lib/db';
import { fail } from '@/lib/auth';
import { ownPhoto, parseId, requireAdmin } from '@/lib/admin';

export async function GET(request, { params }) {
  const { admin, denied } = await requireAdmin();
  if (denied) return denied;
  const photo = await ownPhoto(admin, parseId((await params).id));
  if (!photo) return fail(404, 'Not found');
  const { _id } = photo;

  const { photoBlobs } = await collections();
  const blob = await photoBlobs.findOne({ _id });
  if (!blob) return fail(404, 'Not found');
  return new Response(blob.data.buffer, {
    headers: {
      'Content-Type': blob.contentType,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
