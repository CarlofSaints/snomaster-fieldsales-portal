import { readJson, writeJson, deleteBlob } from './blob';
import type { HirschRow } from './hirschParse';

/**
 * Hirsch's sales storage.
 *
 * Unlike Makro DISPO (month-column files), Hirsch's files are period sums over
 * an arbitrary date range. Files must be within a single month; all files in a
 * month are summed for sales, and the latest period in the month provides the
 * stock snapshot. Overlapping periods are blocked at upload time because the
 * data is a period sum and cannot be de-overlapped.
 */

export interface HirschUploadMeta {
  id: string;
  fileName: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;   // YYYY-MM-DD
  month: string;       // MM-YYYY
  rowCount: number;
  salesQty: number;
  salesVal: number;
  branchCount: number;
  itemCount: number;
  uploadedAt: string;
  uploadedBy: string;
}

export interface HirschAgg { qty: number; val: number }

export interface HirschData {
  uploads: HirschUploadMeta[];
  /** sales[MM-YYYY][branch][model] = {qty,val} — summed across all uploads in the month. */
  sales: Record<string, Record<string, Record<string, HirschAgg>>>;
  /** stock[MM-YYYY][branch][model] = {qty,val} — from the latest period in the month. */
  stock: Record<string, Record<string, Record<string, HirschAgg>>>;
  /** model metadata. */
  items: Record<string, { description: string; discontinued: boolean }>;
}

const BLOB_KEY = 'hirsch/data.json';
const EMPTY: HirschData = { uploads: [], sales: {}, stock: {}, items: {} };

export async function loadHirschData(): Promise<HirschData> {
  const d = await readJson<HirschData>(BLOB_KEY, EMPTY);
  return { uploads: d.uploads || [], sales: d.sales || {}, stock: d.stock || {}, items: d.items || {} };
}

export async function saveHirschData(data: HirschData): Promise<void> {
  await writeJson(BLOB_KEY, data);
}

export async function saveHirschRaw(id: string, rows: HirschRow[]): Promise<void> {
  await writeJson(`hirsch/raw/${id}.json`, rows);
}

export async function loadHirschRaw(id: string): Promise<HirschRow[]> {
  return readJson<HirschRow[]>(`hirsch/raw/${id}.json`, []);
}

export async function deleteHirschRaw(id: string): Promise<void> {
  await deleteBlob(`hirsch/raw/${id}.json`);
}

/** Two inclusive date ranges overlap. Dates are YYYY-MM-DD so string compare is safe. */
export function periodsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}

/**
 * Find an already-loaded upload whose period overlaps [start,end].
 * Returns the conflicting upload and the overlapping day range, or null.
 */
export function findOverlap(
  uploads: HirschUploadMeta[],
  start: string,
  end: string,
): { upload: HirschUploadMeta; overlapStart: string; overlapEnd: string } | null {
  for (const u of uploads) {
    if (periodsOverlap(start, end, u.periodStart, u.periodEnd)) {
      return {
        upload: u,
        overlapStart: start > u.periodStart ? start : u.periodStart,
        overlapEnd: end < u.periodEnd ? end : u.periodEnd,
      };
    }
  }
  return null;
}

/**
 * Rebuild sales/stock/items aggregates from every upload's raw rows.
 * `rawByUpload` maps uploadId → its raw rows.
 */
export function rebuildHirschAggregates(uploads: HirschUploadMeta[], rawByUpload: Record<string, HirschRow[]>): Pick<HirschData, 'sales' | 'stock' | 'items'> {
  const sales: HirschData['sales'] = {};
  const stock: HirschData['stock'] = {};
  const items: HirschData['items'] = {};

  // Sales = sum across all uploads in the month.
  for (const u of uploads) {
    const rows = rawByUpload[u.id] || [];
    if (!sales[u.month]) sales[u.month] = {};
    for (const row of rows) {
      if (!sales[u.month][row.branch]) sales[u.month][row.branch] = {};
      const cell = sales[u.month][row.branch][row.modelCode] || { qty: 0, val: 0 };
      cell.qty += row.salesQty;
      cell.val += row.salesVal;
      sales[u.month][row.branch][row.modelCode] = cell;
      items[row.modelCode] = { description: row.description, discontinued: row.discontinued };
    }
  }

  // Stock = the latest period in each month (snapshot, not summed).
  const latestByMonth: Record<string, HirschUploadMeta> = {};
  for (const u of uploads) {
    const cur = latestByMonth[u.month];
    if (!cur || u.periodEnd > cur.periodEnd) latestByMonth[u.month] = u;
  }
  for (const [month, u] of Object.entries(latestByMonth)) {
    const rows = rawByUpload[u.id] || [];
    stock[month] = {};
    for (const row of rows) {
      if (row.stockQty === 0 && row.stockVal === 0) continue;
      if (!stock[month][row.branch]) stock[month][row.branch] = {};
      stock[month][row.branch][row.modelCode] = { qty: row.stockQty, val: row.stockVal };
    }
  }

  return { sales, stock, items };
}

/** Monthly Hirsch sales totals per branch (summed over models) for a month. */
export function hirschSalesByBranch(data: HirschData, month: string): Record<string, HirschAgg> {
  const out: Record<string, HirschAgg> = {};
  const m = data.sales[month] || {};
  for (const [branch, models] of Object.entries(m)) {
    let qty = 0, val = 0;
    for (const cell of Object.values(models)) { qty += cell.qty; val += cell.val; }
    out[branch] = { qty, val };
  }
  return out;
}
