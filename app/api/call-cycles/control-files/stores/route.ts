import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import type { StoreControlEntry } from '@/lib/callcycle/types';
import { loadStoreControl, saveStoreControl, clearStoreControl } from '@/lib/callcycle/controlData';
import { processStoreRows } from '@/lib/callcycle/storeRowProcessor';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import { logActivity } from '@/lib/activityLog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const actor = await requireRole(req, ['super_admin', 'admin']);
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noCacheHeaders() });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const mode = formData.get('mode') === 'merge' ? 'merge' : 'replace';

    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return NextResponse.json({ error: 'No sheets found in file' }, { status: 400 });

    const rows: string[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
    if (rows.length < 2) return NextResponse.json({ error: 'File has no data rows' }, { status: 400 });

    const { stores: newStores, error } = processStoreRows(rows[0].map(String), rows.slice(1));
    if (error) return NextResponse.json({ error }, { status: 400 });
    if (newStores.length === 0) {
      return NextResponse.json({ error: 'No valid store rows found' }, { status: 400 });
    }

    let finalStores: StoreControlEntry[] = newStores;
    if (mode === 'merge') {
      const existing = await loadStoreControl();
      if (existing && existing.stores.length > 0) {
        const storeMap = new Map<string, StoreControlEntry>();
        for (const s of existing.stores) storeMap.set(s.storeCode.toUpperCase(), s);
        for (const s of newStores) storeMap.set(s.storeCode.toUpperCase(), s);
        finalStores = [...storeMap.values()];
      }
    }

    const activeStores = finalStores.filter(s => s.active).length;

    await saveStoreControl({
      stores: finalStores,
      uploadedAt: new Date().toISOString(),
      uploadedBy: actor.email,
    });

    await logActivity(
      'callcycle_control_upload',
      actor.email,
      `${actor.name} ${actor.surname}`.trim(),
      'call-cycles/store-control',
      `Uploaded store control file (${mode}): ${newStores.length} new, ${finalStores.length} total (${activeStores} active)`,
    );

    return NextResponse.json({
      ok: true,
      totalStores: finalStores.length,
      activeStores,
    }, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('[call-cycles/control-files/stores] POST error:', err);
    return NextResponse.json({ error: 'Failed to process file', detail: String(err) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const actor = await requireRole(req, ['super_admin', 'admin']);
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noCacheHeaders() });
  }

  const data = await loadStoreControl();
  if (!data) {
    return NextResponse.json({ loaded: false }, { headers: noCacheHeaders() });
  }

  return NextResponse.json({
    loaded: true,
    totalStores: data.stores.length,
    activeStores: data.stores.filter(s => s.active).length,
    channels: [...new Set(data.stores.map(s => s.channel).filter(Boolean))].sort(),
    uploadedAt: data.uploadedAt,
    uploadedBy: data.uploadedBy,
  }, { headers: noCacheHeaders() });
}

export async function DELETE(req: Request) {
  const actor = await requireRole(req, ['super_admin', 'admin']);
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noCacheHeaders() });
  }

  await clearStoreControl();
  await logActivity(
    'callcycle_control_upload',
    actor.email,
    `${actor.name} ${actor.surname}`.trim(),
    'call-cycles/store-control',
    'Cleared the store control file',
  );
  return NextResponse.json({ ok: true }, { headers: noCacheHeaders() });
}
