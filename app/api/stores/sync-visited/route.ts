import { NextRequest, NextResponse } from 'next/server';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import { loadVisitIndex, loadVisitData } from '@/lib/visitData';
import { loadStores, saveStores, upsertVisitedStores } from '@/lib/storeData';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Backfill: upsert a master row for every store ever seen in the visit history,
 * stamping each visit's Perigee code. Suffix-insensitive name matching links a
 * visit ("HIRSCHS MILNERTON") onto its sales row ("HIRSCHS MILNERTON - 120").
 *
 * Needed because the live-poll auto-upsert only processes NEW polls, so stores
 * imported before that feature (or via manual upload) never got their Perigee
 * codes into the master. Idempotent — safe to re-run.
 */
export async function POST(req: NextRequest) {
  const user = await requireRole(req, ['super_admin', 'admin']);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [index, stores] = await Promise.all([loadVisitIndex(), loadStores()]);
  const allVisits = [];
  for (const meta of index) allVisits.push(...(await loadVisitData(meta.id)));

  const hasPerigee = (s: { perigeeCode?: string }) => !!(s.perigeeCode || '').trim();
  const isLinked = (s: { perigeeCode?: string; salesCode?: string }) => hasPerigee(s) && !!(s.salesCode || '').trim();
  const withPerigeeBefore = stores.filter(hasPerigee).length;
  const linkedBefore = stores.filter(isLinked).length;

  const { added, stores: updated } = upsertVisitedStores(stores, allVisits);
  await saveStores(updated);

  const withPerigeeAfter = updated.filter(hasPerigee).length;
  const linkedAfter = updated.filter(isLinked).length;

  return NextResponse.json({
    ok: true,
    visitsProcessed: allVisits.length,
    newVisitedRows: added,
    withPerigeeBefore,
    withPerigeeAfter,
    linkedBefore,
    linkedAfter,
    newlyLinked: linkedAfter - linkedBefore,
    unlinkedRemaining: updated.filter(s => hasPerigee(s) && !(s.salesCode || '').trim()).length,
  }, { headers: noCacheHeaders() });
}
