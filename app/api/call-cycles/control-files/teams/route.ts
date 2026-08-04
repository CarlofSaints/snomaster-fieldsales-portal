import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import type { TeamControlEntry } from '@/lib/callcycle/types';
import { loadTeamControl, saveTeamControl, clearTeamControl } from '@/lib/callcycle/controlData';
import { findHeader } from '@/lib/callcycle/storeRowProcessor';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import { logActivity } from '@/lib/activityLog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** Perigee writes the leader as "Name (email)" — pull the email out of the parens. */
function parseLeaderEmail(raw: string): string {
  const match = raw.match(/\(([^)]+)\)/);
  return match ? match[1].trim() : '';
}

export async function POST(req: NextRequest) {
  const actor = await requireRole(req, ['super_admin', 'admin']);
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noCacheHeaders() });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const mode = formData.get('mode') === 'merge' ? 'merge' : 'replace';

    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return NextResponse.json({ error: 'No sheets found in file' }, { status: 400 });

    const rows: string[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
    if (rows.length < 2) return NextResponse.json({ error: 'File has no data rows' }, { status: 400 });

    const headers = rows[0].map(String);
    const colTeamName = findHeader(headers, ['team name', 'teamname']);
    const colTeamLeader = findHeader(headers, ['team leader', 'teamleader']);
    const colTeamLeaderId = findHeader(headers, ['team leader id', 'teamleaderid', 'leader id']);
    const colMemberEmail = findHeader(headers, ['member email', 'memberemail', 'team member email', 'teammemberemail', 'user email', 'useremail', 'email']);
    const colMemberId = findHeader(headers, ['member id', 'memberid', 'team member id', 'teammemberid', 'user id', 'userid']);

    const missing: string[] = [];
    if (colTeamName < 0) missing.push('Team Name');
    if (colMemberEmail < 0) missing.push('Member Email');
    if (missing.length > 0) {
      return NextResponse.json({
        error: `Required column(s) not found: ${missing.join(', ')}. Found headers: ${headers.join(', ')}`,
      }, { status: 400 });
    }

    const teams: TeamControlEntry[] = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const memberEmail = String(r[colMemberEmail] || '').trim();
      if (!memberEmail) continue;

      const teamLeaderRaw = colTeamLeader >= 0 ? String(r[colTeamLeader] || '').trim() : '';

      teams.push({
        teamName: String(r[colTeamName] || '').trim(),
        // Display name: strip the trailing "(email)".
        teamLeader: teamLeaderRaw.replace(/\s*\([^)]*\)\s*$/, '').trim(),
        teamLeaderEmail: parseLeaderEmail(teamLeaderRaw),
        teamLeaderId: colTeamLeaderId >= 0 ? String(r[colTeamLeaderId] || '').trim() : '',
        memberEmail,
        memberId: colMemberId >= 0 ? String(r[colMemberId] || '').trim() : '',
      });
    }

    if (teams.length === 0) {
      return NextResponse.json({ error: 'No valid team rows found' }, { status: 400 });
    }

    let finalTeams: TeamControlEntry[] = teams;
    if (mode === 'merge') {
      const existing = await loadTeamControl();
      if (existing && existing.teams.length > 0) {
        const teamMap = new Map<string, TeamControlEntry>();
        for (const t of existing.teams) teamMap.set(t.memberEmail.toLowerCase(), t);
        for (const t of teams) teamMap.set(t.memberEmail.toLowerCase(), t);
        finalTeams = [...teamMap.values()];
      }
    }

    const withUserId = finalTeams.filter(t => t.memberId).length;

    await saveTeamControl({
      teams: finalTeams,
      uploadedAt: new Date().toISOString(),
      uploadedBy: actor.email,
    });

    await logActivity(
      'callcycle_control_upload',
      actor.email,
      `${actor.name} ${actor.surname}`.trim(),
      'call-cycles/team-control',
      `Uploaded team control file (${mode}): ${teams.length} new, ${finalTeams.length} total`,
    );

    return NextResponse.json({
      ok: true,
      totalMembers: finalTeams.length,
      withUserId,
      teams: [...new Set(finalTeams.map(t => t.teamName).filter(Boolean))].length,
    }, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('[call-cycles/control-files/teams] POST error:', err);
    return NextResponse.json({ error: 'Failed to process file', detail: String(err) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const actor = await requireRole(req, ['super_admin', 'admin']);
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noCacheHeaders() });
  }

  const data = await loadTeamControl();
  if (!data) return NextResponse.json({ loaded: false }, { headers: noCacheHeaders() });

  return NextResponse.json({
    loaded: true,
    totalMembers: data.teams.length,
    withUserId: data.teams.filter(t => t.memberId).length,
    teams: [...new Set(data.teams.map(t => t.teamName).filter(Boolean))].sort(),
    uploadedAt: data.uploadedAt,
    uploadedBy: data.uploadedBy,
  }, { headers: noCacheHeaders() });
}

export async function DELETE(req: Request) {
  const actor = await requireRole(req, ['super_admin', 'admin']);
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noCacheHeaders() });
  }

  await clearTeamControl();
  await logActivity(
    'callcycle_control_upload',
    actor.email,
    `${actor.name} ${actor.surname}`.trim(),
    'call-cycles/team-control',
    'Cleared the team control file',
  );
  return NextResponse.json({ ok: true }, { headers: noCacheHeaders() });
}
