import { NextRequest, NextResponse } from 'next/server';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import { loadVisitIndex, loadVisitData } from '@/lib/visitData';
import { loadStores, normalizeCode, normalizeStoreName, storeAllCodes } from '@/lib/storeData';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * READ-ONLY diagnostic: for a store (name substring), show its visits broken
 * down by month and by the Perigee store code they arrived under, plus whether
 * each code resolves to a store-master row. Built to explain "store X has
 * visits overall but none for month Y".
 *
 * Usage: /api/debug/store-visits?q=ballito&secret=snomaster-seed-2026
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret') || '';
  if (secret !== 'snomaster-seed-2026') {
    const user = await requireRole(req, ['super_admin', 'admin']);
    if (!user) return NextResponse.json({ error: 'Unauthorized — add &secret=snomaster-seed-2026' }, { status: 401 });
  }
  const q = (url.searchParams.get('q') || '').toLowerCase().trim();
  if (!q) return NextResponse.json({ error: 'Pass ?q=<store name>' }, { status: 400 });

  const [index, stores] = await Promise.all([loadVisitIndex(), loadStores()]);

  // Map any store code (perigee/sales/legacy) → the master row it belongs to.
  const codeToMaster = new Map<string, string>();
  for (const s of stores) {
    const label = `${s.salesName || s.storeName}${s.isDc ? ' [DC]' : ''}`;
    for (const c of storeAllCodes(s)) codeToMaster.set(normalizeCode(c), label);
  }

  // Aggregate visits for stores whose NAME matches the query.
  const byMonth: Record<string, number> = {};
  const byCode: Record<string, { visits: number; storeNames: Set<string>; months: Set<string>; resolvesTo: string | null }> = {};
  const byNameCode: Record<string, number> = {};
  let total = 0;

  for (const meta of index) {
    const visits = await loadVisitData(meta.id);
    for (const v of visits) {
      const name = (v.storeName || '');
      if (!name.toLowerCase().includes(q)) continue;
      total++;
      const month = (v.checkInDate || '').slice(0, 7) || 'unknown';
      byMonth[month] = (byMonth[month] || 0) + 1;
      const code = (v.storeCode || '').trim() || '(blank)';
      if (!byCode[code]) byCode[code] = { visits: 0, storeNames: new Set(), months: new Set(), resolvesTo: codeToMaster.get(normalizeCode(code)) || null };
      byCode[code].visits++;
      byCode[code].storeNames.add(name);
      byCode[code].months.add(month);
      const nc = `${name} | ${code}`;
      byNameCode[nc] = (byNameCode[nc] || 0) + 1;
    }
  }

  const sortedMonths = Object.fromEntries(Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)));
  const codes = Object.fromEntries(
    Object.entries(byCode).sort(([, a], [, b]) => b.visits - a.visits).map(([code, d]) => [code, {
      visits: d.visits,
      resolvesTo: d.resolvesTo,
      storeNames: [...d.storeNames],
      months: [...d.months].sort(),
    }]),
  );

  return NextResponse.json({
    query: q,
    totalVisits: total,
    visitsByMonth: sortedMonths,
    byPerigeeCode: codes,
    byStoreNameAndCode: byNameCode,
    note: 'A month missing from visitsByMonth = no visits that month. If a code under byPerigeeCode has resolvesTo=null, its visits are NOT attributed to any linked store on the Sales page. Different codes/spellings for the "same" store split its visits.',
  }, { headers: noCacheHeaders() });
}
