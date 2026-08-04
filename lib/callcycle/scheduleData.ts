import { readJson, writeJson } from '../blob';
import type { ScheduleRow, ParsedEntry, UploadResult, UnmatchedDuplicate } from './types';
import { buildStoreChannelResolver } from './storeChannelResolver';
import { loadTeamControl } from './controlData';

/**
 * Call cycle schedule persistence.
 *
 * NOTE (carried over from the iRAM build): no module-level in-memory cache.
 * Serverless has no shared memory across containers, so caching across requests
 * causes stale-read bugs.
 */

const BLOB_KEY = 'callcycle/schedule.json';

export async function loadSchedule(): Promise<ScheduleRow[]> {
  return readJson<ScheduleRow[]>(BLOB_KEY, []);
}

export async function saveSchedule(schedule: ScheduleRow[]): Promise<void> {
  await writeJson(BLOB_KEY, schedule);
}

/**
 * Load the schedule with each row's team leader joined on from the team control
 * file. `teamLeader` is deliberately never persisted — it always reflects the
 * latest team control upload rather than whatever was true at upload time.
 */
export async function loadScheduleWithTeamLeaders(): Promise<ScheduleRow[]> {
  const [schedule, teamControl] = await Promise.all([loadSchedule(), loadTeamControl()]);
  if (!teamControl) return schedule;

  const leaderByEmail = new Map<string, string>();
  for (const t of teamControl.teams) {
    const key = (t.memberEmail || '').toLowerCase();
    if (key && !leaderByEmail.has(key)) leaderByEmail.set(key, t.teamLeader || '');
  }

  return schedule.map(r => ({
    ...r,
    teamLeader: leaderByEmail.get((r.userEmail || '').toLowerCase()) || '',
  }));
}

export async function mergeIntoSchedule(
  entries: ParsedEntry[],
  uploadedBy: string,
  referenceStores: { storeCode: string; storeName: string; channel: string }[],
  options?: { ignoreErrorSites?: boolean },
): Promise<UploadResult> {
  const schedule = await loadSchedule();
  const now = new Date().toISOString();
  const warnings: string[] = [];
  let rowsAdded = 0;
  let rowsUpdated = 0;

  // Site code is the primary key; duplicate codes across channels are
  // disambiguated by store name so the right channel is recorded.
  const channelResolver = buildStoreChannelResolver(referenceStores);

  // True for an entry whose duplicate code could NOT be confidently matched to
  // a channel by name (e.g. a typo in the store name).
  const isErrorSite = (e: ParsedEntry) =>
    !!e.storeId && channelResolver.resolveDetailed(e.storeId, e.storeName).matchType === 'ambiguous';

  // Pre-pass: collect the unique list of error sites for reporting.
  const unmatchedMap = new Map<string, UnmatchedDuplicate>();
  for (const entry of entries) {
    if (!isErrorSite(entry)) continue;
    const res = channelResolver.resolveDetailed(entry.storeId, entry.storeName);
    const key = `${entry.storeId.toUpperCase()}|${entry.storeName.toLowerCase()}`;
    if (!unmatchedMap.has(key)) {
      unmatchedMap.set(key, {
        storeCode: entry.storeId,
        storeName: entry.storeName,
        candidateChannels: res.candidateChannels,
        assignedChannel: res.channel,
      });
    }
  }
  const unmatchedDuplicates = [...unmatchedMap.values()];

  // Error sites present and we're NOT told to ignore them → abort the whole
  // load (save nothing). The user must fix the file and reload.
  if (unmatchedDuplicates.length > 0 && !options?.ignoreErrorSites) {
    return {
      rowsAdded: 0,
      rowsUpdated: 0,
      totalRows: schedule.length,
      warnings: [...new Set(warnings)],
      unmatchedDuplicates,
      aborted: true,
    };
  }

  let skippedRows = 0;
  for (const entry of entries) {
    // Ignoring error sites: skip them but keep loading everything else.
    if (isErrorSite(entry)) { skippedRows++; continue; }

    const existingIdx = schedule.findIndex(r =>
      r.userEmail.toLowerCase() === entry.userEmail.toLowerCase() &&
      r.storeId.toUpperCase() === entry.storeId.toUpperCase() &&
      r.cycle === entry.cycle
    );

    const channel = channelResolver.resolve(entry.storeId, entry.storeName);
    if (!entry.storeId) {
      warnings.push(`No site ID found for "${entry.storeName}" — added with blank site ID`);
    } else if (!channel) {
      warnings.push(`Store ${entry.storeId} (${entry.storeName}) not found in reference data`);
    }

    if (existingIdx >= 0) {
      const existing = schedule[existingIdx];
      const daysChanged = JSON.stringify([...existing.days].sort()) !== JSON.stringify([...entry.days].sort());
      if (daysChanged || existing.storeName !== entry.storeName) {
        schedule[existingIdx] = {
          ...existing,
          firstName: entry.firstName,
          surname: entry.surname,
          storeName: entry.storeName,
          channel,
          days: entry.days,
          action: existing.action === 'ADD' ? 'ADD' : 'UPDATE',
          uploadedAt: now,
          uploadedBy,
        };
        rowsUpdated++;
      } else {
        schedule[existingIdx].action = 'LIVE';
        schedule[existingIdx].uploadedAt = now;
        if (channel) schedule[existingIdx].channel = channel;
      }
    } else {
      schedule.push({
        userEmail: entry.userEmail,
        firstName: entry.firstName,
        surname: entry.surname,
        storeId: entry.storeId,
        storeName: entry.storeName,
        channel,
        cycle: entry.cycle,
        days: entry.days,
        action: 'ADD',
        uploadedAt: now,
        uploadedBy,
      });
      rowsAdded++;
    }
  }

  // Backfill a channel onto any older row that never got one.
  if (referenceStores.length > 0) {
    for (const row of schedule) {
      if (!row.channel && row.storeId) {
        const ch = channelResolver.resolve(row.storeId, row.storeName);
        if (ch) row.channel = ch;
      }
    }
  }

  // teamLeader is a read-time join — never let it reach disk.
  await saveSchedule(schedule.map(stripTeamLeader));

  return {
    rowsAdded,
    rowsUpdated,
    totalRows: schedule.length,
    warnings: [...new Set(warnings)],
    unmatchedDuplicates,
    skippedRows,
  };
}

/** Drop the computed `teamLeader` so it is never persisted. */
function stripTeamLeader(row: ScheduleRow): ScheduleRow {
  const { teamLeader: _teamLeader, ...rest } = row;
  void _teamLeader;
  return rest as ScheduleRow;
}

export async function updateScheduleRow(index: number, row: ScheduleRow): Promise<ScheduleRow[]> {
  const schedule = await loadSchedule();
  if (index < 0 || index >= schedule.length) throw new Error('Invalid row index');
  schedule[index] = stripTeamLeader(row);
  await saveSchedule(schedule);
  return schedule;
}

export async function deleteScheduleRow(index: number): Promise<ScheduleRow[]> {
  const schedule = await loadSchedule();
  if (index < 0 || index >= schedule.length) throw new Error('Invalid row index');
  schedule.splice(index, 1);
  await saveSchedule(schedule);
  return schedule;
}

export async function clearSchedule(): Promise<void> {
  await saveSchedule([]);
}
