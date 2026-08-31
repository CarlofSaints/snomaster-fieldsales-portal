'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getSession, SESSION_EVENT } from '@/lib/useAuth';
import { INACTIVE_MESSAGE } from '@/lib/accountStatus';

/**
 * The sign-off notice, shown in-app to a user who can still sign in.
 *
 * The same sentence a deactivated user meets at the login screen, except this
 * one reaches someone still working — the warning before access is withdrawn.
 *
 * Mounted once in the root layout so it covers every page without each one
 * having to remember it. It reads the session that useAuth has already
 * refreshed from /api/me rather than fetching again, and re-reads on
 * SESSION_EVENT so switching the notice on or off takes effect on the user's
 * next page load without them signing out.
 */

/** Pages with no session and no sidebar — the login screen has its own banner. */
const HIDDEN_ON = ['/login', '/reset-password'];

export default function SignOffNotice() {
  const [show, setShow] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const read = () => setShow(getSession()?.signOffNotice === true);
    read();
    // 'storage' covers the same user's other tabs; SESSION_EVENT covers this one.
    window.addEventListener(SESSION_EVENT, read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener(SESSION_EVENT, read);
      window.removeEventListener('storage', read);
    };
  }, [pathname]);

  const visible = show && !HIDDEN_ON.includes(pathname);

  // Tells globals.css that the gap under a closed sidebar is already taken
  // care of here, so main must not add it a second time.
  useEffect(() => {
    if (visible) {
      document.body.dataset.accountNotice = 'true';
      return () => { delete document.body.dataset.accountNotice; };
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="account-notice">
      <div
        role="alert"
        style={{
          display: 'flex',
          gap: '0.6rem',
          alignItems: 'flex-start',
          background: '#fff7f7',
          borderBottom: '1px solid #fecaca',
          borderLeft: '4px solid #e31e1c',
          padding: '0.7rem 2rem',
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#e31e1c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p style={{ margin: 0, fontSize: '0.82rem', color: '#7f1d1d', lineHeight: 1.5 }}>
          {INACTIVE_MESSAGE}
        </p>
      </div>
    </div>
  );
}
