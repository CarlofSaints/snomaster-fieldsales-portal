import { readJson, writeJson } from './blob';
import { normalizeCode } from './storeData';

/**
 * Retailer site master files (Hirsch's, Makro). These are reference lookups that
 * name a store by its site/branch code — the sales feeds (Hirsch's branch
 * numbers, Makro site codes) only carry codes, so we resolve names from here.
 *
 * Both files share the MASTER_SITE schema:
 *   SITE NUM | STORE NAME | CHANNEL | SUB_CHANNEL | COUNTRY | PROVINCE |
 *   TOWN/CITY | ADDRESS | POSTAL CODE | LAT | LONG | STATUS | OPENED DATE | TOP 100
 * The Makro file also contains MASSBUILD rows (B* codes) which we drop.
 */

export type RetailerKey = 'hirsch' | 'makro';

export interface SiteEntry {
  siteCode: string;
  storeName: string;
  channel: string;      // HIRSCHS / MAKRO
  subChannel: string;
  province: string;
  town: string;
  status: string;       // ACTIVE / CLOSED
}

export interface SiteFileMeta {
  fileName: string;
  uploadedAt: string;
  uploadedBy: string;
  count: number;
  skipped: number;      // rows dropped (e.g. MASSBUILD)
}

export interface SiteFileData {
  retailers: Partial<Record<RetailerKey, SiteFileMeta & { entries: SiteEntry[] }>>;
}

const BLOB_KEY = 'admin/site-files.json';
const EMPTY: SiteFileData = { retailers: {} };

/** CHANNEL values kept per retailer; everything else is dropped. */
const ALLOWED_CHANNELS: Record<RetailerKey, string[]> = {
  hirsch: ['HIRSCHS'],
  makro: ['MAKRO'],
};

export async function loadSiteFileData(): Promise<SiteFileData> {
  const d = await readJson<SiteFileData>(BLOB_KEY, EMPTY);
  return { retailers: d.retailers || {} };
}

export async function saveSiteFileData(data: SiteFileData): Promise<void> {
  await writeJson(BLOB_KEY, data);
}

type ColMap = { code?: number; name?: number; channel?: number; sub?: number; province?: number; town?: number; status?: number };

function findHeader(rows: unknown[][]): { idx: number; col: ColMap } | null {
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    const row = rows[r] || [];
    const col: ColMap = {};
    for (let c = 0; c < row.length; c++) {
      const h = String(row[c] ?? '').trim().toLowerCase();
      if (!h) continue;
      if (h === 'site num' || h === 'site number' || h === 'site code' || h === 'site') col.code = c;
      else if (h === 'store name' || h === 'name') col.name = c;
      else if (h === 'channel') col.channel = c;
      else if (h === 'sub_channel' || h === 'sub channel' || h === 'subchannel') col.sub = c;
      else if (h === 'province') col.province = c;
      else if (h === 'town/city' || h === 'town' || h === 'city') col.town = c;
      else if (h === 'status') col.status = c;
    }
    if (col.code != null && col.name != null) return { idx: r, col };
  }
  return null;
}

export interface SiteFileParseResult {
  ok: boolean;
  error?: string;
  entries: SiteEntry[];
  skipped: number;
}

export function parseSiteFileBuffer(buffer: Buffer, retailer: RetailerKey): SiteFileParseResult {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets['MASTER_SITE'] || wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { ok: false, error: 'No sheet found in file.', entries: [], skipped: 0 };
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

  const header = findHeader(rows);
  if (!header) return { ok: false, error: 'Could not find the header row (need SITE NUM + STORE NAME).', entries: [], skipped: 0 };
  const { idx, col } = header;

  const allowed = ALLOWED_CHANNELS[retailer];
  const entries: SiteEntry[] = [];
  let skipped = 0;
  for (let r = idx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const siteCode = String(row[col.code!] ?? '').trim();
    const storeName = col.name != null ? String(row[col.name] ?? '').trim() : '';
    if (!siteCode || !storeName) continue;
    const channel = col.channel != null ? String(row[col.channel] ?? '').trim().toUpperCase() : '';
    if (allowed.length && channel && !allowed.includes(channel)) { skipped++; continue; }
    entries.push({
      siteCode,
      storeName,
      channel,
      subChannel: col.sub != null ? String(row[col.sub] ?? '').trim() : '',
      province: col.province != null ? String(row[col.province] ?? '').trim() : '',
      town: col.town != null ? String(row[col.town] ?? '').trim() : '',
      status: col.status != null ? String(row[col.status] ?? '').trim() : '',
    });
  }
  return { ok: true, entries, skipped };
}

/** code (normalized) → SiteEntry, across all loaded retailers. */
export function buildSiteLookup(data: SiteFileData): Map<string, SiteEntry> {
  const map = new Map<string, SiteEntry>();
  for (const r of Object.values(data.retailers)) {
    if (!r) continue;
    for (const e of r.entries) {
      const k = normalizeCode(e.siteCode);
      if (k && !map.has(k)) map.set(k, e);
    }
  }
  return map;
}
