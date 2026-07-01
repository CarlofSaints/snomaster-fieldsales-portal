import { readJson, writeJson } from './blob';
import type { Visit } from './visitData';

export interface StoreMaster {
  /**
   * Canonical Perigee store code (from visit data). This is the primary
   * identity going forward — a physical store is "the same store" across
   * sales feeds and visits when their Perigee codes match. May be '' for a
   * sales-only row that has not yet been linked to a visited store.
   */
  perigeeCode: string;
  /**
   * Additional Perigee codes that belong to this SAME physical store. Perigee
   * sometimes logs one store under several codes/spellings (e.g. "HIRSCHS
   * BALLITO"/H0077 and misspelled "HIRSCHS BALITO"/HS01). Merging keeps every
   * code here so visits under ANY of them are attributed to this one store.
   */
  altPerigeeCodes?: string[];
  /** Display name. Prefer the Perigee visit name; falls back to the sales name. */
  storeName: string;
  channelId: string;
  area?: string;
  // Explicit BA assignment. When set, this overrides the Perigee-visit-derived
  // BA for this store everywhere (BA Work report + sales attribution). Used when
  // a store changes hands (e.g. a BA leaves and is replaced). Empty/undefined
  // = auto-derive the BA from visit data as before.
  assignedBaEmail?: string;
  assignedBaName?: string;

  /**
   * Link to the channel SALES feed (Makro DISPO, Hirsch's, etc.). The sales
   * data is keyed by the retailer's site NAME, so `salesName` is the join key
   * into the sales store maps. `salesCode` is the retailer's own site code,
   * kept for display + matching. Empty = no sales data linked yet.
   */
  salesName?: string;
  salesCode?: string;

  /**
   * Marks a visited store that legitimately has NO sales feed (e.g. Beares,
   * Dial-a-bed). Such stores are excluded from "needs linking" warnings.
   */
  notInData?: boolean;

  /**
   * Marks a distribution centre / warehouse: it appears in the retailer's
   * sales/stock data but a rep NEVER visits it. DC rows are excluded from
   * "sales without a store" warnings (they are not expected to have a visit)
   * and are shown in the DC-only stock section on the Sales page.
   */
  isDc?: boolean;

  /** Where this row first came from. */
  source?: 'visit' | 'sales' | 'manual';

  /**
   * @deprecated Legacy single-code field. Old rows stored the retailer code
   * here. Kept so historic data migrates cleanly; new code should read
   * perigeeCode / salesCode instead.
   */
  siteCode?: string;
}

const BLOB_KEY = 'admin/stores.json';

/** Normalize a store name for fuzzy matching: lowercase, strip separators/punctuation/whitespace. */
export function normalizeStoreName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '') // drop spaces, dashes, apostrophes, etc.
    .trim();
}

/**
 * Strip a trailing " - <code>" site-code suffix from a sales store name
 * (e.g. "HIRSCHS MILNERTON - 120" → "HIRSCHS MILNERTON"). Perigee visit names
 * carry no such suffix, so stripping it lets the two feeds match by name. Only
 * the trailing " - token" is removed, so qualifiers like " DC" / " WAREHOUSE" /
 * "(SUPERSTORE)" are preserved and a store never collapses into its DC.
 */
export function stripSiteCodeSuffix(name: string): string {
  return (name || '').replace(/\s*-\s*[A-Za-z0-9]+\s*$/, '').trim();
}

/** Suffix-insensitive name key: strip the " - <code>" suffix, then normalize. */
export function storeNameKey(name: string): string {
  return normalizeStoreName(stripSiteCodeSuffix(name));
}

/** Normalize a store code for matching: lowercase + trim. */
export function normalizeCode(code: string): string {
  return (code || '').toLowerCase().trim();
}

/**
 * Heuristic: does this store name look like a distribution centre / warehouse
 * (a location that appears in sales/stock data but is never visited by a rep)?
 * Used to bulk-tag DC rows. Matches a standalone "DC" token, "WAREHOUSE", or
 * "DISTRIBUTION CENTRE".
 */
export function looksLikeDc(name: string): boolean {
  return /\bdc\b|ware\s*house|distribution\s*cent/i.test(name || '');
}

/**
 * Migrate any stored shape into the current model. Old rows had only
 * `{ siteCode, storeName, channelId }` populated from DISPO uploads, so their
 * code is a retailer SALES code and the row represents a sales-feed store.
 */
export function normalizeStore(raw: Partial<StoreMaster>): StoreMaster {
  const storeName = (raw.storeName || '').trim();
  const hasNewShape = raw.perigeeCode !== undefined || raw.salesName !== undefined || raw.source !== undefined;

  if (hasNewShape) {
    return {
      perigeeCode: (raw.perigeeCode || '').trim(),
      storeName,
      channelId: raw.channelId || '',
      area: raw.area || '',
      assignedBaEmail: raw.assignedBaEmail || '',
      assignedBaName: raw.assignedBaName || '',
      salesName: raw.salesName || '',
      salesCode: (raw.salesCode || '').trim(),
      notInData: raw.notInData ?? false,
      isDc: raw.isDc ?? false,
      altPerigeeCodes: (raw.altPerigeeCodes || []).map(c => (c || '').trim()).filter(Boolean),
      source: raw.source || 'manual',
      siteCode: (raw.siteCode || '').trim(),
    };
  }

  // Legacy row: came from a DISPO upload, so it's a sales-feed store.
  const legacyCode = (raw.siteCode || '').trim();
  return {
    perigeeCode: '',
    storeName,
    channelId: raw.channelId || '',
    area: raw.area || '',
    assignedBaEmail: raw.assignedBaEmail || '',
    assignedBaName: raw.assignedBaName || '',
    salesName: storeName,
    salesCode: legacyCode,
    notInData: false,
    isDc: false,
    altPerigeeCodes: [],
    source: 'sales',
    siteCode: legacyCode,
  };
}

/**
 * Every code that identifies this store: the primary Perigee code, any alias
 * Perigee codes, the sales code, and the legacy siteCode. Used so a visit under
 * ANY of a store's codes resolves to it.
 */
export function storeAllCodes(s: StoreMaster): string[] {
  return [s.perigeeCode, ...(s.altPerigeeCodes || []), s.salesCode, s.siteCode]
    .map(c => (c || '').trim())
    .filter(Boolean);
}

export async function loadStores(): Promise<StoreMaster[]> {
  const raw = await readJson<Partial<StoreMaster>[]>(BLOB_KEY, []);
  return raw.map(normalizeStore);
}

export async function saveStores(stores: StoreMaster[]): Promise<void> {
  await writeJson(BLOB_KEY, stores.map(normalizeStore));
}

/** The name used to index the channel sales maps (dispo/Hirsch's) for a store. */
export function storeSalesKey(s: StoreMaster): string {
  return (s.salesName || s.storeName || '').trim();
}

/** True when a store has a sales feed linked (or is explicitly marked as having none). */
export function storeHasSalesLink(s: StoreMaster): boolean {
  return !!(s.salesName && s.salesName.trim());
}

/**
 * Map EVERY known store code (Perigee/visit code, sales code, legacy siteCode)
 * to the store's sales-data name. This is what lets a visit's Perigee storeCode
 * resolve to the linked sales feed, while still working for older rows where the
 * Perigee code and the sales code happen to be identical.
 *
 * @param caseT match the caller's existing key casing ('upper' or 'lower').
 */
export function buildCodeToSalesName(stores: StoreMaster[], caseT: 'upper' | 'lower' = 'upper'): Record<string, string> {
  const fix = (c: string) => (caseT === 'upper' ? c.trim().toUpperCase() : c.trim().toLowerCase());
  const out: Record<string, string> = {};
  for (const s of stores) {
    const sales = storeSalesKey(s);
    if (!sales) continue;
    for (const code of storeAllCodes(s)) {
      const k = fix(code);
      if (!(k in out)) out[k] = sales;
    }
  }
  return out;
}

export interface StoreAssignment {
  email: string;
  repName: string;
  salesName: string;
}

/**
 * Map every known code of an explicitly BA-assigned store to its assignment.
 * Keyed by Perigee code, sales code and legacy siteCode so a visit (Perigee
 * code) and the sales feed (sales code) both resolve to the same assignment.
 */
export function buildAssignmentByCode(stores: StoreMaster[], caseT: 'upper' | 'lower' = 'upper'): Map<string, StoreAssignment> {
  const fix = (c: string) => (caseT === 'upper' ? c.trim().toUpperCase() : c.trim().toLowerCase());
  const out = new Map<string, StoreAssignment>();
  for (const s of stores) {
    if (!s.assignedBaEmail) continue;
    const a: StoreAssignment = {
      email: s.assignedBaEmail.toLowerCase(),
      repName: s.assignedBaName || s.assignedBaEmail,
      salesName: storeSalesKey(s),
    };
    for (const code of storeAllCodes(s)) out.set(fix(code), a);
  }
  return out;
}

/**
 * Upsert a master row for every store seen in `visits`. Matches an existing row
 * by Perigee code, then by normalized name; otherwise creates a new
 * visit-sourced row (channel left blank for the admin to assign). Backfills the
 * Perigee code onto a previously sales-only row when the names match. Mutates
 * and returns `stores` plus the count of brand-new rows.
 */
export function upsertVisitedStores(stores: StoreMaster[], visits: Visit[]): { added: number; stores: StoreMaster[] } {
  const byPerigee = new Map<string, StoreMaster>();
  const byName = new Map<string, StoreMaster>();
  // Index sales/master rows by their suffix-insensitive name key so a visit
  // ("HIRSCHS MILNERTON") matches a sales row ("HIRSCHS MILNERTON - 120").
  for (const s of stores) {
    for (const c of [s.perigeeCode, ...(s.altPerigeeCodes || [])]) {
      if (c && c.trim()) byPerigee.set(normalizeCode(c), s);
    }
    for (const n of [s.storeName, s.salesName]) {
      if (n && n.trim() && !byName.has(storeNameKey(n))) byName.set(storeNameKey(n), s);
    }
  }

  // Collapse visits down to distinct stores (prefer a row that carries a code).
  const seen = new Map<string, { code: string; name: string }>();
  for (const v of visits) {
    const name = (v.storeName || '').trim();
    const code = (v.storeCode || '').trim();
    if (!name && !code) continue;
    const key = code ? `c:${normalizeCode(code)}` : `n:${storeNameKey(name)}`;
    const existing = seen.get(key);
    if (!existing) seen.set(key, { code, name });
    else if (code && !existing.code) existing.code = code;
  }

  let added = 0;
  for (const { code, name } of seen.values()) {
    let row: StoreMaster | undefined;
    if (code) row = byPerigee.get(normalizeCode(code));
    if (!row && name) row = byName.get(storeNameKey(name));
    if (row) {
      if (code && !row.perigeeCode) { row.perigeeCode = code; byPerigee.set(normalizeCode(code), row); }
      if (name && !row.storeName) row.storeName = name;
      byName.set(storeNameKey(name), row);
      continue;
    }
    const createdRow = normalizeStore({ perigeeCode: code, storeName: name, channelId: '', source: 'visit' });
    stores.push(createdRow);
    if (code) byPerigee.set(normalizeCode(code), createdRow);
    if (name) byName.set(storeNameKey(name), createdRow);
    added++;
  }
  return { added, stores };
}

/** Load the master, upsert the visited stores, and persist if anything changed. */
export async function syncVisitedStores(visits: Visit[]): Promise<number> {
  const stores = await loadStores();
  const { added, stores: updated } = upsertVisitedStores(stores, visits);
  if (added > 0) await saveStores(updated);
  return added;
}

/**
 * Link channel sales-feed stores (Makro DISPO, Hirsch's, …) to the master.
 * For each sales store: match an existing row by sales code, existing sales
 * name, a visited row whose Perigee code equals the sales code, then by
 * normalized name; attach salesName/salesCode to the match, or create a new
 * sales-sourced row (not yet linked to a visited store). Mutates and returns
 * `stores` with stats.
 */
export function linkSalesStores(
  stores: StoreMaster[],
  salesStores: { siteCode: string; siteName: string }[],
): { matched: number; created: number; createdNames: string[]; stores: StoreMaster[] } {
  const byPerigee = new Map<string, StoreMaster>();
  const bySalesCode = new Map<string, StoreMaster>();
  const bySalesName = new Map<string, StoreMaster>();
  const byName = new Map<string, StoreMaster>();
  for (const s of stores) {
    if (s.perigeeCode) byPerigee.set(normalizeCode(s.perigeeCode), s);
    if (s.salesCode) bySalesCode.set(normalizeCode(s.salesCode), s);
    if (s.siteCode) bySalesCode.set(normalizeCode(s.siteCode), s);
    if (s.salesName) bySalesName.set(normalizeStoreName(s.salesName), s);
    if (s.storeName) byName.set(normalizeStoreName(s.storeName), s);
  }

  let matched = 0;
  let created = 0;
  const createdNames: string[] = [];
  for (const { siteCode, siteName } of salesStores) {
    const code = (siteCode || '').trim();
    const name = (siteName || '').trim();
    if (!name && !code) continue;
    const row =
      (code ? bySalesCode.get(normalizeCode(code)) : undefined) ||
      (name ? bySalesName.get(normalizeStoreName(name)) : undefined) ||
      (code ? byPerigee.get(normalizeCode(code)) : undefined) ||
      (name ? byName.get(normalizeStoreName(name)) : undefined);
    if (row) {
      if (name) { row.salesName = name; bySalesName.set(normalizeStoreName(name), row); }
      if (code) { row.salesCode = code; if (!row.siteCode) row.siteCode = code; bySalesCode.set(normalizeCode(code), row); }
      matched++;
    } else {
      const createdRow = normalizeStore({
        perigeeCode: '', storeName: name, channelId: '',
        salesName: name, salesCode: code, siteCode: code, source: 'sales',
      });
      stores.push(createdRow);
      if (code) bySalesCode.set(normalizeCode(code), createdRow);
      if (name) { bySalesName.set(normalizeStoreName(name), createdRow); byName.set(normalizeStoreName(name), createdRow); }
      created++;
      createdNames.push(name || code);
    }
  }
  return { matched, created, createdNames, stores };
}
