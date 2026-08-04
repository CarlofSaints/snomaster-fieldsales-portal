import { NextRequest, NextResponse } from 'next/server';
import { noCacheHeaders } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
import { loadHirschData } from '@/lib/hirschData';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, 'ba.upload.dispo');
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const data = await loadHirschData();
  return NextResponse.json(data, { headers: noCacheHeaders() });
}
