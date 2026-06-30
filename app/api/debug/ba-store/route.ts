import { NextRequest, NextResponse } from 'next/server';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import { loadVisitIndex, loadVisitData } from '@/lib/visitData';
import { loadStores, normalizeCode, normalizeStoreName } from '@/lib/storeData';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * READ-ONLY diagnostic: explain why a BA shows a particular store.
 * Mirrors the leaderboard's CURRENT logic (most-visited store, assignment
 * overrides) and surfaces every possible source of a wrong store:
 *   - his actual visited stores (with counts)
 *   - any store-master row ASSIGNED to him
 *   - whether his email/login is shared with other rep names (collision)
 *   - any store-master row whose name matches the suspect store
 *
 * Usage: /api/debug/ba-store?q=josephe[&suspect=milnerton]
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  // Allow either a logged-in admin (header token) OR a shared secret in the URL
  // so the diagnostic can be opened directly in a browser.
  const secret = url.searchParams.get('secret') || '';
  if (secret !== 'snomaster-seed-2026') {
    const user = await requireRole(req, ['super_admin', 'admin']);
    if (!user) return NextResponse.json({ error: 'Unauthorized — add &secret=snomaster-seed-2026 to the URL, or call it from within the app.' }, { status: 401 });
  }

  const q = (url.searchParams.get('q') || '').toLowerCase().trim();
  const suspect = (url.searchParams.get('suspect') || 'milnerton').toLowerCase().trim();
  if (!q) return NextResponse.json({ error: 'Pass ?q=<email or name>' }, { status: 400 });

  const [index, storeMaster] = await Promise.all([loadVisitIndex(), loadStores()]);

  // Per email: rep names seen, store visit counts, store codes seen.
  const byEmail = new Map<string, {
    repNames: Set<string>;
    storeCounts: Map<string, number>;
    codes: Set<string>;
    suspectVisits: number;
  }>();
  // Reverse: which emails ever visited a store whose name matches the suspect.
  const suspectVisitsByEmail = new Map<string, number>();

  for (const meta of index) {
    const visits = await loadVisitData(meta.id);
    for (const v of visits) {
      const email = (v.email || '').toLowerCase();
      const hay = `${v.email} ${v.repName}`.toLowerCase();
      const matchesQuery = hay.includes(q);
      const storeName = v.storeName || '';
      const isSuspect = storeName.toLowerCase().includes(suspect);

      if (isSuspect && email) {
        suspectVisitsByEmail.set(email, (suspectVisitsByEmail.get(email) || 0) + 1);
      }

      if (!matchesQuery || !email) continue;
      if (!byEmail.has(email)) byEmail.set(email, { repNames: new Set(), storeCounts: new Map(), codes: new Set(), suspectVisits: 0 });
      const e = byEmail.get(email)!;
      if (v.repName) e.repNames.add(v.repName);
      if (storeName) e.storeCounts.set(storeName, (e.storeCounts.get(storeName) || 0) + 1);
      if (v.storeCode) e.codes.add(v.storeCode);
      if (isSuspect) e.suspectVisits++;
    }
  }

  // For each matched email, work out the most-visited store + assignment.
  const report = [];
  for (const [email, e] of byEmail) {
    const counts = [...e.storeCounts.entries()].sort((a, b) => b[1] - a[1]);
    const mostVisited = counts.length ? { store: counts[0][0], visits: counts[0][1] } : null;

    // Store-master rows assigned to this email.
    const assignedRows = storeMaster
      .filter(s => (s.assignedBaEmail || '').toLowerCase() === email)
      .map(s => ({ storeName: s.storeName, salesName: s.salesName, perigeeCode: s.perigeeCode, salesCode: s.salesCode }));

    // What the leaderboard would display: assignment wins, else most-visited.
    const assignedDisplay = assignedRows.length ? (assignedRows[0].salesName || assignedRows[0].storeName) : '';
    const wouldDisplay = assignedDisplay || mostVisited?.store || '(none)';

    report.push({
      email,
      repNames: [...e.repNames],
      sharedLoginWarning: e.repNames.size > 1 ? `⚠ This email is used by ${e.repNames.size} different rep names — visits from all of them are merged.` : null,
      visitedStores: Object.fromEntries(counts),
      mostVisitedStore: mostVisited,
      everVisitedSuspect: e.suspectVisits > 0 ? `${e.suspectVisits} visit(s) to a "${suspect}" store` : `NO visits to any "${suspect}" store`,
      assignedStoreRows: assignedRows,
      leaderboardWouldDisplay: wouldDisplay,
      diagnosis: assignedDisplay
        ? `Shows "${assignedDisplay}" because a store is ASSIGNED to this email in the Stores page.`
        : (mostVisited ? `Shows "${mostVisited.store}" because it is the most-visited store in the visit data.` : 'No store would show (no visits, no assignment).'),
    });
  }

  // Any store-master row whose name matches the suspect (to spot a stray link/assignment).
  const suspectRows = storeMaster
    .filter(s => `${s.storeName} ${s.salesName || ''}`.toLowerCase().includes(suspect))
    .map(s => ({ storeName: s.storeName, salesName: s.salesName, perigeeCode: s.perigeeCode, salesCode: s.salesCode, assignedBaEmail: s.assignedBaEmail, assignedBaName: s.assignedBaName }));

  return NextResponse.json({
    query: q,
    suspect,
    matchedEmails: report.length,
    report,
    suspectVisitsByAnyEmail: Object.fromEntries(suspectVisitsByEmail),
    storeMasterRowsMatchingSuspect: suspectRows,
    note: 'If "everVisitedSuspect" says NO and "leaderboardWouldDisplay" is the suspect store, the cause is in assignedStoreRows or storeMasterRowsMatchingSuspect (an assignment), or a shared login (sharedLoginWarning).',
  }, { headers: noCacheHeaders() });
}
