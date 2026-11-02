import { collections } from '@/lib/db';
import { fail, getSession } from '@/lib/auth';
import { parseId } from '@/lib/admin';

// A driver can open only their own photos.
export async function GET(request, { params }) {
  const session = await getSession('driver');
  if (!session) return fail(401, 'Please log in');
  const _id = parseId((await params).id);
  if (!_id) return fail(404, 'Not found');

  const { photos, photoBlobs } = await collections();
  const own = await photos.findOne({ _id, driverId: session.driverId }, { projection: { _id: 1 } });
  const blob = own && (await photoBlobs.findOne({ _id }));
  if (!blob) return fail(404, 'Not found');
  return new Response(blob.data.buffer, {
    headers: {
      'Content-Type': blob.contentType,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
