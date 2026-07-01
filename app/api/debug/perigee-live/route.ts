import { NextRequest, NextResponse } from 'next/server';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import { loadPerigeeConfig, activeTokens, fetchAllVisits, mapPerigeeVisit } from '@/lib/perigee';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * READ-ONLY diagnostic: query PERIGEE LIVE (real tokens, ALL pages, all tokens)
 * for a store over a date range, and report what the SOURCE actually holds —
 * independent of what has been imported. Answers "does Perigee itself have
 * Feb–June visits for this store?" (import gap) vs "no recent visits at source"
 * (rep genuinely stopped).
 *
 * Usage: /api/debug/perigee-live?q=ballito&from=2026-02-01&to=2026-07-31&secret=snomaster-seed-2026
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret') || '';
  if (secret !== 'snomaster-seed-2026') {
    const user = await requireRole(req, ['super_admin']);
    if (!user) return NextResponse.json({ error: 'Unauthorized — add &secret=snomaster-seed-2026' }, { status: 401 });
  }

  const q = (url.searchParams.get('q') || '').toLowerCase().trim();
  const from = url.searchParams.get('from') || `${new Date().getFullYear()}-01-01`;
  const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10);

  const cfg = await loadPerigeeConfig();
  if (!cfg.endpoint || activeTokens(cfg).length === 0) {
    return NextResponse.json({ error: 'Perigee endpoint / tokens not configured (Settings → Perigee).' }, { status: 400 });
  }

  // Same body the Settings "Import" sends: the saved template with the range applied.
  let base: Record<string, unknown> = {};
  try { base = JSON.parse(cfg.requestBody || '{}'); } catch { /* ignore */ }
  const body = { ...base, startDate: from, endDate: to };

  const { rawVisits, perToken } = await fetchAllVisits(cfg, body);
  const mapped = rawVisits.map(mapPerigeeVisit);
  const matches = q ? mapped.filter(v => (v.storeName || '').toLowerCase().includes(q)) : mapped;

  const byMonth: Record<string, number> = {};
  const byCode: Record<string, { visits: number; storeNames: Set<string>; months: Set<string> }> = {};
  for (const v of matches) {
    const m = (v.checkInDate || '').slice(0, 7) || 'unknown';
    byMonth[m] = (byMonth[m] || 0) + 1;
    const code = (v.storeCode || '').trim() || '(blank)';
    if (!byCode[code]) byCode[code] = { visits: 0, storeNames: new Set(), months: new Set() };
    byCode[code].visits++;
    byCode[code].storeNames.add(v.storeName || '');
    byCode[code].months.add(m);
  }

  return NextResponse.json({
    source: 'PERIGEE LIVE (not the app’s stored data)',
    range: { from, to },
    query: q,
    perToken: perToken.map(t => ({ label: t.label, ok: t.ok, totalVisitsFetched: t.count, error: t.error })),
    totalFetchedAllStores: rawVisits.length,
    matchesForQuery: matches.length,
    visitsByMonth: Object.fromEntries(Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b))),
    byPerigeeCode: Object.fromEntries(
      Object.entries(byCode).sort(([, a], [, b]) => b.visits - a.visits).map(([code, d]) => [code, {
        visits: d.visits, storeNames: [...d.storeNames], months: [...d.months].sort(),
      }]),
    ),
    note: 'If visitsByMonth here shows Feb–June but the stored /store-visits diagnostic does not, the visits EXIST in Perigee and were missed on import (e.g. pagination) → re-import fixes it. If this is also empty, Perigee has no recent visits for the store → the rep genuinely stopped. Check perToken for a token returning 0 / an error.',
  }, { headers: noCacheHeaders() });
}
