import { NextRequest, NextResponse } from 'next/server';
import { readJson, writeJson } from '@/lib/blob';
import { Visit, loadVisitIndex, saveVisitIndex, saveVisitData, loadVisitData, visitDedupeKey } from '@/lib/visitData';
import { seedScoresFromVisits } from '@/lib/seedScores';
import { requireRole } from '@/lib/auth';
import { logActivity } from '@/lib/activityLog';
import { runAutoCalcForMonth } from '@/lib/autoCalc';
import { loadPerigeeConfig, savePerigeeConfig, activeTokens, fetchAllVisits, mapPerigeeVisit } from '@/lib/perigee';
import { syncVisitedStores } from '@/lib/storeData';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface PollSlot {
  id: string;
  time: string;
  type: 'short' | 'long';
  enabled: boolean;
}

interface PollSchedule {
  slots: PollSlot[];
  timezone: string;
}

interface CronLogEntry {
  timestamp: string;
  matched: boolean;
  slotTime?: string;
  slotType?: string;
  result?: string;
  imported?: number;
  skipped?: number;
  error?: string;
}

const SCHEDULE_KEY = 'config/perigee-schedule.json';
const CRON_LOG_KEY = 'logs/cron-poll.json';

export async function GET(req: NextRequest) {
  // Validate cron secret OR super_admin session
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const isCronAuth = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  const isAdminAuth = !!(await requireRole(req, ['super_admin']));
  if (!isCronAuth && !isAdminAuth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const logEntry: CronLogEntry = { timestamp: new Date().toISOString(), matched: false };
  const forceRun = req.nextUrl.searchParams.get('force') === 'true';

  try {
    // Load schedule
    const schedule = await readJson<PollSchedule>(SCHEDULE_KEY, { slots: [], timezone: 'Africa/Johannesburg' });

    if (schedule.slots.length === 0 && !forceRun) {
      logEntry.result = 'No slots configured';
      await appendCronLog(logEntry);
      return NextResponse.json({ ok: true, action: 'none', reason: 'No slots configured' });
    }

    // Get current SAST time
    const now = new Date();
    const sastTime = new Date(now.toLocaleString('en-US', { timeZone: schedule.timezone || 'Africa/Johannesburg' }));
    const currentHour = sastTime.getHours();
    const currentMin = sastTime.getMinutes();
    const currentMins = currentHour * 60 + currentMin;

    // Find matching slot (within 15-minute window) — skip if forced
    let matchedSlot: PollSlot | undefined;
    if (forceRun) {
      const firstEnabled = schedule.slots.find(s => s.enabled);
      matchedSlot = {
        id: 'manual',
        time: `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`,
        type: firstEnabled?.type || 'short',
        enabled: true,
      };
    } else {
      matchedSlot = schedule.slots.find(slot => {
        if (!slot.enabled) return false;
        const [slotH, slotM] = slot.time.split(':').map(Number);
        const slotMins = slotH * 60 + slotM;
        const diff = Math.abs(currentMins - slotMins);
        return diff <= 14;
      });
    }

    if (!matchedSlot) {
      logEntry.result = `No matching slot at ${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')} SAST`;
      await appendCronLog(logEntry);
      return NextResponse.json({ ok: true, action: 'none', reason: logEntry.result });
    }

    logEntry.matched = true;
    logEntry.slotTime = matchedSlot.time;
    logEntry.slotType = matchedSlot.type;

    // Load Perigee config (multi-token)
    const config = await loadPerigeeConfig();
    if (!config.endpoint || activeTokens(config).length === 0) {
      logEntry.error = 'Perigee API not configured (no endpoint or active tokens)';
      await appendCronLog(logEntry);
      return NextResponse.json({ ok: false, error: 'Not configured' }, { status: 400 });
    }

    // Build request body
    const today = now.toISOString().slice(0, 10);
    let startDate: string;
    if (matchedSlot.type === 'long') {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      startDate = sevenDaysAgo.toISOString().slice(0, 10);
    } else {
      startDate = today;
    }

    // Parse the saved request body template, override dates
    let perigeeBody: Record<string, unknown> = {};
    if (config.requestBody) {
      try { perigeeBody = JSON.parse(config.requestBody); } catch { /* use empty */ }
    }
    perigeeBody.startDate = startDate;
    perigeeBody.endDate = today;

    // Call Perigee once per active token and merge the rows
    const { rawVisits, perToken } = await fetchAllVisits(config, perigeeBody);
    const anyOk = perToken.some(t => t.ok);
    const failedSummary = perToken.filter(t => !t.ok).map(t => `${t.label}: ${t.error}`).join('; ');

    if (!anyOk) {
      logEntry.error = `All tokens failed — ${failedSummary}`.slice(0, 200);
      await appendCronLog(logEntry);
      return NextResponse.json({ ok: false, error: logEntry.error }, { status: 502 });
    }

    // Update lastPolledAt
    await savePerigeeConfig({ ...config, lastPolledAt: new Date().toISOString() });

    if (rawVisits.length === 0) {
      logEntry.result = failedSummary ? `No visits (partial: ${failedSummary})` : 'No visits returned';
      logEntry.imported = 0;
      await appendCronLog(logEntry);
      return NextResponse.json({ ok: true, action: 'polled', imported: 0 });
    }

    // Map and deduplicate
    const mappedVisits: Visit[] = rawVisits.map(mapPerigeeVisit).filter(v => v.storeName || v.repName);

    // Deduplicate within this batch (Perigee returns same GUID 2+ times; also de-overlaps across tokens)
    const batchSeen = new Set<string>();
    const visits: Visit[] = [];
    for (const v of mappedVisits) {
      const key = visitDedupeKey(v);
      if (batchSeen.has(key)) continue;
      batchSeen.add(key);
      visits.push(v);
    }

    // Build dedup set from all existing visits (by visitId AND composite key)
    const index = await loadVisitIndex();
    const existingKeys = new Set<string>();
    for (const meta of index) {
      const existingVisits = await loadVisitData(meta.id);
      for (const ev of existingVisits) existingKeys.add(visitDedupeKey(ev));
    }

    const newVisits = visits.filter(v => !existingKeys.has(visitDedupeKey(v)));
    const skipped = mappedVisits.length - newVisits.length;

    if (newVisits.length === 0) {
      logEntry.result = failedSummary ? `All duplicates (partial: ${failedSummary})` : 'All duplicates';
      logEntry.imported = 0;
      logEntry.skipped = skipped;
      await appendCronLog(logEntry);
      return NextResponse.json({ ok: true, action: 'polled', imported: 0, skipped });
    }

    // Save
    const uploadId = crypto.randomUUID();
    await saveVisitData(uploadId, newVisits);
    index.unshift({
      id: uploadId,
      fileName: `cron-${matchedSlot.type}-${startDate}.json`,
      uploadedAt: new Date().toISOString(),
      uploadedBy: `Cron (${matchedSlot.time} ${matchedSlot.type})`,
      rowCount: newVisits.length,
    });
    await saveVisitIndex(index);

    // Keep the store master in sync with newly-visited stores.
    try { await syncVisitedStores(newVisits); } catch (e) { console.error('syncVisitedStores failed:', e); }

    // Auto-seed scores
    await seedScoresFromVisits('Cron (auto-seed)');

    // Auto-recalculate check-in + sales scores for affected months
    const affectedMonths = new Set(newVisits.map(v => v.checkInDate?.substring(0, 7)).filter(Boolean));
    for (const m of affectedMonths) {
      try { await runAutoCalcForMonth(m as string, ['checkin', 'sales']); } catch { /* logged internally */ }
    }

    logEntry.result = failedSummary ? `Success (partial: ${failedSummary})` : 'Success';
    logEntry.imported = newVisits.length;
    logEntry.skipped = skipped;
    await appendCronLog(logEntry);

    logActivity('cron_import', `Cron (${matchedSlot.time} ${matchedSlot.type})`, 'System', `visits/${uploadId}`, `Cron imported ${newVisits.length} visits (${skipped} skipped)`, { imported: newVisits.length, skipped }).catch(() => {});
    return NextResponse.json({
      ok: true,
      action: 'imported',
      imported: newVisits.length,
      skipped,
      uploadId,
    });
  } catch (err) {
    logEntry.error = err instanceof Error ? err.message : 'Unknown error';
    await appendCronLog(logEntry).catch(() => {});
    console.error('Cron poll error:', err);
    return NextResponse.json({ ok: false, error: logEntry.error }, { status: 500 });
  }
}

async function appendCronLog(entry: CronLogEntry) {
  try {
    const logs = await readJson<CronLogEntry[]>(CRON_LOG_KEY, []);
    logs.unshift(entry);
    await writeJson(CRON_LOG_KEY, logs.slice(0, 100));
  } catch {
    // Non-blocking — logging should never crash the cron
  }
}
