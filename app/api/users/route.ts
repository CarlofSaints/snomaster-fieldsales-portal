import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { loadUsers, saveUsers, User } from '@/lib/userData';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import { sendEmail, welcomeEmailHtml, WELCOME_SUBJECT } from '@/lib/email';
import { logFromUser } from '@/lib/activityLog';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await requireRole(req, ['super_admin', 'admin']);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const users = await loadUsers();
  const safe = users.map(({ passwordHash: _, ...rest }) => rest);
  return NextResponse.json(safe, { headers: noCacheHeaders() });
}

export async function POST(req: NextRequest) {
  const user = await requireRole(req, ['super_admin', 'admin']);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { email, name, surname, role, password, forcePasswordChange, sendWelcomeEmail, cellNumber } = await req.json();
    if (!email || !name || !surname || !role) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const users = await loadUsers();
    if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
    }

    if (role === 'super_admin' && user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Cannot create super_admin' }, { status: 403 });
    }

    const tempPassword = password || Math.random().toString(36).slice(2, 10);
    const newUser: User = {
      id: crypto.randomUUID(),
      email,
      name,
      surname,
      cellNumber: cellNumber || undefined,
      passwordHash: await bcrypt.hash(tempPassword, 10),
      role,
      forcePasswordChange: forcePasswordChange !== false,
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    await saveUsers(users);

    // Send welcome email only if requested
    if (sendWelcomeEmail !== false) {
      try {
        await sendEmail({
          to: email,
          subject: WELCOME_SUBJECT,
          html: welcomeEmailHtml({ name, email, password: tempPassword }),
        });
      } catch (emailErr) {
        console.error('Welcome email failed:', emailErr);
      }
    }

    logFromUser(user, 'user_create', `user/${newUser.email}`, `Created user ${name} ${surname} (${email}) as ${role}`);
    const { passwordHash: _, ...safe } = newUser;
    return NextResponse.json(safe, { status: 201, headers: noCacheHeaders() });
  } catch (err) {
    console.error('Create user error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
