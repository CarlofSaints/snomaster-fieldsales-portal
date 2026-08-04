import { NextRequest, NextResponse } from 'next/server';
import { noCacheHeaders } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
import { deleteVisitUpload } from '@/lib/visitData';
import { logFromUser } from '@/lib/activityLog';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, 'ba.upload.visits');
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    await deleteVisitUpload(id);
    logFromUser(user, 'delete_visits', `visits/${id}`, `Deleted visit upload ${id}`);
    return NextResponse.json({ ok: true }, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('Delete upload error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
