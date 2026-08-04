import { NextRequest, NextResponse } from 'next/server';
import { requireLogin, noCacheHeaders } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/**
 * The caller's current identity and permissions, resolved fresh from their role.
 *
 * The browser calls this on every page load so that a session created before
 * the permission system existed, or one held open while an admin edited the
 * role on /roles, picks up the change instead of running on a stale copy.
 */
export async function GET(req: NextRequest) {
  const user = await requireLogin(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noCacheHeaders() });
  }

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    surname: user.surname,
    cellNumber: user.cellNumber || '',
    role: user.role,
    forcePasswordChange: user.forcePasswordChange,
    permissions: [...await getUserPermissions(user)],
  }, { headers: noCacheHeaders() });
}
