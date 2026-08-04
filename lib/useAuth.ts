'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from './userData';

export interface Session {
  id: string;
  email: string;
  name: string;
  surname: string;
  cellNumber?: string;
  role: Role;
  forcePasswordChange: boolean;
  /**
   * What this user may do, resolved from their role. Used only to decide what
   * to render — the server re-checks on every request, so a doctored copy in
   * localStorage gains nothing.
   */
  permissions?: string[];
}

const SESSION_KEY = 'snomaster_session';

/** Read the session without any of the redirect behaviour. */
export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) as Session : null;
  } catch {
    return null;
  }
}

export function sessionHas(session: Session | null, permission: string | string[]): boolean {
  if (!session) return false;
  // A session predating the permission system has no list. Fall back to the
  // role so an open tab degrades to the old behaviour rather than locking the
  // user out of everything until they sign in again.
  if (!session.permissions) return session.role === 'super_admin' || session.role === 'admin';
  const wanted = Array.isArray(permission) ? permission : [permission];
  return wanted.some(p => session.permissions!.includes(p));
}

/**
 * Guard a page.
 *
 * Pass a permission key (or several — ANY of them admits) to gate the page.
 * Anyone without it is sent to the landing page, which routes them to whichever
 * project they do have access to.
 */
export function useAuth(requiredPermission?: string | string[]) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Array literals create a new reference each render, which would re-trigger
  // the effect forever. Collapse to a stable string.
  const permKey = requiredPermission
    ? (Array.isArray(requiredPermission) ? requiredPermission.join(',') : requiredPermission)
    : '';

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const stored = getSession();
      if (!stored) {
        router.replace('/login');
        return;
      }

      if (stored.forcePasswordChange && window.location.pathname !== '/account') {
        router.replace('/account?change-password=1');
        setLoading(false);
        return;
      }

      // Re-resolve permissions from the server so role edits take effect without
      // a re-login, and so pre-permission sessions get a real list.
      let live: Session = stored;
      try {
        const res = await fetch('/api/me', {
          headers: { 'x-user-id': stored.id },
          cache: 'no-store',
        });
        if (res.ok) {
          live = await res.json();
          localStorage.setItem(SESSION_KEY, JSON.stringify(live));
        } else if (res.status === 401) {
          localStorage.removeItem(SESSION_KEY);
          router.replace('/login');
          return;
        }
      } catch {
        // Offline or a blip — carry on with the stored copy.
      }

      if (cancelled) return;

      if (permKey && !sessionHas(live, permKey.split(','))) {
        router.replace('/');
        setLoading(false);
        return;
      }

      setSession(live);
      setLoading(false);
    }

    run();
    return () => { cancelled = true; };
  }, [router, permKey]);

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    router.push('/login');
  }, [router]);

  const can = useCallback(
    (permission: string | string[]) => sessionHas(session, permission),
    [session],
  );

  return { session, loading, logout, setSession, can };
}

export function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const userId = getSession()?.id ?? '';
  const headers = new Headers(init.headers);
  if (userId) headers.set('x-user-id', userId);
  return fetch(input, { ...init, headers, cache: 'no-store' });
}
