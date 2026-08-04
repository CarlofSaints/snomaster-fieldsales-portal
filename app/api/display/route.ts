import { NextRequest, NextResponse } from 'next/server';
import { noCacheHeaders } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
import { loadDisplayIndex } from '@/lib/displayData';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, 'ba.kpi.display');
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const index = await loadDisplayIndex();
    return NextResponse.json(index, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('Display list error:', err);
    return NextResponse.json({ error: 'Failed to load display uploads' }, { status: 500 });
  }
}
