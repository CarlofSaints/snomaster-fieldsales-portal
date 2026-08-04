import { NextRequest, NextResponse } from 'next/server';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import { loadVisitIndex, loadVisitData, visitDedupeKey, type Visit } from '@/lib/visitData';
import { loadScheduleWithTeamLeaders } from '@/lib/callcycle/scheduleData';
import { computeAdherence, type AdherenceVisit } from '@/lib/callcycle/adherenceCalc';
import { loadStores, storeAllCodes } from '@/lib/storeData';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Normalise a Perigee check-in date to YYYY-MM-DD. Adherence compares dates as
 * plain strings, so a DD/MM/YYYY row would silently never match — hence the
 * explicit conversion rather than trusting the feed.
 */
function normalizeDate(raw: string): string {
  const s = (raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // "YYYY-MM-DD HH:MM" and ISO timestamps
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) return s.slice(0, 10);
  return s;
}

export async function GET(req: NextRequest) {
  const actor = await requireRole(req, ['super_admin', 'admin', 'client']);
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noCacheHeaders() });
  }

  try {
    const url = new URL(req.url);
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');

    // Default window: the current month to date.
    const now = new Date();
    const from = fromParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const to = toParam || normalizeDate(now.toISOString());

    const [schedule, index, stores] = await Promise.all([
      loadScheduleWithTeamLeaders(),
      loadVisitIndex(),
      loadStores(),
    ]);

    const allVisits: Visit[] = [];
    for (const meta of index) {
      allVisits.push(...await loadVisitData(meta.id));
    }

    // Same dedupe the visits API uses — otherwise re-uploaded months double-count.
    const seen = new Set<string>();
    const deduped: Visit[] = [];
    for (const v of allVisits) {
      const key = visitDedupeKey(v);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(v);
    }

    // Perigee logs some stores under several codes. Fold every alias onto the
    // store's primary Perigee code so a visit under an alias still counts
    // against the scheduled store.
    const codeToPrimary = new Map<string, string>();
    for (const s of stores) {
      if (!s.perigeeCode) continue;
      for (const c of storeAllCodes(s)) {
        codeToPrimary.set(c.trim().toUpperCase(), s.perigeeCode.trim().toUpperCase());
      }
    }
    const canonical = (code: string) => {
      const k = (code || '').trim().toUpperCase();
      return codeToPrimary.get(k) || k;
    };

    const visits: AdherenceVisit[] = deduped.map(v => ({
      repEmail: v.email || '',
      storeCode: canonical(v.storeCode),
      checkInDate: normalizeDate(v.checkInDate),
    }));

    const scheduleCanonical = schedule.map(r => ({ ...r, storeId: canonical(r.storeId) }));

    const data = computeAdherence(
      scheduleCanonical,
      visits,
      new Date(`${from}T00:00:00`),
      new Date(`${to}T00:00:00`),
    );

    return NextResponse.json({ from, to, ...data }, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('[call-cycles/adherence] Error:', err);
    return NextResponse.json({ error: 'Failed to compute adherence', detail: String(err) }, { status: 500 });
  }
}
