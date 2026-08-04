'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, sessionHas } from '@/lib/useAuth';

/**
 * Landing page.
 *
 * The portal hosts two projects and most people only have one of them, so this
 * cannot just send everyone to the BA leaderboard — Sales would bounce straight
 * into a page they are not allowed to see. Send each user to the first thing
 * they actually hold a permission for.
 */
const DESTINATIONS: { perms: string[]; href: string }[] = [
  { perms: ['ba.leaderboard.view'], href: '/leaderboard' },
  { perms: ['ba.dashboard.view'], href: '/dashboard' },
  { perms: ['cc.schedule.view'], href: '/call-cycles' },
  { perms: ['cc.adherence.view'], href: '/call-cycles/adherence' },
  { perms: ['cc.planner.upload'], href: '/call-cycles/planner' },
  { perms: ['shared.stores.view'], href: '/admin/stores' },
  { perms: ['system.users.view'], href: '/users' },
];

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const session = getSession();
    if (!session) { router.replace('/login'); return; }

    const target = DESTINATIONS.find(d => sessionHas(session, d.perms));
    router.replace(target ? target.href : '/account');
  }, [router]);

  return (
    <div style={{ padding: '3rem', textAlign: 'center', color: '#6b7280', fontSize: '0.9rem' }}>
      Loading…
    </div>
  );
}
