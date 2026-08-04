import { StoreControlEntry } from './types';

/**
 * Case-insensitive header lookup. Returns the column index of the first
 * header that matches any of the candidate strings (compared lowercased +
 * trimmed), or -1 if none match.
 */
export function findHeader(headers: string[], candidates: string[]): number {
  for (const c of candidates) {
    const idx = headers.findIndex(h => h.toLowerCase().trim() === c.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * Convert raw rows from a store control Excel sheet into typed
 * StoreControlEntry[]. Shared between the legacy JSON upload route and the
 * new Blob-direct process route.
 */
export function processStoreRows(
  headers: string[],
  dataRows: string[][],
): { stores: StoreControlEntry[]; error?: string } {
  const colCountry = findHeader(headers, ['country']);
  const colProvince = findHeader(headers, ['province']);
  const colChannel = findHeader(headers, ['channel']);
  const colStoreName = findHeader(headers, ['store name', 'storename']);
  const colStoreCode = findHeader(headers, ['store code', 'storecode', 'store id', 'storeid']);
  const colActive = findHeader(headers, ['active']);
  const colLong = findHeader(headers, ['longitude', 'long']);
  const colLat = findHeader(headers, ['latitude', 'lat']);
  const colLocStatus = findHeader(headers, ['location status', 'locationstatus']);
  const colIgnoreLoc = findHeader(headers, ['ignore location data', 'ignorelocationdata']);
  const colEmail = findHeader(headers, ['email', 'store email']);
  const colCreatedBy = findHeader(headers, ['created by', 'createdby']);
  const colUpdatedBy = findHeader(headers, ['updated by', 'updatedby']);

  if (colStoreCode < 0 || colStoreName < 0) {
    return { stores: [], error: 'Required columns not found: Store Code, Store Name' };
  }

  const stores: StoreControlEntry[] = [];
  for (const r of dataRows) {
    const storeCode = String(r[colStoreCode] || '').trim();
    if (!storeCode) continue;

    const activeVal = colActive >= 0 ? String(r[colActive] || '').trim().toUpperCase() : 'YES';

    stores.push({
      country: colCountry >= 0 ? String(r[colCountry] || '').trim() : '',
      province: colProvince >= 0 ? String(r[colProvince] || '').trim() : '',
      channel: colChannel >= 0 ? String(r[colChannel] || '').trim() : '',
      storeName: String(r[colStoreName] || '').trim(),
      storeCode,
      active: activeVal === 'YES' || activeVal === 'TRUE' || activeVal === '1',
      longitude: colLong >= 0 ? String(r[colLong] || '').trim() : '',
      latitude: colLat >= 0 ? String(r[colLat] || '').trim() : '',
      locationStatus: colLocStatus >= 0 ? String(r[colLocStatus] || '').trim() : '',
      ignoreLocationData: colIgnoreLoc >= 0 ? ['YES', 'TRUE', '1'].includes(String(r[colIgnoreLoc] || '').trim().toUpperCase()) : false,
      email: colEmail >= 0 ? String(r[colEmail] || '').trim() : '',
      createdBy: colCreatedBy >= 0 ? String(r[colCreatedBy] || '').trim() : '',
      updatedBy: colUpdatedBy >= 0 ? String(r[colUpdatedBy] || '').trim() : '',
    });
  }

  return { stores };
}
