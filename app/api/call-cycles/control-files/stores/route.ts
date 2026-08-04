import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import zlib from 'zlib';
import type { StoreControlEntry } from '@/lib/callcycle/types';
import { loadStoreControl, saveStoreControl, clearStoreControl } from '@/lib/callcycle/controlData';
import { processStoreRows } from '@/lib/callcycle/storeRowProcessor';
import { readJson, writeJson, deleteBlob } from '@/lib/blob';
import { noCacheHeaders } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
import { logActivity } from '@/lib/activityLog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

interface ChunkBody {
  headers: string[];
  rows: string[][];
  mode?: 'replace' | 'merge';
  uploadId?: string;
  chunkIndex?: number;
  chunkTotal?: number;
}

const stagingKey = (uploadId: string, index: number) =>
  `callcycle/staging/store-control/${uploadId}/${index}.json`;

/** Apply the finished row set to the live control file. */
async function commitStores(
  headers: string[],
  rows: string[][],
  mode: 'replace' | 'merge',
  actorEmail: string,
) {
  const { stores: newStores, error } = processStoreRows(headers.map(String), rows);
  if (error) return { error };
  if (newStores.length === 0) return { error: 'No valid store rows found' };

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

  await saveStoreControl({
    stores: finalStores,
    uploadedAt: new Date().toISOString(),
    uploadedBy: actorEmail,
  });

  return {
    newCount: newStores.length,
    totalStores: finalStores.length,
    activeStores: finalStores.filter(s => s.active).length,
  };
}

export async function POST(req: NextRequest) {
  const actor = await requirePermission(req, 'cc.control_files.manage');
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noCacheHeaders() });
  }

  const actorName = `${actor.name} ${actor.surname}`.trim();

  try {
    const contentType = req.headers.get('content-type') || '';

    // ── Path A: browser-parsed, gzipped, chunked JSON ──────────────────────
    // The Perigee store export is far past the ~4.5 MB serverless body limit,
    // so the browser parses it and streams it here in pieces instead.
    if (contentType.includes('application/gzip') || contentType.includes('application/json')) {
      let body: ChunkBody;
      if (contentType.includes('application/gzip')) {
        const compressed = Buffer.from(await req.arrayBuffer());
        body = JSON.parse(zlib.gunzipSync(compressed).toString());
      } else {
        body = await req.json();
      }

      if (!Array.isArray(body.headers) || !Array.isArray(body.rows)) {
        return NextResponse.json({ error: 'Invalid payload: missing headers or rows' }, { status: 400 });
      }

      const mode = body.mode === 'merge' ? 'merge' : 'replace';
      const chunkTotal = body.chunkTotal ?? 1;
      const chunkIndex = body.chunkIndex ?? 0;
      const uploadId = body.uploadId || '';

      // Single-chunk upload: commit straight away, no staging needed.
      if (chunkTotal <= 1) {
        const result = await commitStores(body.headers, body.rows, mode, actor.email);
        if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });

        await logActivity(
          'callcycle_control_upload', actor.email, actorName, 'call-cycles/store-control',
          `Uploaded store control file (${mode}): ${result.newCount} new, ${result.totalStores} total (${result.activeStores} active)`,
        );
        return NextResponse.json({ ok: true, ...result }, { headers: noCacheHeaders() });
      }

      if (!uploadId) {
        return NextResponse.json({ error: 'uploadId is required for a chunked upload' }, { status: 400 });
      }

      // Stage this chunk under its own key. Nothing touches the live file until
      // the last chunk lands, so a failed upload can't leave it half-written.
      await writeJson(stagingKey(uploadId, chunkIndex), body.rows);

      if (chunkIndex < chunkTotal - 1) {
        return NextResponse.json({ ok: true, staged: chunkIndex + 1, of: chunkTotal }, { headers: noCacheHeaders() });
      }

      // Final chunk — reassemble in order, commit, then clean up staging.
      const all: string[][] = [];
      for (let i = 0; i < chunkTotal; i++) {
        const part = await readJson<string[][]>(stagingKey(uploadId, i), []);
        if (part.length === 0 && i < chunkTotal - 1) {
          return NextResponse.json({
            error: `Chunk ${i + 1} of ${chunkTotal} is missing — the upload was interrupted. Nothing was saved; please try again.`,
          }, { status: 400 });
        }
        all.push(...part);
      }

      const result = await commitStores(body.headers, all, mode, actor.email);

      // Best-effort cleanup; a leftover staging blob is harmless.
      for (let i = 0; i < chunkTotal; i++) {
        await deleteBlob(stagingKey(uploadId, i)).catch(() => {});
      }

      if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });

      await logActivity(
        'callcycle_control_upload', actor.email, actorName, 'call-cycles/store-control',
        `Uploaded store control file (${mode}, ${chunkTotal} chunks): ${result.newCount} new, ${result.totalStores} total (${result.activeStores} active)`,
      );
      return NextResponse.json({ ok: true, ...result }, { headers: noCacheHeaders() });
    }

    // ── Path B: plain multipart file (small files, and the manual fallback) ──
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

    const result = await commitStores(rows[0].map(String), rows.slice(1), mode, actor.email);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });

    await logActivity(
      'callcycle_control_upload', actor.email, actorName, 'call-cycles/store-control',
      `Uploaded store control file (${mode}): ${result.newCount} new, ${result.totalStores} total (${result.activeStores} active)`,
    );

    return NextResponse.json({ ok: true, ...result }, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('[call-cycles/control-files/stores] POST error:', err);
    return NextResponse.json({ error: 'Failed to process file', detail: String(err) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const actor = await requirePermission(req, 'cc.control_files.manage');
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
  const actor = await requirePermission(req, 'cc.control_files.manage');
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
