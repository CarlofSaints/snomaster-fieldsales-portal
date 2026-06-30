import { NextRequest, NextResponse } from 'next/server';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import { loadVisitIndex, loadVisitData } from '@/lib/visitData';
import { loadStores } from '@/lib/storeData';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * READ-ONLY diagnostic: explain why a given BA shows a particular store on the
 * dashboard/leaderboard. Mirrors exactly how the leaderboard builds its
 * email -> storeName map (last-write-wins across the WHOLE visit index, every
 * month/upload), so we can see which row is actually winning.
 *
 * Usage: /api/debug/ba-store?q=josephe   (matches email OR repName, substring)
 */
export async function GET(req: NextRequest) {
  const user = await requireRole(req, ['super_admin', 'admin']);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = (new URL(req.url).searchParams.get('q') || '').toLowerCase().trim();
  if (!q) return NextResponse.json({ error: 'Pass ?q=<email or name>' }, { status: 400 });

  const [index, storeMaster] = await Promise.all([loadVisitIndex(), loadStores()]);

  // Replicate the leaderboard's storeMap build order exactly.
  const lastStoreByEmail = new Map<string, { storeName: string; storeCode: string; uploadId: string; fileName: string; checkInDate: string; repName: string }>();
  const matchedRows: Array<Record<string, unknown>> = [];
  const storeCounts = new Map<string, Map<string, number>>(); // emailKey -> storeName -> count

  for (const meta of index) {
    const visits = await loadVisitData(meta.id);
    for (const v of visits) {
      if (v.email) {
        const emailKey = v.email.toLowerCase();
        if (v.storeName) {
          lastStoreByEmail.set(emailKey, {
            storeName: v.storeName, storeCode: v.storeCode, uploadId: meta.id,
            fileName: meta.fileName, checkInDate: v.checkInDate, repName: v.repName,
          });
        }
      }
      const hay = `${v.email} ${v.repName}`.toLowerCase();
      if (hay.includes(q)) {
        matchedRows.push({
          uploadId: meta.id, fileName: meta.fileName,
          email: v.email, repName: v.repName, channel: v.channel,
          storeName: v.storeName, storeCode: v.storeCode,
          checkInDate: v.checkInDate, checkInTime: v.checkInTime, visitId: v.visitId,
        });
        const ek = (v.email || '').toLowerCase();
        if (!storeCounts.has(ek)) storeCounts.set(ek, new Map());
        const m = storeCounts.get(ek)!;
        m.set(v.storeName, (m.get(v.storeName) || 0) + 1);
      }
    }
  }

  // For each email key that matched, show what the leaderboard would display.
  const emailsMatched = Array.from(new Set(matchedRows.map(r => String(r.email || '').toLowerCase()).filter(Boolean)));
  const resolution = emailsMatched.map(ek => ({
    email: ek,
    leaderboardWouldShow: lastStoreByEmail.get(ek)?.storeName || '(none)',
    winningRow: lastStoreByEmail.get(ek) || null,
    distinctStoresVisited: Object.fromEntries(storeCounts.get(ek) || []),
    storeMasterAssignment: storeMaster
      .filter(s => (s.assignedBaEmail || '').toLowerCase() === ek)
      .map(s => ({ storeName: s.storeName, siteCode: s.siteCode })),
  }));

  return NextResponse.json({
    query: q,
    totalUploadsScanned: index.length,
    matchedRowCount: matchedRows.length,
    resolution,
    matchedRows,
  }, { headers: noCacheHeaders() });
}
