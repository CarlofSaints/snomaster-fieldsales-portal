import { NextRequest, NextResponse } from 'next/server';
import { noCacheHeaders } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
import { loadTargetData } from '@/lib/targetData';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, 'ba.upload.targets');
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await loadTargetData();
    return NextResponse.json(data, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('Targets GET error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
