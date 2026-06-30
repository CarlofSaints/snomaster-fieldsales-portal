import { readJson, writeJson } from './blob';
import type { Visit } from './visitData';
import { fetchAllPerigeeVisits, PerigeeFetchError } from './perigeeFetch';

/**
 * Perigee API integration — shared by the manual poll route and the cron poll route.
 *
 * SnoMaster has NO single Perigee user attached to every store, so visits are split
 * across MORE THAN ONE API token (one per rep/account scope). We therefore store a
 * LIST of tokens, call the same endpoint once per enabled token, and merge + dedupe
 * the visits from all of them. Overlap between tokens is handled by the normal
 * visit dedup pipeline (visitDedupeKey).
 */

export interface PerigeeToken {
  id: string;
  label: string;     // human label, e.g. "Makro reps" / "Hirsch's reps"
  apiKey: string;
  enabled: boolean;
}

export interface PerigeeConfig {
  endpoint: string;
  enabled: boolean;
  lastPolledAt: string | null;
  requestBody: string;       // JSON body template sent to Perigee
  tokens: PerigeeToken[];
  /** @deprecated legacy single-token field — migrated into `tokens` by normalizePerigeeConfig */
  apiKey?: string;
}

export const PERIGEE_CONFIG_KEY = 'config/perigee-api.json';

const EMPTY_CONFIG: PerigeeConfig = {
  endpoint: '',
  enabled: false,
  lastPolledAt: null,
  requestBody: '',
  tokens: [],
};

/** Normalize any stored shape into the current multi-token shape (migrates legacy `apiKey`). */
export function normalizePerigeeConfig(raw: Partial<PerigeeConfig> | null | undefined): PerigeeConfig {
  const cfg: PerigeeConfig = {
    endpoint: raw?.endpoint ?? '',
    enabled: raw?.enabled ?? false,
    lastPolledAt: raw?.lastPolledAt ?? null,
    requestBody: raw?.requestBody ?? '',
    tokens: Array.isArray(raw?.tokens) ? raw!.tokens!.map(normalizeToken) : [],
  };
  // Migrate a legacy single token into the list
  if (cfg.tokens.length === 0 && raw?.apiKey) {
    cfg.tokens = [{ id: 'legacy', label: 'Token 1', apiKey: raw.apiKey, enabled: true }];
  }
  return cfg;
}

function normalizeToken(t: Partial<PerigeeToken>): PerigeeToken {
  return {
    id: t.id || crypto.randomUUID(),
    label: t.label || 'Token',
    apiKey: t.apiKey || '',
    enabled: t.enabled !== false,
  };
}

export async function loadPerigeeConfig(): Promise<PerigeeConfig> {
  const raw = await readJson<Partial<PerigeeConfig>>(PERIGEE_CONFIG_KEY, EMPTY_CONFIG);
  return normalizePerigeeConfig(raw);
}

export async function savePerigeeConfig(cfg: PerigeeConfig): Promise<void> {
  // Drop the legacy field on save so it doesn't linger
  const { apiKey: _legacy, ...clean } = cfg;
  void _legacy;
  await writeJson(PERIGEE_CONFIG_KEY, clean);
}

/** Mask a token for display: ••••1234 */
export function maskToken(key: string): string {
  return key ? '••••' + key.slice(-4) : '';
}

/** Tokens that are enabled and actually have a key — the ones we poll. */
export function activeTokens(cfg: PerigeeConfig): PerigeeToken[] {
  return cfg.tokens.filter(t => t.enabled && t.apiKey.trim());
}

/** Pull the visits array out of whatever shape Perigee returns. */
export function extractRawVisits(perigeeData: unknown): Record<string, unknown>[] {
  if (Array.isArray(perigeeData)) return perigeeData as Record<string, unknown>[];
  const d = perigeeData as Record<string, unknown>;
  if (d?.visits && Array.isArray((d.visits as Record<string, unknown>).data)) {
    return (d.visits as Record<string, unknown>).data as Record<string, unknown>[];
  }
  if (Array.isArray(d?.visits)) return d.visits as Record<string, unknown>[];
  if (Array.isArray(d?.data)) return d.data as Record<string, unknown>[];
  return [];
}

export interface TokenFetchResult {
  tokenId: string;
  label: string;
  ok: boolean;
  status?: number;
  count: number;
  error?: string;
  rawVisits: Record<string, unknown>[];
  /** full parsed response (only kept for the first token, used by test mode) */
  raw?: unknown;
}

/**
 * Fetch ALL visits for a single token, walking EVERY page of Perigee's
 * paginated response. Reading only page 1 (the old behaviour) silently dropped
 * most visits for busy date ranges.
 */
export async function fetchVisitsForToken(
  endpoint: string,
  token: PerigeeToken,
  body: Record<string, unknown>,
  keepRaw = false,
): Promise<TokenFetchResult> {
  try {
    const { rows, firstPageMeta } = await fetchAllPerigeeVisits(endpoint, token.apiKey, body);
    return {
      tokenId: token.id, label: token.label, ok: true, status: 200,
      count: rows.length, rawVisits: rows,
      // Test mode reads `.visits` (pagination meta) off raw — the helper already
      // stripped `data`, so wrap the page-1 meta back under `visits`.
      raw: keepRaw ? { visits: firstPageMeta } : undefined,
    };
  } catch (err) {
    if (err instanceof PerigeeFetchError) {
      return { tokenId: token.id, label: token.label, ok: false, status: err.status, count: 0, error: `${err.status}: ${err.detail.slice(0, 200)}`, rawVisits: [] };
    }
    return { tokenId: token.id, label: token.label, ok: false, count: 0, error: err instanceof Error ? err.message : 'Fetch failed', rawVisits: [] };
  }
}

/**
 * Call the endpoint for every active token and combine the raw visit rows.
 * One token failing does NOT abort the others — its error is reported in `perToken`.
 */
export async function fetchAllVisits(
  cfg: PerigeeConfig,
  body: Record<string, unknown>,
  keepRaw = false,
): Promise<{ rawVisits: Record<string, unknown>[]; perToken: TokenFetchResult[] }> {
  const tokens = activeTokens(cfg);
  const perToken = await Promise.all(tokens.map((t, i) => fetchVisitsForToken(cfg.endpoint, t, body, keepRaw && i === 0)));
  const rawVisits = perToken.flatMap(r => r.rawVisits);
  return { rawVisits, perToken };
}

/** Format a Perigee visit duration from times, falling back across date-time fields. */
function calcDuration(checkInTime: string, checkOutTime: string, startDateFull: string, endDateFull: string): string {
  if (!checkInTime || !checkOutTime) return '';
  const inParts = checkInTime.split(':').map(Number);
  const outParts = checkOutTime.split(':').map(Number);
  if (inParts.length < 2 || outParts.length < 2) return '';
  let diffMin: number;
  if (startDateFull && endDateFull && startDateFull.includes(' ') && endDateFull.includes(' ')) {
    const startMs = new Date(startDateFull.replace(' ', 'T')).getTime();
    const endMs = new Date(endDateFull.replace(' ', 'T')).getTime();
    if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return '';
    diffMin = Math.round((endMs - startMs) / 60000);
  } else {
    diffMin = (outParts[0] * 60 + outParts[1]) - (inParts[0] * 60 + inParts[1]);
  }
  if (diffMin <= 0) return '';
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Map a raw Perigee row to our Visit shape. */
export function mapPerigeeVisit(row: Record<string, unknown>): Visit {
  const str = (key: string) => String(row[key] ?? '').trim();
  const num = (key: string) => parseInt(String(row[key] ?? '0')) || 0;

  const rawStore = str('store') || str('Store Full Name') || str('storeName') || str('place') || '';
  let storeName = rawStore;
  let storeCode = str('storeCode') || str('placeId') || '';
  if (!storeCode && rawStore.includes(' - ')) {
    const lastDash = rawStore.lastIndexOf(' - ');
    storeName = rawStore.substring(0, lastDash).trim();
    storeCode = rawStore.substring(lastDash + 3).trim();
  }

  let checkInDate = str('checkInDate') || '';
  const startDateFull = str('startDateFull');
  if (!checkInDate) {
    if (startDateFull && startDateFull.includes(' ')) checkInDate = startDateFull.split(' ')[0];
    else checkInDate = str('date') || '';
  }

  let checkOutDate = str('checkOutDate') || '';
  const endDateFull = str('endDateFull');
  if (!checkOutDate && endDateFull && endDateFull.includes(' ')) checkOutDate = endDateFull.split(' ')[0];

  const checkInTime = str('checkInTime') || str('startTime') || '';
  const checkOutTime = str('checkOutTime') || str('endTime') || '';
  const email = str('email') || str('username') || str('Username') || str('representativeId') || '';
  const repName = str('repName') || str('displayName') || str('representativeName') || '';
  const channel = str('channel') || str('Channel') || '';
  const status = str('status') || str('callStatus') || '';
  const visitId = str('visitGuid') || str('guid') || str('visitId') || '';

  const rawDuration = str('visitDuration') || str('timeAtPlace') || '';
  const visitDuration = rawDuration || calcDuration(checkInTime, checkOutTime, startDateFull, endDateFull);

  return {
    email, repName, channel, storeName, storeCode,
    checkInDate, checkInTime, checkOutDate, checkOutTime,
    checkInDistance: str('checkInDistance') || '',
    checkOutDistance: str('checkOutDistance') || '',
    visitDuration,
    formsCompleted: num('formsCompleted'),
    picsUploaded: num('picsUploaded'),
    status,
    networkOnCheckIn: str('networkOnCheckIn') || '',
    visitId: visitId || undefined,
  };
}
