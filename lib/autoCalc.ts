/**
 * Core auto-calculation functions — extracted from API routes so they can
 * be called internally after data uploads (no HTTP round-trip needed).
 *
 * Each function returns an array of per-BA results.
 * `runAutoCalcForMonth()` runs all calcs, merges into existing scores, and saves.
 */

import { loadVisitIndex, loadVisitData } from './visitData';
import { loadScoringConfig } from './scoringConfig';
import { loadTargetData, getStoreTarget } from './targetData';
import { loadDispoData, calcSalesValue } from './dispoData';
import { loadHirschData } from './hirschData';
import { loadStores, buildCodeToSalesName, buildAssignmentByCode, storeSalesKey } from './storeData';
import { loadKPIControls } from './kpiControls';
import { countDisplayChecksForMonth } from './displayData';
import { countTrainingsForMonth } from './trainingData';
import { loadScores, saveScores, BAScore } from './scoreData';

// ── Check-in on Time (max 10 pts) ──

interface CheckInResult {
  email: string;
  repName: string;
  score: number;
}

export async function calcCheckInScores(month: string): Promise<CheckInResult[]> {
  const { lateCheckinTime, earlyCheckoutTime } = await loadScoringConfig();
  const index = await loadVisitIndex();
  const allVisits = [];
  for (const meta of index) {
    const visits = await loadVisitData(meta.id);
    allVisits.push(...visits);
  }

  const monthVisits = allVisits.filter(v => v.checkInDate?.substring(0, 7) === month);
  const baMap = new Map<string, { repName: string; total: number; onTime: number; earlyOut: number }>();

  for (const v of monthVisits) {
    const key = (v.email || '').toLowerCase();
    if (!key) continue;
    if (!baMap.has(key)) baMap.set(key, { repName: v.repName || v.email, total: 0, onTime: 0, earlyOut: 0 });
    const entry = baMap.get(key)!;
    if (v.repName) entry.repName = v.repName;
    entry.total++;
    if (v.checkInTime && v.checkInTime <= lateCheckinTime) entry.onTime++;
    if (v.checkOutTime && v.checkOutTime < earlyCheckoutTime) entry.earlyOut++;
  }

  return Array.from(baMap.entries()).map(([email, d]) => {
    const onTimePts = d.total > 0 ? Math.round((d.onTime / d.total) * 10) : 0;
    const earlyOutPts = d.total > 0 ? Math.round((d.earlyOut / d.total) * 10) : 0;
    return { email, repName: d.repName, score: Math.max(0, onTimePts - earlyOutPts) };
  });
}

// ── Sales vs Target (max 40 pts) ──

interface SalesResult {
  email: string;
  repName: string;
  points: number;
  variance: number;
}

function toDispoMonth(yyyyMm: string): string {
  const [yyyy, mm] = yyyyMm.split('-');
  return `${mm}-${yyyy}`;
}

/** Previous YYYY-MM for a given YYYY-MM. */
function prevYyyyMm(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Build an UPPER store-name → products lookup for a DISPO month. */
function normSalesForMonth(dispoData: Awaited<ReturnType<typeof loadDispoData>>, dispoMonth: string): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [key, products] of Object.entries(dispoData.sales[dispoMonth] || {})) {
    out[key.trim().toUpperCase()] = products;
  }
  return out;
}

export async function calcSalesScores(month: string): Promise<SalesResult[]> {
  const dispoMonth = toDispoMonth(month);
  const prevMonth = prevYyyyMm(month);
  const prevDispoMonth = toDispoMonth(prevMonth);
  const [targetData, dispoData, stores, visitIndex, kpiControls, hirschData] = await Promise.all([
    loadTargetData(), loadDispoData(), loadStores(), loadVisitIndex(), loadKPIControls(), loadHirschData(),
  ]);

  const salesThreshold = kpiControls.salesThresholdPct ?? 80;
  // Any store code → the store's sales-data NAME (Makro DISPO lookup key).
  const siteCodeToName = buildCodeToSalesName(stores, 'upper');
  // Any store code → the store's sales CODE (used for Hirsch branch lookup).
  const anyCodeToSalesCode = new Map<string, string>();
  for (const s of stores) {
    if (!s.salesCode) continue;
    for (const code of [s.perigeeCode, s.salesCode, s.siteCode]) {
      const k = (code || '').trim().toUpperCase();
      if (k && !anyCodeToSalesCode.has(k)) anyCodeToSalesCode.set(k, s.salesCode);
    }
  }
  // All branch codes Hirsch has any sales for (so we don't treat a Makro sales
  // code as a Hirsch branch).
  const hirschBranchSet = new Set<string>();
  for (const monthData of Object.values(hirschData.sales)) {
    for (const branch of Object.keys(monthData)) hirschBranchSet.add(branch);
  }

  // Explicit store→BA assignments, keyed by every code so a visit (Perigee code)
  // is correctly skipped when a store is assigned away.
  const assignedByCode = buildAssignmentByCode(stores, 'upper');

  const baStores = new Map<string, { repName: string; stores: Map<string, string>; hirschBranches: Set<string> }>();
  const ensure = (email: string, repName: string) => {
    if (!baStores.has(email)) baStores.set(email, { repName, stores: new Map(), hirschBranches: new Set() });
    return baStores.get(email)!;
  };

  for (const upload of visitIndex) {
    const visits = await loadVisitData(upload.id);
    for (const v of visits) {
      if (!v.checkInDate || !v.email || !v.checkInDate.startsWith(month)) continue;
      const email = v.email.toLowerCase();
      const entry = ensure(email, v.repName || v.email);
      if (v.storeCode) {
        const code = v.storeCode.trim().toUpperCase();
        // Skip stores explicitly assigned to another BA.
        if (!assignedByCode.has(code)) {
          const storeName = siteCodeToName[code];
          if (storeName) entry.stores.set(code, storeName);
          const branch = anyCodeToSalesCode.get(code);
          if (branch && hirschBranchSet.has(branch)) entry.hirschBranches.add(branch);
        }
      }
      if (v.repName) entry.repName = v.repName;
    }
  }

  // Attribute each explicitly-assigned store to its assigned BA (once).
  for (const s of stores) {
    if (!s.assignedBaEmail) continue;
    const salesName = storeSalesKey(s);
    const email = s.assignedBaEmail.toLowerCase();
    const entry = ensure(email, s.assignedBaName || s.assignedBaEmail);
    entry.repName = s.assignedBaName || s.assignedBaEmail;
    const targetCode = (s.siteCode || s.salesCode || s.perigeeCode || '').trim().toUpperCase();
    if (salesName) entry.stores.set(targetCode, salesName);
    if (s.salesCode && hirschBranchSet.has(s.salesCode)) entry.hirschBranches.add(s.salesCode);
  }

  const normNow = normSalesForMonth(dispoData, dispoMonth);
  const normPrev = normSalesForMonth(dispoData, prevDispoMonth);

  // Makro value for a store name in a given normalized-month lookup.
  const makroVal = (norm: Record<string, Record<string, number>>, storeName: string): number => {
    const products = norm[storeName.trim().toUpperCase()];
    if (!products) return 0;
    let v = 0;
    for (const [article, units] of Object.entries(products)) v += calcSalesValue(units, dispoData.prices[article]);
    return v;
  };
  // Hirsch value for a set of branches in a given month key.
  const hirschVal = (monthKey: string, branches: Set<string>): number => {
    const m = hirschData.sales[monthKey];
    if (!m) return 0;
    let v = 0;
    for (const b of branches) {
      const cell = m[b];
      if (cell) for (const c of Object.values(cell)) v += c.val;
    }
    return v;
  };

  const results: SalesResult[] = [];
  for (const [email, { repName, stores: baStoreMap, hirschBranches }] of baStores) {
    // Targeted (Makro stores that have a loaded target) — scored vs target.
    let totalValueTarget = 0;
    let targetedActual = 0;
    for (const [siteCode, storeName] of baStoreMap) {
      const target = getStoreTarget(targetData.targets, dispoMonth, siteCode);
      if (!target) continue;
      totalValueTarget += target.valueTarget;
      targetedActual += makroVal(normNow, storeName);
    }

    let variance: number;
    if (totalValueTarget > 0) {
      variance = (targetedActual / totalValueTarget) * 100;
    } else {
      // No targets → score vs the previous month's actual (Makro + Hirsch).
      let actualNow = hirschVal(dispoMonth, hirschBranches);
      let actualPrev = hirschVal(prevDispoMonth, hirschBranches);
      for (const storeName of baStoreMap.values()) {
        actualNow += makroVal(normNow, storeName);
        actualPrev += makroVal(normPrev, storeName);
      }
      variance = actualPrev > 0 ? (actualNow / actualPrev) * 100 : 0;
    }

    const points = variance < salesThreshold ? 0 : Math.min(40, Math.round((variance / 100) * 40));
    results.push({ email, repName, variance: Math.round(variance * 10) / 10, points });
  }

  return results;
}

// ── Display Inspection auto (max 5 pts) ──

interface DisplayResult {
  email: string;
  repName: string;
  autoPoints: number;
}

export async function calcDisplayScores(month: string): Promise<DisplayResult[]> {
  const { minDisplayChecksPerMonth } = await loadKPIControls();
  const counts = await countDisplayChecksForMonth(month);
  return Array.from(counts.entries()).map(([email, data]) => ({
    email,
    repName: data.repName,
    autoPoints: Math.min(5, Math.round((data.visitCount / minDisplayChecksPerMonth) * 5)),
  }));
}

// ── Training auto (max 5 pts) ──

interface TrainingResult {
  email: string;
  repName: string;
  autoPoints: number;
}

export async function calcTrainingScores(month: string): Promise<TrainingResult[]> {
  const { minTrainingsPerMonth } = await loadKPIControls();
  const counts = await countTrainingsForMonth(month);
  return Array.from(counts.entries()).map(([email, data]) => ({
    email,
    repName: data.repName,
    autoPoints: Math.min(5, Math.round((data.count / minTrainingsPerMonth) * 5)),
  }));
}

// ── Run all auto-calcs for a month and save ──

export async function runAutoCalcForMonth(
  month: string,
  types: ('checkin' | 'sales' | 'display' | 'training')[] = ['checkin', 'sales', 'display', 'training'],
): Promise<{ month: string; updated: number }> {
  // Load existing scores
  const existing = await loadScores(month);
  const scoreMap = new Map<string, BAScore>();
  for (const s of existing) {
    scoreMap.set(s.email.toLowerCase(), s);
  }

  // Helper to get or create a score entry
  function getOrCreate(email: string, repName: string): BAScore {
    const key = email.toLowerCase();
    if (!scoreMap.has(key)) {
      scoreMap.set(key, {
        email: key, repName, month,
        monthlySales: 0, dailySales: 0, checkInOnTime: 0,
        feedback: 0, feedbackAuto: 0, displayInspection: 0,
        weeklySummaries: 0, training: 0, trainingAuto: 0,
        displayAuto: 0, bonusSuggestions: 0,
        updatedAt: '', updatedBy: '',
      });
    }
    return scoreMap.get(key)!;
  }

  const now = new Date().toISOString();

  if (types.includes('checkin')) {
    try {
      const results = await calcCheckInScores(month);
      for (const r of results) {
        const s = getOrCreate(r.email, r.repName);
        s.checkInOnTime = r.score;
        s.updatedAt = now;
        s.updatedBy = 'auto-calc';
      }
    } catch (err) {
      console.error(`Auto-calc checkin failed for ${month}:`, err);
    }
  }

  if (types.includes('sales')) {
    try {
      const results = await calcSalesScores(month);
      for (const r of results) {
        const s = getOrCreate(r.email, r.repName);
        s.monthlySales = r.points;
        s.salesVariance = r.variance;
        s.updatedAt = now;
        s.updatedBy = 'auto-calc';
      }
    } catch (err) {
      console.error(`Auto-calc sales failed for ${month}:`, err);
    }
  }

  if (types.includes('display')) {
    try {
      const results = await calcDisplayScores(month);
      for (const r of results) {
        const s = getOrCreate(r.email, r.repName);
        const manualPart = Math.max(0, (s.displayInspection || 0) - (s.displayAuto || 0));
        s.displayAuto = r.autoPoints;
        s.displayInspection = Math.min(20, r.autoPoints + manualPart);
        s.updatedAt = now;
        s.updatedBy = 'auto-calc';
      }
    } catch (err) {
      console.error(`Auto-calc display failed for ${month}:`, err);
    }
  }

  if (types.includes('training')) {
    try {
      const results = await calcTrainingScores(month);
      for (const r of results) {
        const s = getOrCreate(r.email, r.repName);
        const manualPart = Math.max(0, (s.training || 0) - (s.trainingAuto || 0));
        s.trainingAuto = r.autoPoints;
        s.training = Math.min(20, r.autoPoints + manualPart);
        s.updatedAt = now;
        s.updatedBy = 'auto-calc';
      }
    } catch (err) {
      console.error(`Auto-calc training failed for ${month}:`, err);
    }
  }

  const allScores = Array.from(scoreMap.values());
  await saveScores(month, allScores);

  return { month, updated: allScores.length };
}
