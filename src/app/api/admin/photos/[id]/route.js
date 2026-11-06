import { collections } from '@/lib/db';
import { fail } from '@/lib/auth';
import { adminOnly, clean, entryTime, parseId } from '@/lib/admin';
import { WORK_LABELS } from '@/lib/work';

export async function PATCH(request, { params }) {
  const denied = await adminOnly();
  if (denied) return denied;
  const _id = parseId((await params).id);
  if (!_id) return fail(404, 'Not found');

  const { photos } = await collections();
  const photo = await photos.findOne({ _id });
  if (!photo) return fail(404, 'Not found');

  const body = await request.json().catch(() => ({}));
  const set = {};
  if ('type' in body) {
    if (!(body.type in WORK_LABELS)) return fail(400, 'Choose the work');
    set.type = body.type;
  }
  if ('note' in body) set.note = clean(body.note);
  if ('time' in body) {
    const at = entryTime(photo.day, body.time, body.nextDay);
    if (typeof at === 'string') return fail(400, at);
    set.capturedAt = at;
  }
  const edited = Object.keys(set).length > 0;
  if (edited) set.editedAt = new Date();
  if ('resolved' in body) set.resolved = Boolean(body.resolved);
  if (!Object.keys(set).length) return fail(400, 'Nothing to change');

  await photos.updateOne({ _id }, { $set: set });
  return Response.json({ ok: true });
}

export async function DELETE(request, { params }) {
  const denied = await adminOnly();
  if (denied) return denied;
  const _id = parseId((await params).id);
  if (!_id) return fail(404, 'Not found');

  const { photos, photoBlobs } = await collections();
  const { deletedCount } = await photos.deleteOne({ _id });
  if (!deletedCount) return fail(404, 'Not found');
  await photoBlobs.deleteOne({ _id });
  return Response.json({ ok: true });
}
