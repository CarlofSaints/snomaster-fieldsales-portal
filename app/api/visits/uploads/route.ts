import { NextRequest, NextResponse } from 'next/server';
import { noCacheHeaders } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
import { loadVisitIndex } from '@/lib/visitData';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, 'ba.upload.visits');
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const index = await loadVisitIndex();
  return NextResponse.json(index, { headers: noCacheHeaders() });
}
