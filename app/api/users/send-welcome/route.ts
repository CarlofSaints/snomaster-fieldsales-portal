import { NextRequest, NextResponse } from 'next/server';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import { loadUsers, saveUsers } from '@/lib/userData';
import { sendEmail, welcomeEmailHtml, WELCOME_SUBJECT } from '@/lib/email';
import bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const admin = await requireRole(req, ['admin', 'super_admin']);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { userId } = await req.json() as { userId: string };
    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    const users = await loadUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx < 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Generate random temp password
    const tempPassword = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 4).toUpperCase();
    const hash = await bcrypt.hash(tempPassword, 10);

    // Update user record
    users[idx] = { ...users[idx], passwordHash: hash, forcePasswordChange: true };
    await saveUsers(users);

    const user = users[idx];

    // Try sending email
    let emailSent = false;
    try {
      await sendEmail({
        to: user.email,
        subject: WELCOME_SUBJECT,
        html: welcomeEmailHtml({ name: user.name, email: user.email, password: tempPassword }),
      });
      emailSent = true;
    } catch {
      // Email failed — return temp password so admin can share manually
    }

    return NextResponse.json({
      ok: true,
      emailSent,
      ...(emailSent ? {} : { tempPassword }),
    }, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('Send welcome error:', err);
    return NextResponse.json({ error: 'Failed to send welcome email' }, { status: 500 });
  }
}
