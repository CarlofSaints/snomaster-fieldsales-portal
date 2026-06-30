/**
 * Hirsch's sales-file parser.
 *
 * Hirsch's files are messy .xls exports ("Sales & Stock by Supplier") summed
 * over an arbitrary date range. Layout (after a split title/date block):
 *   Code | D(iscontinued) | Cat | Description | Br | Sales Qty | Sales Val | Stock Qty | Stock Val
 * Category divider rows (e.g. "01-104 : FRIDGES") and a "Grand Totals" footer
 * are interleaved. We keep only rows whose description contains SNOMASTER, and
 * the SnoMaster model code is the first token of the description.
 *
 * This is a PURE function (Buffer in, structured data out) so it can be unit-
 * tested and reused by the upload route.
 */

export interface HirschRow {
  hirschCode: string;   // Hirsch's internal item code (col A)
  modelCode: string;    // SnoMaster model code (first token of description)
  description: string;  // description with the model code stripped off
  discontinued: boolean;// col B === 'y'
  branch: string;       // col E — Hirsch branch / site code
  salesQty: number;
  salesVal: number;     // Rand
  stockQty: number;
  stockVal: number;     // Rand
}

export interface HirschParseResult {
  ok: boolean;
  error?: string;
  periodStart?: string; // YYYY-MM-DD
  periodEnd?: string;   // YYYY-MM-DD
  month?: string;       // MM-YYYY (of the start date)
  crossMonth?: boolean;
  rows: HirschRow[];
  droppedNonSno: number;
}

/** Parse a Rand string like "14,348" or a number into a float. */
export function parseRand(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[, ]/g, ''));
  return isNaN(n) ? 0 : n;
}

function parseQty(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[, ]/g, ''));
  return isNaN(n) ? 0 : n;
}

type ColMap = {
  code?: number; disc?: number; cat?: number; desc?: number; branch?: number;
  salesQty?: number; salesVal?: number; stockQty?: number; stockVal?: number;
};

function findHeader(rows: unknown[][]): { idx: number; col: ColMap } | null {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const row = rows[r] || [];
    const col: ColMap = {};
    for (let c = 0; c < row.length; c++) {
      const h = String(row[c] ?? '').trim().toLowerCase();
      if (!h) continue;
      if (h === 'code') col.code = c;
      else if (h === 'd') col.disc = c;
      else if (h === 'cat') col.cat = c;
      else if (h === 'description') col.desc = c;
      else if (h === 'br') col.branch = c;
      else if (h === 'sales qty') col.salesQty = c;
      else if (h === 'sales val') col.salesVal = c;
      else if (h === 'stock qty') col.stockQty = c;
      else if (h === 'stock val') col.stockVal = c;
    }
    if (col.code != null && col.desc != null && col.branch != null && col.salesQty != null) {
      return { idx: r, col };
    }
  }
  return null;
}

/** Pull the From/To date range out of the split title block above the header. */
function findPeriod(rows: unknown[][], headerIdx: number): { start: string; end: string } | null {
  for (let r = 0; r < headerIdx; r++) {
    const row = rows[r] || [];
    let s = '';
    for (const v of row) if (v != null) s += String(v);
    s = s.replace(/\s+/g, '');
    const m = [...s.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g)];
    if (m.length >= 2) {
      const fmt = (x: RegExpMatchArray) => `${x[3]}-${String(x[2]).padStart(2, '0')}-${String(x[1]).padStart(2, '0')}`;
      return { start: fmt(m[0]), end: fmt(m[1]) };
    }
  }
  return null;
}

export function parseHirschRows(rows: unknown[][]): HirschParseResult {
  const header = findHeader(rows);
  if (!header) {
    return { ok: false, error: 'Could not find the Hirsch’s header row (Code / Description / Br / Sales Qty).', rows: [], droppedNonSno: 0 };
  }
  const { idx, col } = header;

  const period = findPeriod(rows, idx);
  if (!period) {
    return { ok: false, error: 'Could not read the report period (From / To dates) from the file header.', rows: [], droppedNonSno: 0 };
  }
  const month = `${period.start.slice(5, 7)}-${period.start.slice(0, 4)}`;
  const crossMonth = period.start.slice(0, 7) !== period.end.slice(0, 7);

  const out: HirschRow[] = [];
  let droppedNonSno = 0;
  for (let r = idx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const codeRaw = row[col.code!];
    const code = codeRaw == null ? '' : String(codeRaw).trim();
    const desc = col.desc != null && row[col.desc] != null ? String(row[col.desc]).trim() : '';
    const branch = col.branch != null && row[col.branch] != null ? String(row[col.branch]).trim() : '';

    // Skip category dividers, the Grand Totals footer, and blank/structural rows.
    if (!code || code.includes(':') || !desc || !branch || desc.toLowerCase() === 'grand totals') continue;

    const up = desc.toUpperCase();
    if (!(up.includes('SNOMASTER') || up.includes('SNOWMASTER'))) { droppedNonSno++; continue; }

    const firstSpace = desc.indexOf(' ');
    const modelCode = (firstSpace === -1 ? desc : desc.slice(0, firstSpace)).trim();
    const description = (firstSpace === -1 ? '' : desc.slice(firstSpace + 1)).trim();
    const disc = col.disc != null ? String(row[col.disc] ?? '').trim().toLowerCase() === 'y' : false;

    out.push({
      hirschCode: code,
      modelCode,
      description,
      discontinued: disc,
      branch,
      salesQty: parseQty(col.salesQty != null ? row[col.salesQty] : 0),
      salesVal: parseRand(col.salesVal != null ? row[col.salesVal] : 0),
      stockQty: parseQty(col.stockQty != null ? row[col.stockQty] : 0),
      stockVal: parseRand(col.stockVal != null ? row[col.stockVal] : 0),
    });
  }

  return {
    ok: true,
    periodStart: period.start,
    periodEnd: period.end,
    month,
    crossMonth,
    rows: out,
    droppedNonSno,
  };
}

/** Read an .xls/.xlsx buffer and parse it. */
export function parseHirschBuffer(buffer: Buffer): HirschParseResult {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { ok: false, error: 'The file has no sheets.', rows: [], droppedNonSno: 0 };
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  return parseHirschRows(rows);
}
