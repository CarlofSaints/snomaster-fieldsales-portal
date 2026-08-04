import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { loadSchedule } from '@/lib/callcycle/scheduleData';
import { loadReferences } from '@/lib/callcycle/referenceData';
import { loadStoreControl, loadTeamControl } from '@/lib/callcycle/controlData';
import { buildStoreChannelResolver } from '@/lib/callcycle/storeChannelResolver';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import { logActivity } from '@/lib/activityLog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** SnoMaster brand red, as an ExcelJS ARGB. */
const COL_BRAND = 'FFE31E1C';

function daysToShort(days: string[]): string {
  const map: Record<string, string> = {
    Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed',
    Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
  };
  return days.map(d => map[d] || d).join(',');
}

function parseCycleWeeks(cycle: string): number[] {
  if (!cycle) return [];
  const nums = cycle.match(/\d+/g);
  return nums ? nums.map(Number).filter(n => n >= 1 && n <= 6).sort((a, b) => a - b) : [];
}

export async function GET(req: Request) {
  const actor = await requireRole(req, ['super_admin', 'admin']);
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noCacheHeaders() });
  }

  const [schedule, references, storeControl, teamControl] = await Promise.all([
    loadSchedule(),
    loadReferences(),
    loadStoreControl(),
    loadTeamControl(),
  ]);

  // User lookup for the read-only Perigee columns (USER ID / STATUS).
  const userLookup = new Map<string, { userId: string; status: string; firstName: string; surname: string }>();
  for (const u of references.users) {
    userLookup.set(u.userEmail.toLowerCase(), {
      userId: u.userId, status: u.status,
      firstName: u.firstName, surname: u.surname,
    });
  }

  // Team member lookup (memberEmail → team info).
  const teamMemberLookup = new Map<string, { teamName: string; teamLeader: string; memberId: string }>();
  if (teamControl) {
    for (const t of teamControl.teams) {
      teamMemberLookup.set(t.memberEmail.toLowerCase(), {
        teamName: t.teamName,
        teamLeader: t.teamLeader,
        memberId: t.memberId,
      });
    }
  }

  // Site code is the primary key; codes shared across channels are
  // disambiguated by store name. Resolving here also corrects any channel that
  // was stored wrong before the control file was loaded.
  const channelResolver = buildStoreChannelResolver(references.stores);

  // Reverse lookup: email local part → full email + memberId. Lets a sheet that
  // only gave us a first name still resolve to a Perigee user.
  const localPartLookup = new Map<string, { email: string; memberId: string; teamName: string; teamLeader: string }>();
  if (teamControl) {
    for (const t of teamControl.teams) {
      const local = (t.memberEmail || '').split('@')[0].toLowerCase();
      if (local && !localPartLookup.has(local)) {
        localPartLookup.set(local, {
          email: t.memberEmail,
          memberId: t.memberId,
          teamName: t.teamName,
          teamLeader: t.teamLeader,
        });
      }
    }
  }

  // Perigee's CYCLE column is per USER, not per row: the number of weeks in
  // their cycle. Take the highest week number seen across all their rows.
  const userCycleMap = new Map<string, number>();
  for (const row of schedule) {
    const key = row.userEmail.toLowerCase();
    const weeks = parseCycleWeeks(row.cycle);
    const maxWeek = weeks.length > 0 ? Math.max(...weeks) : 1;
    if (maxWeek > (userCycleMap.get(key) || 0)) userCycleMap.set(key, maxWeek);
  }

  const workbook = new ExcelJS.Workbook();

  const headerFont: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  const COL_BLUE   = 'FF4472C4';  // User info
  const COL_DGREEN = 'FF548235';  // Cycle admin
  const COL_ORANGE = 'FFED7D31';  // Action
  const COL_NAVY   = 'FF2F5496';  // Store info
  const COL_GREY   = 'FF828282';  // Cycle number

  // Schedule sheet: column-index → colour (1-based)
  const scheduleColors: Record<number, string> = {
    1: COL_BLUE, 2: COL_BLUE, 3: COL_BLUE, 4: COL_BLUE,
    5: COL_BLUE, 6: COL_BLUE, 7: COL_BLUE,
    8: COL_DGREEN, 9: COL_DGREEN, 10: COL_DGREEN, 11: COL_DGREEN,
    12: COL_ORANGE,
    13: COL_NAVY, 14: COL_NAVY, 15: COL_NAVY,
    16: COL_GREY,
    17: COL_BRAND, 18: COL_BRAND, 19: COL_BRAND,
    20: COL_BRAND, 21: COL_BRAND, 22: COL_BRAND,
  };

  function applyHeaderColors(row: ExcelJS.Row, colorMap?: Record<number, string>) {
    row.eachCell((cell, colNumber) => {
      const argb = colorMap ? (colorMap[colNumber] || COL_BRAND) : COL_BRAND;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
      cell.font = headerFont;
    });
  }

  // === Sheet 1: Instructions ===
  const instrSheet = workbook.addWorksheet('Instructions');
  instrSheet.getColumn(1).width = 120;

  const instrLines: { text: string; bold?: boolean; size?: number }[] = [
    { text: 'Excel Template Instructions: Call Cycle Management', bold: true, size: 14 },
    { text: '' },
    { text: 'Overview', bold: true, size: 12 },
    { text: '' },
    { text: 'This Excel template is used to manage call cycles for users across teams. The template consists of two sheets:' },
    { text: '' },
    { text: '1. Teams And User Cycle - For managing user-team assignments and call cycle creation/updates' },
    { text: '2. Schedule - For detailed call scheduling and weekly planning' },
    { text: '' },
    { text: 'Both sheets work together to ensure proper call cycle management and scheduling.' },
    { text: '' },
    { text: 'SHEET 1: TEAMS AND USER CYCLE', bold: true, size: 12 },
    { text: 'Purpose', bold: true },
    { text: 'Manage user-team relationships and add/update call cycles.' },
    { text: '' },
    { text: 'Column Instructions', bold: true },
    { text: '' },
    { text: 'USER ID: [Required, Read-only] Unique identifier for each user.' },
    { text: 'USER EMAIL: [Required, Read-only] User\'s email address.' },
    { text: 'FIRST NAME: [Required, Read-only] User\'s first name.' },
    { text: 'SURNAME: [Required, Read-only] User\'s last name.' },
    { text: 'JOB TITLE: [Optional, Editable] User\'s position. Select from dropdown.' },
    { text: 'TEAM NAME: [Optional, Editable] Team assignment. Select from dropdown. (Create on portal if team does not exist)' },
    { text: 'TEAM LEADER: [Read-only] Team leader\'s email. (Automatically populated, changes in this template have no effect)' },
    { text: 'ASM: [Optional, Editable] Area Sales Manager email. Select from dropdown.' },
    { text: 'REGIONAL MANAGER: [Optional, Editable] Regional Manager email. Select from dropdown.' },
    { text: 'ACTION: [Required, Editable] Operation to perform. Select from dropdown.' },
    { text: 'CYCLE STATUS: [Required, Editable] Current cycle status. Select from dropdown.' },
    { text: 'CYCLE: [Required, Editable] Number of weeks for this users cycle. 1, 2, 3, 4, etc.' },
    { text: 'CYCLE START DATE: [Required, Editable] Cycle start date. Format: YYYY-MM-DD.' },
    { text: 'CYCLE END DATE: [Optional, Editable] Cycle end date. Format: YYYY-MM-DD.' },
    { text: '' },
    { text: 'Action Scenarios', bold: true },
    { text: '' },
    { text: 'ADD New Call Cycle:' },
    { text: '- Set ACTION = ADD' },
    { text: '- Set CYCLE STATUS = ACTIVE (or PENDING for a future cycle)' },
    { text: '- Set CYCLE = Number of weeks' },
    { text: '- Ensure CYCLE START DATE is today or future date' },
    { text: '- CYCLE END DATE is optional' },
    { text: '' },
    { text: 'UPDATE Existing Call Cycle:' },
    { text: '- Set ACTION = UPDATE' },
    { text: '- Update only the fields that need changing' },
    { text: '- CYCLE START DATE can NOT be updated if the cycle has already started' },
    { text: '' },
    { text: 'REMOVE Call Cycle:' },
    { text: '- Set ACTION = REMOVE' },
    { text: '- Only PENDING cycles can be deleted or ACTIVE cycles which have not yet started' },
    { text: '' },
    { text: 'Validation Rules', bold: true },
    { text: '- Each user can have only one ACTIVE or PENDING cycle at a time' },
    { text: '- CYCLE START DATE must be <= CYCLE END DATE (if both provided)' },
    { text: '- Team leaders and managers must exist in the system' },
    { text: '- PENDING cycles must have start date >= today' },
    { text: '' },
    { text: 'SHEET 2: SCHEDULE', bold: true, size: 12 },
    { text: 'Purpose', bold: true },
    { text: 'Detailed scheduling of call activities and weekly planning for each user\'s call cycle.' },
    { text: '' },
    { text: 'Column Instructions', bold: true },
    { text: '' },
    { text: 'USER ID: [Required, Read-only] Unique identifier for each user.' },
    { text: 'USER EMAIL: [Required, Read-only] User\'s email address.' },
    { text: 'FIRST NAME: [Required, Read-only] User\'s first name.' },
    { text: 'SURNAME: [Required, Read-only] User\'s last name.' },
    { text: 'USER STATUS: [Required, Read-only] Current user status.' },
    { text: 'USER ACCESS: [Required, Read-only] Current user access.' },
    { text: 'CALL CYCLE ACCESS: [Required, Read-only] Cycle permissions.' },
    { text: 'CYCLE START DATE: [Required, Read-only] Cycle start date.' },
    { text: 'CYCLE END DATE: [Required, Read-only] Cycle end date.' },
    { text: 'CYCLE STATUS: [Required, Read-only] Current cycle status.' },
    { text: 'ACTION: [Required, Editable] Select from dropdown.' },
    { text: 'STORE ID: [Required, Editable] Store identifier. Existing store ID.' },
    { text: 'STORE NAME: [Required, Editable] Store name. Existing store name.' },
    { text: 'CHANNEL: [Required, Editable] Business channel. Existing channel name.' },
    { text: 'CYCLE: [Required, Read-only] Cycle value. Must match Teams sheet.' },
    { text: 'WEEK1-6: [Optional] Weekly schedule details. Mon, Tue, Wed, Thu, Fri, Sat, Sun' },
    { text: '' },
    { text: 'Scheduling Guidelines', bold: true },
    { text: '' },
    { text: 'ADD: Set ACTION = ADD. All required fields must be populated. Copy STORE ID/NAME/CHANNEL from Stores sheet.' },
    { text: 'UPDATE: Set ACTION = UPDATE. Update weekly plans as needed. Can modify store assignments or weekly activities.' },
    { text: 'REMOVE: Set ACTION = REMOVE. Removes schedule entry, not the call cycle itself.' },
    { text: '' },
    { text: 'SUBMISSION PROCESS', bold: true, size: 12 },
    { text: '' },
    { text: '1. The Teams Sheet can be submitted on its own' },
    { text: '2. The Schedule Sheet can be submitted on its own' },
    { text: '3. If both sheets are submitted, both will be processed in order (Teams Sheet first)' },
    { text: '4. Delete the Stores sheet before submitting' },
    { text: '' },
    { text: 'OTHER NOTES', bold: true, size: 12 },
    { text: '' },
    { text: '1. The Store Frequency Report does not take leave into consideration' },
    { text: '2. The Store Frequency Report does not take user\'s \'CALL CYCLE ACCESS\' into consideration' },
    { text: '3. Users who have already received their stores for the day don\'t receive updates until the next request to \'Start their day\'' },
    { text: '4. An ACTIVE cycle and PENDING cycle can NOT have overlapping dates' },
    { text: '5. A PENDING cycle will start automatically on its start date, any existing ACTIVE cycle will automatically end' },
    { text: '6. Red columns can NOT be updated' },
    { text: '7. Yellow columns can be updated' },
    { text: '8. Green columns should be updated' },
  ];

  for (const line of instrLines) {
    const row = instrSheet.addRow([line.text]);
    if (line.bold) row.getCell(1).font = { bold: true, size: line.size || 11 };
  }

  // === Sheet 2: Schedule (Perigee format) ===
  const scheduleSheet = workbook.addWorksheet('Schedule');
  scheduleSheet.columns = [
    { header: 'USER ID', key: 'userId', width: 10 },
    { header: 'USER EMAIL', key: 'userEmail', width: 30 },
    { header: 'FIRST NAME', key: 'firstName', width: 15 },
    { header: 'SURNAME', key: 'surname', width: 15 },
    { header: 'USER STATUS', key: 'userStatus', width: 12 },
    { header: 'USER ACCESS', key: 'userAccess', width: 12 },
    { header: 'ASSIGNED PROVINCES', key: 'assignedProvinces', width: 25 },
    { header: 'CALL CYCLE ACCESS', key: 'callCycleAccess', width: 15 },
    { header: 'CYCLE START DATE', key: 'cycleStartDate', width: 15 },
    { header: 'CYCLE END DATE', key: 'cycleEndDate', width: 15 },
    { header: 'CYCLE STATUS', key: 'cycleStatus', width: 12 },
    { header: 'ACTION', key: 'action', width: 12 },
    { header: 'STORE ID', key: 'storeId', width: 15 },
    { header: 'STORE NAME', key: 'storeName', width: 35 },
    { header: 'CHANNEL', key: 'channel', width: 20 },
    { header: 'CYCLE', key: 'cycle', width: 8 },
    { header: 'WEEK1', key: 'week1', width: 15 },
    { header: 'WEEK2', key: 'week2', width: 15 },
    { header: 'WEEK3', key: 'week3', width: 15 },
    { header: 'WEEK4', key: 'week4', width: 15 },
    { header: 'WEEK5', key: 'week5', width: 15 },
    { header: 'WEEK6', key: 'week6', width: 15 },
  ];

  applyHeaderColors(scheduleSheet.getRow(1), scheduleColors);

  const actionColors: Record<string, string> = {
    ADD: 'FFd1fae5',
    UPDATE: 'FFfef3c7',
    REMOVE: 'FFfee2e2',
    LIVE: 'FFf3f4f6',
  };

  // One export row per user+store, with each cycle week folded into its WEEKn
  // column — that is the shape Perigee expects.
  const mergedMap = new Map<string, { row: typeof schedule[0]; weekDays: Map<number, string> }>();

  for (const row of schedule) {
    const key = `${row.userEmail.toLowerCase()}|${row.storeId.toUpperCase()}`;
    const weekNums = parseCycleWeeks(row.cycle);
    const daysShort = daysToShort(row.days);

    if (!mergedMap.has(key)) mergedMap.set(key, { row, weekDays: new Map() });

    const entry = mergedMap.get(key)!;
    for (const w of weekNums) entry.weekDays.set(w, daysShort);
    if (new Date(row.uploadedAt) > new Date(entry.row.uploadedAt)) entry.row = { ...row };
  }

  for (const [, { row, weekDays }] of mergedMap) {
    let resolvedEmail = row.userEmail;
    if (!resolvedEmail && row.firstName) {
      const byLocal = localPartLookup.get(row.firstName.toLowerCase());
      if (byLocal) resolvedEmail = byLocal.email;
    }

    const refUser = userLookup.get(resolvedEmail.toLowerCase());
    const teamInfo = teamMemberLookup.get(resolvedEmail.toLowerCase());
    const userCycle = userCycleMap.get(resolvedEmail.toLowerCase()) ||
      userCycleMap.get(row.userEmail.toLowerCase()) || 1;

    const userId = teamInfo?.memberId ||
      (!row.userEmail && row.firstName ? localPartLookup.get(row.firstName.toLowerCase())?.memberId : '') ||
      refUser?.userId || '';

    const channel = channelResolver.resolve(row.storeId, row.storeName) || row.channel || '';

    const r = scheduleSheet.addRow({
      userId,
      userEmail: resolvedEmail,
      firstName: row.firstName,
      surname: row.surname,
      userStatus: refUser?.status || 'ACTIVE',
      userAccess: 'ENABLED',
      assignedProvinces: '',
      callCycleAccess: 'YES',
      cycleStartDate: '',
      cycleEndDate: '',
      cycleStatus: 'ACTIVE',
      action: row.action,
      storeId: row.storeId,
      storeName: row.storeName,
      channel,
      cycle: String(userCycle),
      week1: weekDays.get(1) || '',
      week2: weekDays.get(2) || '',
      week3: weekDays.get(3) || '',
      week4: weekDays.get(4) || '',
      week5: weekDays.get(5) || '',
      week6: weekDays.get(6) || '',
    });

    r.getCell('action').fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: actionColors[row.action] || 'FFf3f4f6' },
    };
  }

  // === Sheet 3: Teams And User Cycle ===
  const teamsUserSheet = workbook.addWorksheet('Teams And User Cycle');
  teamsUserSheet.columns = [
    { header: 'USER ID', key: 'userId', width: 10 },
    { header: 'USER EMAIL', key: 'userEmail', width: 30 },
    { header: 'FIRST NAME', key: 'firstName', width: 15 },
    { header: 'SURNAME', key: 'surname', width: 15 },
    { header: 'STATUS', key: 'status', width: 12 },
    { header: 'ASSIGNED PROVINCES', key: 'assignedProvinces', width: 25 },
    { header: 'JOB TITLE', key: 'jobTitle', width: 20 },
    { header: 'LEAVE TYPE', key: 'leaveType', width: 12 },
    { header: 'LEAVE START', key: 'leaveStart', width: 12 },
    { header: 'LEAVE END', key: 'leaveEnd', width: 12 },
    { header: 'TEAM NAME', key: 'teamName', width: 20 },
    { header: 'TEAM LEADER', key: 'teamLeader', width: 30 },
    { header: 'ASM', key: 'asm', width: 15 },
    { header: 'REGIONAL MANAGER', key: 'regionalManager', width: 20 },
    { header: 'ACTION', key: 'action', width: 10 },
    { header: 'CYCLE STATUS', key: 'cycleStatus', width: 12 },
    { header: 'CYCLE', key: 'cycle', width: 8 },
    { header: 'CYCLE START DATE', key: 'cycleStartDate', width: 15 },
    { header: 'CYCLE END DATE', key: 'cycleEndDate', width: 15 },
  ];
  applyHeaderColors(teamsUserSheet.getRow(1));

  const seenEmails = new Set<string>();
  for (const row of schedule) {
    let resolvedEmail = row.userEmail;
    if (!resolvedEmail && row.firstName) {
      const byLocal = localPartLookup.get(row.firstName.toLowerCase());
      if (byLocal) resolvedEmail = byLocal.email;
    }

    const key = resolvedEmail.toLowerCase();
    if (seenEmails.has(key)) continue;
    seenEmails.add(key);

    const refUser = userLookup.get(key);
    const teamInfo = teamMemberLookup.get(key);
    const userCycle = userCycleMap.get(key) || 1;

    const userId = teamInfo?.memberId ||
      (!row.userEmail && row.firstName ? localPartLookup.get(row.firstName.toLowerCase())?.memberId : '') ||
      refUser?.userId || '';

    teamsUserSheet.addRow({
      userId,
      userEmail: resolvedEmail,
      firstName: row.firstName,
      surname: row.surname,
      status: refUser?.status || 'ACTIVE',
      assignedProvinces: '',
      jobTitle: '',
      leaveType: '',
      leaveStart: '',
      leaveEnd: '',
      teamName: teamInfo?.teamName || '',
      teamLeader: teamInfo?.teamLeader || '',
      asm: '',
      regionalManager: '',
      action: row.action,
      cycleStatus: 'ACTIVE',
      cycle: String(userCycle),
      cycleStartDate: '',
      cycleEndDate: '',
    });
  }

  // === Sheet 4: Stores (Delete Before Upload) ===
  const storeSheet = workbook.addWorksheet('Stores (Delete Before Upload)');
  storeSheet.columns = [
    { header: 'STORE ID', key: 'storeId', width: 15 },
    { header: 'STORE NAME', key: 'storeName', width: 35 },
    { header: 'CHANNEL', key: 'channel', width: 20 },
  ];
  applyHeaderColors(storeSheet.getRow(1));

  const storeRows = storeControl && storeControl.stores.length > 0
    ? storeControl.stores.map(s => ({ storeId: s.storeCode, storeName: s.storeName, channel: s.channel }))
    : references.stores.map(s => ({ storeId: s.storeCode, storeName: s.storeName, channel: s.channel }));
  for (const s of storeRows) storeSheet.addRow(s);

  // === Sheet 5: Data (validation lists) ===
  const dataSheet = workbook.addWorksheet('Data');
  dataSheet.columns = [
    { header: 'ACTION', key: 'action', width: 15 },
    { header: 'CYCLE STATUS', key: 'cycleStatus', width: 15 },
  ];
  applyHeaderColors(dataSheet.getRow(1));
  ['ADD', 'UPDATE', 'REMOVE', 'LIVE', 'SET_END_TODAY'].forEach(a =>
    dataSheet.addRow({ action: a, cycleStatus: '' })
  );
  ['ACTIVE', 'PENDING'].forEach((v, i) => { dataSheet.getCell(i + 2, 2).value = v; });

  const buffer = await workbook.xlsx.writeBuffer();

  await logActivity(
    'callcycle_download',
    actor.email,
    `${actor.name} ${actor.surname}`.trim(),
    'call-cycles',
    `Downloaded Perigee Call Schedule (${schedule.length} rows)`,
  );

  const date = new Date().toISOString().split('T')[0];
  const filename = `SnoMaster - Perigee Call Schedule - ${date}.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
