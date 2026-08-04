import { NextRequest, NextResponse } from 'next/server';
import { loadSchedule } from '@/lib/callcycle/scheduleData';
import { loadTeamControl } from '@/lib/callcycle/controlData';
import { buildPlannerTemplate, MONTH_NAMES, type TemplateSheet } from '@/lib/callcycle/plannerTemplate';
import { noCacheHeaders } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Hand the reps a planner instead of correcting theirs afterwards.
 * The workbook itself is built in lib/callcycle/plannerTemplate.ts.
 */
export async function GET(req: NextRequest) {
  const actor = await requirePermission(req, 'cc.planner.upload');
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noCacheHeaders() });
  }

  const url = new URL(req.url);
  const now = new Date();
  // Default to NEXT month — a planner is written before the month it covers.
  const rolls = now.getMonth() + 2 > 12;
  const month = Number(url.searchParams.get('month')) || (rolls ? 1 : now.getMonth() + 2);
  const year = Number(url.searchParams.get('year')) || (rolls ? now.getFullYear() + 1 : now.getFullYear());
  const repParam = (url.searchParams.get('rep') || '').toLowerCase();

  if (month < 1 || month > 12 || year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'Invalid month or year' }, { status: 400 });
  }

  const [schedule, teamControl] = await Promise.all([loadSchedule(), loadTeamControl()]);

  // One sheet for the rep asked for, else for everyone who has a schedule, else
  // a single blank sheet to fill in by hand.
  const emails = [...new Set(schedule.map(r => r.userEmail.toLowerCase()).filter(Boolean))].sort();
  const targets = repParam ? [repParam] : (emails.length > 0 ? emails : ['']);

  const sheets: TemplateSheet[] = targets.map(email => {
    // Distinct stores this rep calls on, carrying the Perigee code so next
    // month's upload resolves exactly instead of guessing at the name.
    const byStore = new Map<string, { code: string; name: string; channel: string }>();
    for (const row of schedule) {
      if (email && row.userEmail.toLowerCase() !== email) continue;
      const key = (row.storeId || row.storeName).toUpperCase();
      if (!byStore.has(key)) {
        byStore.set(key, { code: row.storeId, name: row.storeName, channel: row.channel });
      }
    }
    const stores = [...byStore.values()].sort((a, b) =>
      (a.channel || '').localeCompare(b.channel || '') || a.name.localeCompare(b.name));

    return {
      email,
      teamName: teamControl?.teams.find(t => t.memberEmail.toLowerCase() === email)?.teamName,
      stores,
    };
  });

  const wb = buildPlannerTemplate(month, year, sheets);
  const buffer = await wb.xlsx.writeBuffer();

  const who = repParam ? repParam.split('@')[0] : 'All Reps';
  const filename = `SnoMaster Planner - ${who} - ${MONTH_NAMES[month - 1]} ${year}.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
