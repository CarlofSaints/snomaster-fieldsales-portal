import { NextRequest, NextResponse } from 'next/server';
import { noCacheHeaders } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
import { loadAllVisits } from '@/lib/visitData';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // Visits belong to one of the two businesses, and each is gated separately.
  // Asking for the other project's visits is not a filter you can opt out of —
  // the permission for it simply isn't held.
  const project = url.searchParams.get('project') === 'reps' ? 'reps' : 'ba';
  const needed = project === 'reps'
    ? ['cc.schedule.view', 'cc.adherence.view']
    : ['ba.dashboard.view', 'ba.leaderboard.view', 'ba.scores.view'];

  const user = await requirePermission(req, needed);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noCacheHeaders() });

  try {
    const from = url.searchParams.get('from'); // YYYY-MM-DD
    const to = url.searchParams.get('to');     // YYYY-MM-DD

    let filtered = await loadAllVisits(project);
    if (from) filtered = filtered.filter(v => v.checkInDate >= from);
    if (to) filtered = filtered.filter(v => v.checkInDate <= to);

    return NextResponse.json(filtered, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('Visits GET error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
