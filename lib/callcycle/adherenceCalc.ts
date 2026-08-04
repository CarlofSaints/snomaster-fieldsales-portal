import { ScheduleRow } from './types';

// ---------- Types ----------

/**
 * The only three fields adherence needs from a visit. Kept as a local shape so
 * this stays decoupled from SnoMaster's much wider `Visit` type — callers map
 * their visits into it (see app/api/call-cycles/adherence/route.ts), which is
 * also where the check-in date gets normalised to YYYY-MM-DD.
 */
export interface AdherenceVisit {
  repEmail: string;
  storeCode: string;
  checkInDate: string; // YYYY-MM-DD
}

export interface AdherenceMetrics {
  expectedVisits: number;
  accurateHits: number;
  accurateHitRate: number; // 0-100
  scheduledStores: number;
  visitedStores: number;
  storesVisitedPct: number; // 0-100
  missedStores: number;
  missedPct: number; // 0-100
  totalVisits: number;
  unscheduledVisits: number;
  unscheduledPct: number; // 0-100
}

export interface UserAdherence extends AdherenceMetrics {
  email: string;
  name: string;
  teamLeader: string;
}

export interface AdherenceData {
  totals: AdherenceMetrics;
  byUser: Record<string, UserAdherence>;
  byTeamLeader: Record<string, AdherenceMetrics>;
  byChannel: Record<string, AdherenceMetrics>;
}

// ---------- Constants ----------

const DAY_MAP: Record<string, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 0,
};

// ---------- Shared Helpers ----------

/**
 * Parse cycle string "Week 1&3" → [1, 3], "Week 2&4" → [2, 4], etc.
 * Extracted from dashboard/page.tsx:33 to become shared.
 */
export function parseCycleWeeks(cycle: string): number[] {
  if (!cycle) return [];
  const nums = cycle.match(/\d+/g);
  return nums ? nums.map(Number).filter(n => n >= 1 && n <= 6).sort((a, b) => a - b) : [];
}

/**
 * Find the Nth occurrence of a weekday in a given month.
 * n is 1-based (1st Monday, 2nd Tuesday, etc.)
 * Returns null if the month doesn't have that many occurrences.
 */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date | null {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();

  // Find first occurrence of weekday in this month
  let dayOfMonth = 1 + ((weekday - firstDay.getDay() + 7) % 7);

  // Advance to Nth occurrence
  dayOfMonth += (n - 1) * 7;

  if (dayOfMonth > lastDay) return null;
  return new Date(year, month, dayOfMonth);
}

/**
 * Generate all expected visit dates for one schedule row within a date range.
 * Uses cycle weeks + days to compute specific dates.
 */
export function generateExpectedDates(
  cycle: string,
  days: string[],
  dateFrom: Date,
  dateTo: Date
): string[] {
  const weeks = parseCycleWeeks(cycle);
  if (weeks.length === 0 || days.length === 0) return [];

  // Cap dateTo at today to avoid penalizing reps for future visits
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const effectiveTo = dateTo > today ? today : dateTo;

  const dates: string[] = [];

  // Iterate months in range
  let year = dateFrom.getFullYear();
  let month = dateFrom.getMonth();
  const toYear = effectiveTo.getFullYear();
  const toMonth = effectiveTo.getMonth();

  while (year < toYear || (year === toYear && month <= toMonth)) {
    for (const wk of weeks) {
      for (const dayName of days) {
        const weekday = DAY_MAP[dayName];
        if (weekday === undefined) continue;

        const d = nthWeekdayOfMonth(year, month, weekday, wk);
        if (d && d >= dateFrom && d <= effectiveTo) {
          dates.push(formatDate(d));
        }
      }
    }
    month++;
    if (month > 11) { month = 0; year++; }
  }

  return dates;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------- Main Computation ----------

function emptyMetrics(): AdherenceMetrics {
  return {
    expectedVisits: 0,
    accurateHits: 0,
    accurateHitRate: 0,
    scheduledStores: 0,
    visitedStores: 0,
    storesVisitedPct: 0,
    missedStores: 0,
    missedPct: 0,
    totalVisits: 0,
    unscheduledVisits: 0,
    unscheduledPct: 0,
  };
}

function calcRates(m: AdherenceMetrics): void {
  m.accurateHitRate = m.expectedVisits > 0 ? Math.round((m.accurateHits / m.expectedVisits) * 100) : 0;
  m.storesVisitedPct = m.scheduledStores > 0 ? Math.round((m.visitedStores / m.scheduledStores) * 100) : 0;
  m.missedPct = m.scheduledStores > 0 ? Math.round((m.missedStores / m.scheduledStores) * 100) : 0;
  m.unscheduledPct = m.totalVisits > 0 ? Math.round((m.unscheduledVisits / m.totalVisits) * 100) : 0;
}

export function computeAdherence(
  schedule: ScheduleRow[],
  visits: AdherenceVisit[],
  dateFrom: Date,
  dateTo: Date
): AdherenceData {
  const fromStr = formatDate(dateFrom);
  const toStr = formatDate(dateTo);

  // Filter visits to date range
  const rangeVisits = visits.filter(v => v.checkInDate >= fromStr && v.checkInDate <= toStr);

  // Build visit lookup: repEmail|storeCode|date → boolean (for accurate hit detection)
  const visitKey = (email: string, storeCode: string, date: string) =>
    `${email.toLowerCase()}|${storeCode.toUpperCase()}|${date}`;
  const visitSet = new Set(rangeVisits.map(v => visitKey(v.repEmail, v.storeCode, v.checkInDate)));

  // Build store visit lookup: repEmail|storeCode → boolean (store visited at least once)
  const storeVisitKey = (email: string, storeCode: string) =>
    `${email.toLowerCase()}|${storeCode.toUpperCase()}`;
  const storeVisitSet = new Set(rangeVisits.map(v => storeVisitKey(v.repEmail, v.storeCode)));

  // Build set of scheduled store keys for unscheduled detection
  const scheduledStoreKeys = new Set(
    schedule.map(s => storeVisitKey(s.userEmail, s.storeId))
  );

  // Initialize accumulators
  const byUser: Record<string, UserAdherence> = {};
  const byTeamLeader: Record<string, AdherenceMetrics> = {};
  const byChannel: Record<string, AdherenceMetrics> = {};
  const totals = emptyMetrics();

  // Process each schedule row
  for (const row of schedule) {
    if (!row.userEmail || !row.storeId || row.days.length === 0) continue;

    const expectedDates = generateExpectedDates(row.cycle, row.days, dateFrom, dateTo);
    const email = row.userEmail.toLowerCase();
    const tl = row.teamLeader || 'Unassigned';
    const channel = row.channel || 'Unknown';

    // Init user accumulator
    if (!byUser[email]) {
      byUser[email] = {
        ...emptyMetrics(),
        email,
        name: `${row.firstName} ${row.surname}`.trim(),
        teamLeader: tl,
      };
    }

    // Init team leader accumulator
    if (!byTeamLeader[tl]) byTeamLeader[tl] = emptyMetrics();

    // Init channel accumulator
    if (!byChannel[channel]) byChannel[channel] = emptyMetrics();

    // Count accurate hits (visits on exact expected date)
    let hits = 0;
    for (const date of expectedDates) {
      if (visitSet.has(visitKey(row.userEmail, row.storeId, date))) {
        hits++;
      }
    }

    // Was this store visited at all in the range?
    const wasVisited = storeVisitSet.has(storeVisitKey(row.userEmail, row.storeId));

    // Accumulate per user
    byUser[email].expectedVisits += expectedDates.length;
    byUser[email].accurateHits += hits;
    byUser[email].scheduledStores += 1;
    byUser[email].visitedStores += wasVisited ? 1 : 0;
    byUser[email].missedStores += wasVisited ? 0 : 1;

    // Accumulate per team leader
    byTeamLeader[tl].expectedVisits += expectedDates.length;
    byTeamLeader[tl].accurateHits += hits;
    byTeamLeader[tl].scheduledStores += 1;
    byTeamLeader[tl].visitedStores += wasVisited ? 1 : 0;
    byTeamLeader[tl].missedStores += wasVisited ? 0 : 1;

    // Accumulate per channel
    byChannel[channel].expectedVisits += expectedDates.length;
    byChannel[channel].accurateHits += hits;
    byChannel[channel].scheduledStores += 1;
    byChannel[channel].visitedStores += wasVisited ? 1 : 0;
    byChannel[channel].missedStores += wasVisited ? 0 : 1;

    // Accumulate totals
    totals.expectedVisits += expectedDates.length;
    totals.accurateHits += hits;
    totals.scheduledStores += 1;
    totals.visitedStores += wasVisited ? 1 : 0;
    totals.missedStores += wasVisited ? 0 : 1;
  }

  // Count total visits and unscheduled visits
  totals.totalVisits = rangeVisits.length;
  totals.unscheduledVisits = rangeVisits.filter(
    v => !scheduledStoreKeys.has(storeVisitKey(v.repEmail, v.storeCode))
  ).length;

  // Per-user total visits & unscheduled
  for (const v of rangeVisits) {
    const email = v.repEmail.toLowerCase();
    if (byUser[email]) {
      byUser[email].totalVisits++;
      if (!scheduledStoreKeys.has(storeVisitKey(v.repEmail, v.storeCode))) {
        byUser[email].unscheduledVisits++;
      }
    }
  }

  // Per-team-leader total visits & unscheduled
  // Build repEmail → teamLeader map from schedule
  const emailToTL = new Map<string, string>();
  for (const row of schedule) {
    if (row.userEmail && row.teamLeader) {
      emailToTL.set(row.userEmail.toLowerCase(), row.teamLeader);
    }
  }

  for (const v of rangeVisits) {
    const tl = emailToTL.get(v.repEmail.toLowerCase()) || 'Unassigned';
    if (byTeamLeader[tl]) {
      byTeamLeader[tl].totalVisits++;
      if (!scheduledStoreKeys.has(storeVisitKey(v.repEmail, v.storeCode))) {
        byTeamLeader[tl].unscheduledVisits++;
      }
    }
  }

  // Per-channel total visits & unscheduled
  // Build storeCode → channel map from schedule
  const storeToChannel = new Map<string, string>();
  for (const row of schedule) {
    if (row.storeId && row.channel) {
      storeToChannel.set(row.storeId.toUpperCase(), row.channel);
    }
  }

  for (const v of rangeVisits) {
    const ch = storeToChannel.get(v.storeCode.toUpperCase()) || 'Unknown';
    if (byChannel[ch]) {
      byChannel[ch].totalVisits++;
      if (!scheduledStoreKeys.has(storeVisitKey(v.repEmail, v.storeCode))) {
        byChannel[ch].unscheduledVisits++;
      }
    }
  }

  // Calculate rates for all accumulators
  calcRates(totals);
  for (const u of Object.values(byUser)) calcRates(u);
  for (const t of Object.values(byTeamLeader)) calcRates(t);
  for (const c of Object.values(byChannel)) calcRates(c);

  return { totals, byUser, byTeamLeader, byChannel };
}
