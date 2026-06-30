import { NextRequest, NextResponse } from 'next/server';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import { loadSiteFileData } from '@/lib/siteFileData';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await requireRole(req, ['super_admin', 'admin']);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const data = await loadSiteFileData();
  // Return metadata only (not the full entry arrays) to keep it light.
  const retailers: Record<string, { fileName: string; uploadedAt: string; count: number; skipped: number }> = {};
  for (const [key, r] of Object.entries(data.retailers)) {
    if (!r) continue;
    retailers[key] = { fileName: r.fileName, uploadedAt: r.uploadedAt, count: r.count, skipped: r.skipped };
  }
  return NextResponse.json({ retailers }, { headers: noCacheHeaders() });
}
