import { NextRequest, NextResponse } from 'next/server';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import { loadVisitIndex, loadVisitData } from '@/lib/visitData';
import { loadStores, normalizeCode, normalizeStoreName } from '@/lib/storeData';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * READ-ONLY diagnostic: explain why Perigee visits are/aren't linking to the
 * (Hirsch/Makro) sales stores, and why the store master's Perigee codes are
 * blank. Answers three questions with real data:
 *   1. Do Perigee visits carry a storeCode at all? (or is it always blank?)
 *   2. Do those visit storeCodes match any sales code in the store master?
 *   3. Do visited stores even exist in the master as rows with a perigeeCode?
 *
 * Usage: /api/debug/store-link?secret=snomaster-seed-2026[&q=hirsch]
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret') || '';
  if (secret !== 'snomaster-seed-2026') {
    const user = await requireRole(req, ['super_admin', 'admin']);
    if (!user) return NextResponse.json({ error: 'Unauthorized — add &secret=snomaster-seed-2026' }, { status: 401 });
  }
  const q = (url.searchParams.get('q') || '').toLowerCase().trim();

  const [index, stores] = await Promise.all([loadVisitIndex(), loadStores()]);

  // --- Store master summary -------------------------------------------------
  const codeIndex = new Map<string, string>(); // any known code -> store label
  const nameIndex = new Map<string, string>(); // normalized name -> store label
  for (const s of stores) {
    const label = s.salesName || s.storeName || '';
    for (const c of [s.perigeeCode, s.salesCode, s.siteCode]) {
      if (c && c.trim()) codeIndex.set(normalizeCode(c), label);
    }
    for (const n of [s.storeName, s.salesName]) {
      if (n && n.trim()) nameIndex.set(normalizeStoreName(n), label);
    }
  }
  const masterStats = {
    total: stores.length,
    withPerigeeCode: stores.filter(s => (s.perigeeCode || '').trim()).length,
    withSalesCode: stores.filter(s => (s.salesCode || '').trim()).length,
    linked: stores.filter(s => (s.perigeeCode || '').trim() && (s.salesCode || '').trim()).length,
    bySource: stores.reduce((m, s) => { const k = s.source || 'unknown'; m[k] = (m[k] || 0) + 1; return m; }, {} as Record<string, number>),
  };

  // --- Visit aggregates -----------------------------------------------------
  // Distinct (storeName, storeCode) pairs across all visits, with counts.
  const visitStores = new Map<string, { name: string; code: string; count: number }>();
  let totalVisits = 0;
  let visitsWithCode = 0;
  for (const meta of index) {
    const visits = await loadVisitData(meta.id);
    for (const v of visits) {
      totalVisits++;
      const name = (v.storeName || '').trim();
      const code = (v.storeCode || '').trim();
      if (code) visitsWithCode++;
      const key = `${normalizeStoreName(name)}|${normalizeCode(code)}`;
      const e = visitStores.get(key) || { name, code, count: 0 };
      e.count++;
      visitStores.set(key, e);
    }
  }

  // For each distinct visit store, can we resolve it to a master row?
  let resolvedByCode = 0, resolvedByName = 0, unresolved = 0;
  const rows = [...visitStores.values()]
    .filter(v => !q || `${v.name} ${v.code}`.toLowerCase().includes(q))
    .sort((a, b) => b.count - a.count)
    .map(v => {
      const byCode = v.code ? codeIndex.get(normalizeCode(v.code)) : undefined;
      const byName = nameIndex.get(normalizeStoreName(v.name));
      if (byCode) resolvedByCode++; else if (byName) resolvedByName++; else unresolved++;
      return {
        visitStoreName: v.name,
        visitStoreCode: v.code || '(blank)',
        visits: v.count,
        resolvesByCode: byCode || null,
        resolvesByName: byName || null,
        status: byCode ? 'linked-by-code' : byName ? 'name-only (code mismatch/blank)' : 'UNRESOLVED — not in master',
      };
    });

  // Sample Hirsch-ish master rows for reference.
  const hirschRows = stores
    .filter(s => /hirsch|tafelberg/i.test(`${s.storeName} ${s.salesName || ''}`))
    .slice(0, 25)
    .map(s => ({ storeName: s.storeName, salesName: s.salesName, perigeeCode: s.perigeeCode || '(blank)', salesCode: s.salesCode || '(blank)', source: s.source }));

  return NextResponse.json({
    masterStats,
    visitStats: { totalVisits, visitsWithCode, visitsWithoutCode: totalVisits - visitsWithCode, distinctVisitStores: visitStores.size },
    resolution: { resolvedByCode, resolvedByName, unresolved },
    visitStoreRows: rows.slice(0, 60),
    sampleMasterRows: hirschRows,
    note: 'If visitsWithCode is ~0, Perigee is not sending a store code → matching must fall back to NAME. If codes exist but resolvesByCode is null while resolvesByName is set, the code namespaces differ (Perigee code != Hirsch site code) and the store-name suffix " - <code>" is likely breaking name matches too.',
  }, { headers: noCacheHeaders() });
}
