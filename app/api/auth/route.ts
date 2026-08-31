import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { loadUsers } from '@/lib/userData';
import { isActive, INACTIVE_MESSAGE } from '@/lib/accountStatus';
import { noCacheHeaders } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { logActivity } from '@/lib/activityLog';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const users = await loadUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Checked AFTER the password on purpose: someone guessing at addresses must
    // not be able to learn which accounts exist by the wording of the refusal.
    if (!isActive(user)) {
      logActivity('user_login_blocked', user.email, `${user.name} ${user.surname}`, 'auth', `${user.name} ${user.surname} was refused login — account deactivated`).catch(() => {});
      return NextResponse.json({ error: INACTIVE_MESSAGE, inactive: true }, { status: 403, headers: noCacheHeaders() });
    }

    const session = {
      id: user.id,
      email: user.email,
      name: user.name,
      surname: user.surname,
      cellNumber: user.cellNumber || '',
      role: user.role,
      signOffNotice: user.signOffNotice === true,
      forcePasswordChange: user.forcePasswordChange,
      // Sent so the browser knows what to draw. It is NOT the security boundary
      // — every API route re-resolves permissions from the role server-side.
      permissions: [...await getUserPermissions(user)],
    };

    logActivity('user_login', user.email, `${user.name} ${user.surname}`, 'auth', `${user.name} ${user.surname} logged in`).catch(() => {});

    return NextResponse.json(session, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('Auth error:', err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
