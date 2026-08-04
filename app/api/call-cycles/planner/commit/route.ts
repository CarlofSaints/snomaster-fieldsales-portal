import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { parseSnoMasterPlanner, deriveCycles, cycleToEntryGroups } from '@/lib/callcycle/parsers/snomasterPlanner';
import { validatePlanner } from '@/lib/callcycle/parsers/plannerValidation';
import { loadSchedule, saveSchedule } from '@/lib/callcycle/scheduleData';
import { loadReferences } from '@/lib/callcycle/referenceData';
import { loadTeamControl } from '@/lib/callcycle/controlData';
import { buildStoreChannelResolver } from '@/lib/callcycle/storeChannelResolver';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import { logActivity } from '@/lib/activityLog';
import type { ScheduleRow } from '@/lib/callcycle/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

interface SheetDecision {
  sheetName: string;
  /** Perigee email this planner belongs to. Required. */
  userEmail: string;
  firstName?: string;
  surname?: string;
  /** Fill keys the user confirmed mean "in store". */
  visitFills: string[];
  /** rowNumber -> chosen store code. Rows left out are skipped. */
  storeCodes: Record<string, string>;
}

/**
 * Step 2: write the reviewed planner into the schedule.
 *
 * Monthly semantics — Carl's reps re-send their planner every month, so a
 * commit REPLACES everything already held for that rep rather than merging.
 * Merging would silently accumulate last month's stores forever, and a store
 * dropped from this month's plan would never disappear.
 */
export async function POST(req: NextRequest) {
  const actor = await requireRole(req, ['super_admin', 'admin']);
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noCacheHeaders() });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const decisionsRaw = formData.get('decisions') as string | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    if (!decisionsRaw) return NextResponse.json({ error: 'No review decisions supplied' }, { status: 400 });

    const decisions: SheetDecision[] = JSON.parse(decisionsRaw);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const { sheets } = parseSnoMasterPlanner(workbook, file.name);

    // Re-validate server-side. The review screen already showed these, but the
    // gate has to live here too — otherwise a crafted request bypasses it.
    const validation = validatePlanner(sheets);
    if (validation.blocked) {
      return NextResponse.json({
        error: 'This planner still has blocking errors. Fix the file and reload it.',
        issues: validation.issues,
      }, { status: 400 });
    }

    const references = await loadReferences();
    const teamControl = await loadTeamControl();
    const channelResolver = buildStoreChannelResolver(references.stores);
    const storeByCode = new Map(
      references.stores.map(s => [s.storeCode.trim().toUpperCase(), s]),
    );

    const schedule = await loadSchedule();
    const now = new Date().toISOString();
    const warnings: string[] = [];

    let rowsWritten = 0;
    let storesWritten = 0;
    let rowsReplaced = 0;
    const repsTouched: string[] = [];

    for (const decision of decisions) {
      const sheet = sheets.find(s => s.sheetName === decision.sheetName);
      if (!sheet) {
        warnings.push(`Sheet "${decision.sheetName}" was not found in the uploaded file — skipped.`);
        continue;
      }
      const email = (decision.userEmail || '').trim().toLowerCase();
      if (!email) {
        warnings.push(`Sheet "${decision.sheetName}" has no rep selected — skipped.`);
        continue;
      }

      const member = teamControl?.teams.find(t => t.memberEmail.toLowerCase() === email);
      const cycles = deriveCycles(sheet, decision.visitFills || []);

      const newRows: ScheduleRow[] = [];
      for (const cycle of cycles) {
        const chosenCode = (decision.storeCodes?.[String(cycle.rowNumber)] || '').trim();
        if (!chosenCode) {
          warnings.push(`"${cycle.storeName}" (${sheet.sheetName} row ${cycle.rowNumber}) has no store selected — skipped.`);
          continue;
        }
        const ref = storeByCode.get(chosenCode.toUpperCase());
        const storeName = ref?.storeName || cycle.storeName;
        const channel = channelResolver.resolve(chosenCode, storeName) || ref?.channel || '';

        // One row per distinct week/day pattern — see cycleToEntryGroups.
        for (const group of cycleToEntryGroups(cycle)) {
          newRows.push({
            userEmail: email,
            firstName: decision.firstName || sheet.repName || '',
            surname: decision.surname || '',
            storeId: chosenCode,
            storeName,
            channel,
            cycle: group.cycle,
            days: group.days,
            action: 'ADD',
            uploadedAt: now,
            uploadedBy: actor.email,
          });
        }
        storesWritten++;
      }

      // Replace this rep's whole schedule with the new month.
      const before = schedule.length;
      for (let i = schedule.length - 1; i >= 0; i--) {
        if (schedule[i].userEmail.toLowerCase() === email) schedule.splice(i, 1);
      }
      rowsReplaced += before - schedule.length;
      schedule.push(...newRows);
      rowsWritten += newRows.length;
      repsTouched.push(member?.memberEmail || email);
    }

    if (rowsWritten === 0) {
      return NextResponse.json({
        error: 'Nothing was written — no store rows survived the review. Check the colour choices and the store matches.',
        warnings,
      }, { status: 400 });
    }

    await saveSchedule(schedule);

    await logActivity(
      'callcycle_upload',
      actor.email,
      `${actor.name} ${actor.surname}`.trim(),
      'call-cycles/planner',
      `Loaded planner "${file.name}" for ${repsTouched.join(', ')}: ${storesWritten} stores, ${rowsWritten} rows (replaced ${rowsReplaced})`,
      { filename: file.name, reps: repsTouched },
    );

    return NextResponse.json({
      ok: true,
      rowsWritten,
      storesWritten,
      rowsReplaced,
      totalRows: schedule.length,
      reps: repsTouched,
      warnings,
    }, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('[call-cycles/planner/commit] Error:', err);
    return NextResponse.json({ error: 'Failed to save the planner', detail: String(err) }, { status: 500 });
  }
}
