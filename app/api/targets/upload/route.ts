import { NextRequest, NextResponse } from 'next/server';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import { loadTargetData, saveTargetData, TargetEntry, TargetUploadMeta } from '@/lib/targetData';
import { writeJson } from '@/lib/blob';
import { put } from '@vercel/blob';
import { logFromUser } from '@/lib/activityLog';
import { runAutoCalcForMonth } from '@/lib/autoCalc';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

// First 3 letters of a month name → MM. Matches headers like "Jan ", "March", "Sep".
const MONTH_PREFIX: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

export async function POST(req: NextRequest) {
  const user = await requireRole(req, ['super_admin', 'admin']);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const XLSX = require('xlsx');
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    const data = await loadTargetData();
    const uploadId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const allMonths = new Set<string>();
    const allStores = new Set<string>();
    const processedSheets: string[] = [];

    // Raw data for rebuild-on-delete
    const rawTargets: Record<string, TargetEntry[]> = {};

    // Only ingest the Targets sheet(s) — the workbook also holds an "Actual" sheet
    // with the same layout that must NOT be loaded as targets.
    for (const sheetName of workbook.SheetNames) {
      if (!/target/i.test(sheetName)) continue;

      const sheet = workbook.Sheets[sheetName];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
      if (rows.length < 3) continue;

      // Year comes from the sheet name (e.g. "2026 Targets"), else current year.
      const yearMatch = sheetName.match(/(20\d{2})/);
      const year = yearMatch ? yearMatch[1] : String(new Date().getFullYear());

      // Header row = the one carrying a "Store Code" cell (layout has a title row above it).
      let headerIdx = -1;
      for (let i = 0; i < Math.min(rows.length, 12); i++) {
        if ((rows[i] || []).some(c => /store\s*code/i.test(String(c ?? '')))) { headerIdx = i; break; }
      }
      if (headerIdx < 0) continue;
      const header = rows[headerIdx] as unknown[];

      // Resolve columns: store code, store name, and each month (skip a "Total" column).
      let codeCol = -1, nameCol = -1;
      const monthCols: { monthKey: string; col: number }[] = [];
      for (let c = 0; c < header.length; c++) {
        const h = String(header[c] ?? '').trim().toLowerCase();
        if (!h) continue;
        if (/store\s*code/.test(h)) { codeCol = c; continue; }
        if (/store/.test(h) && nameCol < 0) { nameCol = c; continue; } // "Hirsch Store"
        const mm = MONTH_PREFIX[h.slice(0, 3)];
        if (mm && h !== 'total') {
          const monthKey = `${mm}-${year}`;
          monthCols.push({ monthKey, col: c });
          allMonths.add(monthKey);
        }
      }
      if (codeCol < 0 || monthCols.length === 0) continue;
      if (nameCol < 0) nameCol = 0;
      processedSheets.push(sheetName);

      // Data rows: skip region headers, "Total" subtotals, blank lines and any row
      // without a store code (e.g. "New CPT Store").
      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = (rows[r] || []) as unknown[];
        const rawCode = row[codeCol];
        if (rawCode === null || rawCode === undefined || String(rawCode).trim() === '') continue;
        const siteCode = String(rawCode).trim();
        const storeName = row[nameCol] ? String(row[nameCol]).trim() : siteCode;
        if (/^total$/i.test(storeName)) continue;

        allStores.add(siteCode);

        for (const { monthKey, col } of monthCols) {
          const valueTarget = Math.round(Number(row[col]) || 0);
          if (valueTarget <= 0) continue;

          // Rand value only — no volume target for SnoMaster.
          const entry: TargetEntry = { siteCode, storeName, valueTarget, volumeTarget: 0 };

          if (!data.targets[monthKey]) data.targets[monthKey] = [];
          const existIdx = data.targets[monthKey].findIndex(e => e.siteCode === siteCode);
          if (existIdx >= 0) data.targets[monthKey][existIdx] = entry;
          else data.targets[monthKey].push(entry);

          if (!rawTargets[monthKey]) rawTargets[monthKey] = [];
          rawTargets[monthKey].push(entry);
        }
      }
    }

    if (processedSheets.length === 0) {
      return NextResponse.json({
        error: 'No "Targets" sheet found. Expected a sheet named like "2026 Targets" with a "Store Code" column and month columns (Jan…Dec).',
      }, { status: 400 });
    }

    // Save raw file for rebuild-on-delete
    await writeJson(`targets/raw/${uploadId}.json`, rawTargets);

    // Save original file bytes for download
    await put(`targets/file/${uploadId}.xlsx`, buffer, {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    // Add upload metadata
    const meta: TargetUploadMeta = {
      id: uploadId,
      fileName: file.name,
      uploadedAt: new Date().toISOString(),
      uploadedBy: user.email,
      sheetNames: processedSheets,
      months: [...allMonths],
      storeCount: allStores.size,
    };
    data.uploads.push(meta);

    await saveTargetData(data);

    // Auto-recalculate sales scores for affected months
    const autoCalcResults = [];
    for (const mm of allMonths) {
      // Target months are MM-YYYY, convert to YYYY-MM
      const [mmPart, yyyyPart] = mm.split('-');
      const yyyyMm = `${yyyyPart}-${mmPart}`;
      try { autoCalcResults.push(await runAutoCalcForMonth(yyyyMm, ['sales'])); } catch { /* logged internally */ }
    }

    logFromUser(user, 'upload_targets', `targets/${uploadId}`, `Uploaded targets — ${allStores.size} stores, months: ${[...allMonths].join(', ')}. Sales scores auto-recalculated.`);
    return NextResponse.json({
      ok: true,
      uploadId,
      months: [...allMonths],
      storeCount: allStores.size,
      sheets: processedSheets,
      autoCalc: autoCalcResults,
    }, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('Target upload error:', err);
    logFromUser(user, 'upload_targets', 'targets/failed', `Target upload failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({
      error: 'Failed to process target file',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
