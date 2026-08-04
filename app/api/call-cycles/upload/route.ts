import { NextRequest, NextResponse } from 'next/server';
import { parseCallCycleFile, ParseMode } from '@/lib/callcycle/parsers';
import { loadReferences } from '@/lib/callcycle/referenceData';
import { loadTeamControl } from '@/lib/callcycle/controlData';
import { mergeIntoSchedule } from '@/lib/callcycle/scheduleData';
import { noCacheHeaders } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
import { logActivity } from '@/lib/activityLog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const VALID_PARSE_MODES: ParseMode[] = ['team-leader', 'user', 'user-4wk', 'auto'];

export async function POST(req: NextRequest) {
  const actor = await requirePermission(req, 'cc.planner.upload');
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noCacheHeaders() });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    // Carl's hard rule from the iRAM build: never silently auto-detect when the
    // caller sent something unexpected — fall back to the team-leader parser.
    const rawParseMode = (formData.get('parseMode') as string | null) || '';
    const parseMode: ParseMode = VALID_PARSE_MODES.includes(rawParseMode as ParseMode)
      ? (rawParseMode as ParseMode)
      : 'team-leader';

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const ignoreSheetNames = formData.get('ignoreSheetNames') === '1';
    const ignoreErrorSites = formData.get('ignoreErrorSites') === '1';

    const buffer = Buffer.from(await file.arrayBuffer());
    const references = await loadReferences();
    const teamControlData = await loadTeamControl();

    const { format, entries, warnings } = parseCallCycleFile(
      buffer, references, teamControlData?.teams, parseMode,
      { ignoreSheetNames },
    );

    // Sheets named by person (not email) can only be resolved via control files.
    const needsRefData = ['josh-standard', 'josh-alt', 'email-sheet', 'simple-name'].includes(format);
    if (needsRefData && references.users.length === 0) {
      warnings.unshift(
        'No team control file loaded. Sheets named by person (not email address) cannot be matched to Perigee user emails. Upload control files first via Call Cycles > Control Files.'
      );
    }
    if (references.storeSource === 'store-master') {
      warnings.unshift(
        'No Perigee store control file loaded — stores were matched against SnoMaster\'s store master instead. Channel names may not match Perigee exactly. Upload the store control file for a guaranteed-loadable export.'
      );
    }
    if (references.storeSource === 'none') {
      warnings.unshift(
        'No store reference data at all — every row will load with a blank channel. Upload the Perigee store control file via Call Cycles > Control Files.'
      );
    }

    if (entries.length === 0) {
      return NextResponse.json({
        error: 'No data could be extracted from the file',
        format,
        warnings,
      }, { status: 400 });
    }

    const result = await mergeIntoSchedule(
      entries,
      actor.email,
      references.stores,
      { ignoreErrorSites },
    );

    // Aborted: error sites found and the user hasn't opted to ignore them.
    // Nothing was saved — tell them to fix the file and reload.
    if (result.aborted) {
      return NextResponse.json({
        ok: false,
        error: `${result.unmatchedDuplicates.length} site(s) have a duplicate site code that could not be matched to a channel. Fix the store name(s) in the file and reload, or tick "Ignore error sites" to load the rest.`,
        format,
        warnings: [...warnings, ...result.warnings],
        unmatchedDuplicates: result.unmatchedDuplicates,
      }, { status: 400 });
    }

    await logActivity(
      'callcycle_upload',
      actor.email,
      `${actor.name} ${actor.surname}`.trim(),
      'call-cycles',
      `Uploaded "${file.name}" (${format}): ${result.rowsAdded} added, ${result.rowsUpdated} updated, ${result.totalRows} total`,
      { format, entriesFound: entries.length, skippedRows: result.skippedRows },
    );

    return NextResponse.json({
      ok: true,
      format,
      entriesFound: entries.length,
      ...result,
      warnings: [...warnings, ...result.warnings],
    }, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('[call-cycles/upload] Error:', err);
    return NextResponse.json({ error: 'Failed to process file', detail: String(err) }, { status: 500 });
  }
}
