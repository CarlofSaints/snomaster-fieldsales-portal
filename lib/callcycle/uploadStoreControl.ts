'use client';

/**
 * Client-side store control upload.
 *
 * A Vercel serverless function can only receive a ~4.5 MB request body, and the
 * Perigee store export is well past that (Carl's is 6.5 MB). Posting the raw
 * .xlsx therefore 413s no matter what plan you are on — it is a platform limit,
 * not a quota.
 *
 * So the browser does the work instead: it parses the workbook, keeps only the
 * columns we actually store, gzips the result, and sends it in chunks. A store
 * list is extremely repetitive text, so gzip typically takes it under a tenth of
 * the original — and chunking removes the ceiling entirely rather than just
 * raising it.
 *
 * Chunks are staged server-side under their own blob keys and combined on the
 * final chunk, so a half-finished upload never overwrites the live file.
 */

/** Columns `processStoreRows` reads. Anything else is dropped before sending. */
const WANTED_HEADERS = [
  'country', 'province', 'channel',
  'store name', 'storename',
  'store code', 'storecode', 'store id', 'storeid',
  'active', 'longitude', 'long', 'latitude', 'lat',
  'location status', 'locationstatus',
  'ignore location data', 'ignorelocationdata',
  'email', 'store email',
  'created by', 'createdby', 'updated by', 'updatedby',
];

/** Rows per chunk. ~5k rows of store data gzips to well under a megabyte. */
const ROWS_PER_CHUNK = 5000;

export interface StoreControlProgress {
  phase: 'parsing' | 'uploading' | 'saving';
  /** 0-100, or null while parsing (we can't know the total yet). */
  percent: number | null;
  detail: string;
}

export interface StoreControlUploadResult {
  ok: boolean;
  totalStores?: number;
  activeStores?: number;
  error?: string;
}

async function gzip(text: string): Promise<Blob> {
  // CompressionStream is available in every browser Next 16 targets. If it is
  // somehow missing, fall back to sending plain JSON — the chunking alone is
  // usually enough to stay under the limit.
  if (typeof CompressionStream === 'undefined') {
    return new Blob([text], { type: 'application/json' });
  }
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

export async function uploadStoreControl(
  file: File,
  mode: 'replace' | 'merge',
  onProgress: (p: StoreControlProgress) => void,
): Promise<StoreControlUploadResult> {
  onProgress({ phase: 'parsing', percent: null, detail: 'Reading the workbook…' });

  // Loaded on demand so SheetJS never ships in the main bundle.
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { ok: false, error: 'No sheets found in the file.' };

  const allRows: string[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
  if (allRows.length < 2) return { ok: false, error: 'The file has no data rows.' };

  const rawHeaders = allRows[0].map(h => String(h ?? ''));

  // Keep only the columns the server actually stores. On a wide Perigee export
  // this is where most of the payload disappears.
  const keepIdx: number[] = [];
  rawHeaders.forEach((h, i) => {
    if (WANTED_HEADERS.includes(h.toLowerCase().trim())) keepIdx.push(i);
  });
  // If nothing matched, the header row is unexpected — send everything and let
  // the server produce its usual "required columns not found" message.
  const useAll = keepIdx.length === 0;
  const headers = useAll ? rawHeaders : keepIdx.map(i => rawHeaders[i]);

  const rows: string[][] = [];
  for (let r = 1; r < allRows.length; r++) {
    const src = allRows[r];
    if (!src) continue;
    const row = useAll ? src.map(c => String(c ?? '')) : keepIdx.map(i => String(src[i] ?? ''));
    if (row.every(c => !c.trim())) continue; // drop blank rows
    rows.push(row);
  }

  if (rows.length === 0) return { ok: false, error: 'No data rows found in the file.' };

  const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const chunkTotal = Math.max(1, Math.ceil(rows.length / ROWS_PER_CHUNK));

  for (let i = 0; i < chunkTotal; i++) {
    const slice = rows.slice(i * ROWS_PER_CHUNK, (i + 1) * ROWS_PER_CHUNK);
    const isLast = i === chunkTotal - 1;

    onProgress({
      phase: isLast ? 'saving' : 'uploading',
      percent: Math.round((i / chunkTotal) * 100),
      detail: isLast
        ? `Saving ${rows.length.toLocaleString()} stores…`
        : `Sending ${(i * ROWS_PER_CHUNK + slice.length).toLocaleString()} of ${rows.length.toLocaleString()} stores…`,
    });

    const body = await gzip(JSON.stringify({
      headers, rows: slice, mode, uploadId,
      chunkIndex: i, chunkTotal,
    }));

    let userId = '';
    try {
      const raw = localStorage.getItem('snomaster_session');
      if (raw) userId = JSON.parse(raw)?.id ?? '';
    } catch { /* ignore */ }

    const res = await fetch('/api/call-cycles/control-files/stores', {
      method: 'POST',
      headers: {
        'Content-Type': body.type === 'application/json' ? 'application/json' : 'application/gzip',
        ...(userId ? { 'x-user-id': userId } : {}),
      },
      body,
      cache: 'no-store',
    });

    if (!res.ok) {
      if (res.status === 413) {
        return {
          ok: false,
          error: `Chunk ${i + 1} was still too large for the server. This shouldn't happen — tell Carl the row width, not the file size, is the problem.`,
        };
      }
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error || `Upload failed on chunk ${i + 1} of ${chunkTotal} (${res.status})` };
    }

    if (isLast) {
      const data = await res.json();
      onProgress({ phase: 'saving', percent: 100, detail: 'Done' });
      return { ok: true, totalStores: data.totalStores, activeStores: data.activeStores };
    }
  }

  return { ok: false, error: 'Upload finished without a final response.' };
}
