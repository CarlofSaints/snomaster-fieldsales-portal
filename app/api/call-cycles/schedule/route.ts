import { NextResponse } from 'next/server';
import {
  loadScheduleWithTeamLeaders,
  updateScheduleRow,
  deleteScheduleRow,
  clearSchedule,
} from '@/lib/callcycle/scheduleData';
import { noCacheHeaders } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
import { logActivity } from '@/lib/activityLog';
import type { ScheduleRow } from '@/lib/callcycle/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VIEW_ROLES = ['super_admin', 'admin', 'client'] as const;
const EDIT_ROLES = ['super_admin', 'admin'] as const;

export async function GET(req: Request) {
  const actor = await requirePermission(req, 'cc.schedule.view');
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noCacheHeaders() });
  }
  const schedule = await loadScheduleWithTeamLeaders();
  return NextResponse.json(schedule, { headers: noCacheHeaders() });
}

export async function PUT(req: Request) {
  const actor = await requirePermission(req, 'cc.schedule.manage');
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noCacheHeaders() });
  }

  try {
    const body = await req.json() as { index?: number; row?: ScheduleRow };
    if (typeof body.index !== 'number' || !body.row) {
      return NextResponse.json({ error: 'index and row are required' }, { status: 400 });
    }

    const updated = await updateScheduleRow(body.index, body.row);
    await logActivity(
      'callcycle_edit',
      actor.email,
      `${actor.name} ${actor.surname}`.trim(),
      'call-cycles',
      `Edited schedule row for ${body.row.userEmail || body.row.firstName} — ${body.row.storeName}`,
    );
    return NextResponse.json(updated, { headers: noCacheHeaders() });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const actor = await requirePermission(req, 'cc.schedule.manage');
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noCacheHeaders() });
  }

  try {
    const body = await req.json() as { index?: number; clearAll?: boolean };

    if (body.clearAll) {
      await clearSchedule();
      await logActivity(
        'callcycle_clear',
        actor.email,
        `${actor.name} ${actor.surname}`.trim(),
        'call-cycles',
        'Cleared the entire call cycle schedule',
      );
      return NextResponse.json([], { headers: noCacheHeaders() });
    }

    if (typeof body.index !== 'number') {
      return NextResponse.json({ error: 'index is required' }, { status: 400 });
    }

    const updated = await deleteScheduleRow(body.index);
    await logActivity(
      'callcycle_delete',
      actor.email,
      `${actor.name} ${actor.surname}`.trim(),
      'call-cycles',
      `Deleted schedule row #${body.index}`,
    );
    return NextResponse.json(updated, { headers: noCacheHeaders() });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
