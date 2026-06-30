import { NextRequest, NextResponse } from 'next/server';
import { requireAnyUser, noCacheHeaders } from '@/lib/auth';
import { loadScores, calcTotal, calcGrandTotal, BAScore } from '@/lib/scoreData';
import { loadVisitIndex, loadVisitData } from '@/lib/visitData';
import { loadDispoData } from '@/lib/dispoData';
import { loadStores, buildCodeToSalesName, storeSalesKey, normalizeCode } from '@/lib/storeData';
import { loadHirschData } from '@/lib/hirschData';

export const dynamic = 'force-dynamic';

interface MonthScore {
  total: number;
  grandTotal: number;
  monthlySales: number;
  checkInOnTime: number;
  displayInspection: number;
  weeklySummaries: number;
  training: number;
  bonusSuggestions: number;
  salesVol?: number;
  salesVal?: number;
}

interface LeaderboardEntry {
  email: string;
  repName: string;
  storeName: string;
  scores: Record<string, MonthScore>;
}

function getLastNMonths(n: number): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    months.push(`${yyyy}-${mm}`);
  }
  return months;
}

function buildMonthScore(s: BAScore): MonthScore {
  return {
    total: calcTotal(s),
    grandTotal: calcGrandTotal(s),
    monthlySales: s.monthlySales,
    checkInOnTime: s.checkInOnTime,
    displayInspection: s.displayInspection,
    weeklySummaries: s.weeklySummaries,
    training: s.training,
    bonusSuggestions: s.bonusSuggestions,
  };
}

export async function GET(req: NextRequest) {
  const user = await requireAnyUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const url = new URL(req.url);
    const monthCount = Math.min(Number(url.searchParams.get('months')) || 6, 24);
    const months = getLastNMonths(monthCount);

    // Load visit index, DISPO data, and store master in parallel
    const [visitIndex, dispoData, storeMaster, hirschData] = await Promise.all([
      loadVisitIndex(),
      loadDispoData(),
      loadStores(),
      loadHirschData(),
    ]);

    // Resolve a BA to their store's Hirsch branch code (its salesCode) so we can
    // add Hirsch sales. Assignment wins; else the most-visited store's code.
    const anyCodeToSalesCode = new Map<string, string>();
    for (const s of storeMaster) {
      if (!s.salesCode) continue;
      for (const code of [s.perigeeCode, s.salesCode, s.siteCode]) {
        if (code && code.trim()) {
          const k = normalizeCode(code);
          if (!anyCodeToSalesCode.has(k)) anyCodeToSalesCode.set(k, s.salesCode);
        }
      }
    }
    const assignedBranchByEmail = new Map<string, string>();
    for (const s of storeMaster) {
      if (s.assignedBaEmail && s.salesCode) assignedBranchByEmail.set(s.assignedBaEmail.toLowerCase(), s.salesCode);
    }

    // Any store code (Perigee/sales/legacy) → the store's sales-data name.
    const codeToSalesName = buildCodeToSalesName(storeMaster, 'lower');

    // Normalized sales-store name lookup (lowercase → original sales key).
    const normToSalesName = new Map<string, string>();
    for (const monthData of Object.values(dispoData.sales)) {
      for (const store of Object.keys(monthData)) {
        normToSalesName.set(store.toLowerCase().trim(), store);
      }
    }

    // Per-BA visit aggregates across the WHOLE visit history.
    //   storeCounts: email → (storeName → #visits)
    //   codeByStoreName: "email|storeName" → that store's Perigee code
    const storeCounts = new Map<string, Map<string, number>>();
    const codeByStoreName = new Map<string, string>();
    for (const meta of visitIndex) {
      const visits = await loadVisitData(meta.id);
      for (const v of visits) {
        if (!v.email || !v.storeName) continue;
        const emailKey = v.email.toLowerCase();
        if (!storeCounts.has(emailKey)) storeCounts.set(emailKey, new Map());
        const m = storeCounts.get(emailKey)!;
        m.set(v.storeName, (m.get(v.storeName) || 0) + 1);
        if (v.storeCode) codeByStoreName.set(`${emailKey}|${v.storeName.toLowerCase().trim()}`, v.storeCode);
      }
    }

    // A BA's PRIMARY store = the one they visited most (deterministic tie-break
    // by name). This replaces the old "whichever visit row was processed last"
    // behaviour, which showed an arbitrary store.
    const primaryStore = new Map<string, { name: string; code: string }>();
    for (const [email, counts] of storeCounts) {
      let bestName = '';
      let bestCount = -1;
      for (const [name, c] of counts) {
        if (c > bestCount || (c === bestCount && name.localeCompare(bestName) < 0)) {
          bestCount = c;
          bestName = name;
        }
      }
      const code = codeByStoreName.get(`${email}|${bestName.toLowerCase().trim()}`) || '';
      primaryStore.set(email, { name: bestName, code });
    }

    // Explicit BA assignment overrides both the displayed store and the sales
    // attribution (e.g. a store that changed hands).
    const assignedStoreByEmail = new Map<string, string>();
    for (const s of storeMaster) {
      if (s.assignedBaEmail) {
        assignedStoreByEmail.set(s.assignedBaEmail.toLowerCase(), storeSalesKey(s) || s.storeName);
      }
    }

    // Display store per BA: assigned store wins, else most-visited store.
    const displayStore = new Map<string, string>();
    for (const [email, p] of primaryStore) displayStore.set(email, p.name);
    for (const [email, name] of assignedStoreByEmail) displayStore.set(email, name);

    // Resolve BA email → sales-data store name (for the sales lookup), going
    // through the Perigee→sales link first.
    const baDispoStore = new Map<string, string>();
    for (const [email, p] of primaryStore) {
      if (p.code) {
        const sn = codeToSalesName[p.code.toLowerCase().trim()];
        if (sn) { baDispoStore.set(email, sn); continue; }
      }
      const norm = p.name.toLowerCase().trim();
      if (norm && normToSalesName.has(norm)) { baDispoStore.set(email, normToSalesName.get(norm)!); continue; }
      if (p.name) baDispoStore.set(email, p.name);
    }
    for (const [email, name] of assignedStoreByEmail) baDispoStore.set(email, name);

    const baMap = new Map<string, LeaderboardEntry>();

    for (const month of months) {
      const scores = await loadScores(month);
      const [y, m] = month.split('-');
      const dispoMonthKey = `${m}-${y}`;

      for (const s of scores) {
        const key = s.email.toLowerCase();
        if (!baMap.has(key)) {
          baMap.set(key, { email: s.email, repName: s.repName, storeName: displayStore.get(key) || '', scores: {} });
        }
        const entry = baMap.get(key)!;
        if (s.repName) entry.repName = s.repName;

        const monthScore = buildMonthScore(s);

        // Sales = Makro DISPO value + Hirsch's value for the BA's store.
        let vol = 0, val = 0, hasSales = false;

        const dispoStoreName = baDispoStore.get(key);
        if (dispoStoreName) {
          const storeSales = dispoData.sales[dispoMonthKey]?.[dispoStoreName];
          if (storeSales) {
            hasSales = true;
            for (const [article, units] of Object.entries(storeSales)) {
              vol += units;
              const p = dispoData.prices[article];
              if (p) {
                const price = (p.promSP > 0 ? p.promSP : p.inclSP) / 1.15;
                val += units * price;
              }
            }
          }
        }

        // Hirsch's sales (direct Rand) for the BA's store branch.
        const branch = assignedBranchByEmail.get(key) || anyCodeToSalesCode.get(normalizeCode(primaryStore.get(key)?.code || ''));
        if (branch) {
          const hb = hirschData.sales[dispoMonthKey]?.[branch];
          if (hb) {
            for (const cell of Object.values(hb)) { vol += cell.qty; val += cell.val; hasSales = true; }
          }
        }

        if (hasSales) {
          monthScore.salesVol = vol;
          monthScore.salesVal = val;
        }

        entry.scores[month] = monthScore;
      }
    }

    const result = Array.from(baMap.values());
    return NextResponse.json(result, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('Leaderboard GET error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
