import { NextRequest, NextResponse } from 'next/server';
import { findRequestUser, noCacheHeaders } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { isActive, INACTIVE_MESSAGE } from '@/lib/accountStatus';

export const dynamic = 'force-dynamic';

/**
 * The caller's current identity and permissions, resolved fresh from their role.
 *
 * The browser calls this on every page load so that a session created before
 * the permission system existed, or one held open while an admin edited the
 * role on /roles, picks up the change instead of running on a stale copy.
 * It is also what evicts a user who was deactivated mid-session.
 */
export async function GET(req: NextRequest) {
  const user = await findRequestUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noCacheHeaders() });
  }

  // The one place that distinguishes a deactivated account from a signed-out
  // one, so the login screen can say why instead of looking like a session
  // that simply timed out.
  if (!isActive(user)) {
    return NextResponse.json({ error: INACTIVE_MESSAGE, inactive: true }, { status: 403, headers: noCacheHeaders() });
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
