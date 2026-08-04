import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import {
  parseSnoMasterPlanner, deriveCycles, cycleToEntryGroups, repNameFromFilename,
} from '@/lib/callcycle/parsers/snomasterPlanner';
import { validatePlanner } from '@/lib/callcycle/parsers/plannerValidation';
import { buildStoreMatcher } from '@/lib/callcycle/storeMatcher';
import { loadReferences } from '@/lib/callcycle/referenceData';
import { loadTeamControl } from '@/lib/callcycle/controlData';
import { noCacheHeaders } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Step 1 of the planner upload: read the file and report what we found, WITHOUT
 * saving anything.
 *
 * The planners need two human decisions before they can be trusted — which
 * colours mean "in store", and which real store each freehand name refers to —
 * so this returns everything the review screen needs and the commit endpoint
 * does the writing.
 */
export async function POST(req: NextRequest) {
  const actor = await requirePermission(req, 'cc.planner.upload');
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noCacheHeaders() });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());

    const { sheets, warnings } = parseSnoMasterPlanner(workbook, file.name);
    if (sheets.length === 0) {
      return NextResponse.json({
        error: 'No planner calendar could be found in this workbook.',
        warnings,
      }, { status: 400 });
    }

    const validation = validatePlanner(sheets);

    // Even when validation blocks the load, still return the parse so the user
    // can see what we read — it makes the mismatch obvious rather than abstract.
    const references = await loadReferences();
    const matcher = buildStoreMatcher(references.stores);
    const teamControl = await loadTeamControl();

    const reps = (teamControl?.teams ?? [])
      .filter(t => t.memberEmail)
      .map(t => ({ email: t.memberEmail, memberId: t.memberId, teamName: t.teamName, teamLeader: t.teamLeader }))
      .sort((a, b) => a.email.localeCompare(b.email));

    const analysed = sheets.map(sheet => {
      // Preview using our suggested colour choices; the UI can re-derive after
      // the user changes them.
      const suggestedFills = sheet.legend.filter(l => l.suggestedIsVisit).map(l => l.fill);
      const cycles = deriveCycles(sheet, suggestedFills);

      const storeMatches = sheet.stores.map(s => {
        const m = matcher.match(s.storeName, s.storeCode);
        const cycle = cycles.find(c => c.rowNumber === s.rowNumber);
        return {
          rowNumber: s.rowNumber,
          index: s.index,
          inputName: s.storeName,
          section: s.section,
          typedCode: s.storeCode,
          match: m,
          hasVisits: !!cycle,
          visitDays: cycle?.visitDays ?? [],
          entryGroups: cycle ? cycleToEntryGroups(cycle) : [],
        };
      });

      // Guess the rep from the file, then try to line it up with a real Perigee
      // account so the dropdown lands on the right person.
      const guessName = (sheet.repName || repNameFromFilename(file.name)).toLowerCase().replace(/[^a-z]/g, '');
      const suggestedEmail = guessName
        ? reps.find(r => r.email.split('@')[0].toLowerCase().replace(/[^a-z]/g, '') === guessName)?.email
          || reps.find(r => r.email.split('@')[0].toLowerCase().replace(/[^a-z]/g, '').startsWith(guessName))?.email
          || reps.find(r => guessName.startsWith(r.email.split('@')[0].toLowerCase().replace(/[^a-z]/g, '')))?.email
          || ''
        : '';

      return {
        sheetName: sheet.sheetName,
        title: sheet.title,
        regionTitle: sheet.regionTitle,
        repName: sheet.repName,
        suggestedEmail,
        gridMonth: sheet.gridMonth,
        gridYear: sheet.gridYear,
        sheetNameMonth: sheet.sheetNameMonth,
        titleMonth: sheet.titleMonth,
        usesTypedMarkers: sheet.usesTypedMarkers,
        hasCodeColumn: sheet.hasCodeColumn,
        storesWithCodes: sheet.storesWithCodes,
        legend: sheet.legend,
        storeCount: sheet.stores.length,
        storesWithVisits: cycles.length,
        totalMarkedDays: cycles.reduce((n, c) => n + c.visitDays.length, 0),
        stores: storeMatches,
        warnings: sheet.warnings,
      };
    });

    return NextResponse.json({
      ok: !validation.blocked,
      blocked: validation.blocked,
      issues: validation.issues,
      warnings,
      filename: file.name,
      storeSource: references.storeSource,
      storeRefCount: references.stores.length,
      reps,
      sheets: analysed,
    }, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('[call-cycles/planner/analyse] Error:', err);
    return NextResponse.json({ error: 'Failed to read the planner', detail: String(err) }, { status: 500 });
  }
}
