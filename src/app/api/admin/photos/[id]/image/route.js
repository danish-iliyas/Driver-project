import { collections } from '@/lib/db';
import { fail } from '@/lib/auth';
import { adminOnly, parseId } from '@/lib/admin';

export async function GET(request, { params }) {
  const denied = await adminOnly();
  if (denied) return denied;
  const _id = parseId((await params).id);
  if (!_id) return fail(404, 'Not found');

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
