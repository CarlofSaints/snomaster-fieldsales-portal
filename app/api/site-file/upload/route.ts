import { NextRequest, NextResponse } from 'next/server';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import { loadSiteFileData, saveSiteFileData, parseSiteFileBuffer, RetailerKey } from '@/lib/siteFileData';
import { logFromUser } from '@/lib/activityLog';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const user = await requireRole(req, ['super_admin', 'admin']);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const retailer = String(formData.get('retailer') || '') as RetailerKey;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (retailer !== 'hirsch' && retailer !== 'makro') {
      return NextResponse.json({ error: 'Select a retailer (Hirsch’s or Makro).' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseSiteFileBuffer(buffer, retailer);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error || 'Could not parse file' }, { status: 400 });
    if (parsed.entries.length === 0) {
      return NextResponse.json({ error: 'No site rows found for the selected retailer.' }, { status: 400 });
    }

    const data = await loadSiteFileData();
    data.retailers[retailer] = {
      fileName: file.name,
      uploadedAt: new Date().toISOString(),
      uploadedBy: user.email,
      count: parsed.entries.length,
      skipped: parsed.skipped,
      entries: parsed.entries,
    };
    await saveSiteFileData(data);

    logFromUser(user, 'upload_site_file', `site-file/${retailer}`, `Uploaded ${retailer} site file: ${parsed.entries.length} sites (${parsed.skipped} skipped).`);

    return NextResponse.json({
      ok: true, retailer,
      count: parsed.entries.length,
      skipped: parsed.skipped,
    }, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('Site file upload error:', err);
    return NextResponse.json({ error: 'Failed to process file', detail: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
