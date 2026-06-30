import { NextRequest, NextResponse } from 'next/server';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import { parseHirschBuffer } from '@/lib/hirschParse';
import {
  loadHirschData, saveHirschData, saveHirschRaw, loadHirschRaw,
  findOverlap, rebuildHirschAggregates, HirschUploadMeta,
} from '@/lib/hirschData';
import { logFromUser } from '@/lib/activityLog';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

function fmtDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[m - 1]} ${y}`;
}

export async function POST(req: NextRequest) {
  const user = await requireRole(req, ['super_admin', 'admin']);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseHirschBuffer(buffer);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error || 'Could not parse file' }, { status: 400 });
    }
    if (parsed.rows.length === 0) {
      return NextResponse.json({ error: 'No SnoMaster rows found in this file.' }, { status: 400 });
    }
    const { periodStart, periodEnd, month, crossMonth, rows } = parsed;

    // Files must sit within a single month so each upload belongs to one month.
    if (crossMonth) {
      return NextResponse.json({
        error: `This file spans more than one month (${fmtDate(periodStart!)} → ${fmtDate(periodEnd!)}). Hirsch's files must fall within a single month — re-export a month-aligned date range and upload again.`,
        crossMonth: true,
      }, { status: 400 });
    }

    const data = await loadHirschData();

    // Block overlapping periods — the data is a period sum and cannot be de-overlapped.
    const overlap = findOverlap(data.uploads, periodStart!, periodEnd!);
    if (overlap) {
      const sameDay = overlap.overlapStart === overlap.overlapEnd;
      const range = sameDay ? fmtDate(overlap.overlapStart) : `${fmtDate(overlap.overlapStart)} – ${fmtDate(overlap.overlapEnd)}`;
      return NextResponse.json({
        error: `The file you're attempting to load contains data from a period already loaded. Data was already loaded covering ${range} (file: ${overlap.upload.fileName}, period ${fmtDate(overlap.upload.periodStart)} → ${fmtDate(overlap.upload.periodEnd)}), and this upload overlaps those day(s). Get data that does not overlap and then reload.`,
        overlap: true,
      }, { status: 409 });
    }

    // Save the new upload's raw rows + meta, then rebuild month aggregates.
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await saveHirschRaw(id, rows);

    const branches = new Set(rows.map(r => r.branch));
    const models = new Set(rows.map(r => r.modelCode));
    const meta: HirschUploadMeta = {
      id, fileName: file.name, periodStart: periodStart!, periodEnd: periodEnd!, month: month!,
      rowCount: rows.length,
      salesQty: rows.reduce((s, r) => s + r.salesQty, 0),
      salesVal: rows.reduce((s, r) => s + r.salesVal, 0),
      branchCount: branches.size,
      itemCount: models.size,
      uploadedAt: new Date().toISOString(),
      uploadedBy: user.email,
    };
    data.uploads.push(meta);

    // Rebuild aggregates from every upload's raw rows (incl. the new one).
    const rawByUpload: Record<string, typeof rows> = { [id]: rows };
    for (const u of data.uploads) {
      if (u.id === id) continue;
      rawByUpload[u.id] = await loadHirschRaw(u.id);
    }
    const agg = rebuildHirschAggregates(data.uploads, rawByUpload);
    data.sales = agg.sales;
    data.stock = agg.stock;
    data.items = agg.items;
    await saveHirschData(data);

    logFromUser(user, 'upload_hirsch', `hirsch/${id}`, `Uploaded Hirsch's ${fmtDate(periodStart!)}–${fmtDate(periodEnd!)}: ${rows.length} rows, ${branches.size} branches, R${Math.round(meta.salesVal).toLocaleString()} sales.`);

    return NextResponse.json({
      ok: true, id, month,
      periodStart, periodEnd,
      rowCount: rows.length,
      branchCount: branches.size,
      itemCount: models.size,
      salesQty: meta.salesQty,
      salesVal: meta.salesVal,
      droppedNonSno: parsed.droppedNonSno,
    }, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('Hirsch upload error:', err);
    return NextResponse.json({ error: 'Failed to process file', detail: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
