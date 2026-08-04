'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Role } from '@/lib/userData';
import { getSession } from '@/lib/useAuth';

interface NavItem {
  label: string;
  href: string;
  icon: string;
  /** Shown when the user holds ANY of these permissions. */
  perms: string[];
}

/* ── Navigation structure ──
 *
 * Every item is gated on a permission, never a role, so switching a whole
 * project off for a role (Sales sees no BA pages, Marketing sees no Call
 * Cycles) needs no change here. Empty groups hide themselves.
 */

const LEADERBOARD: NavItem = { label: 'Leaderboard', href: '/leaderboard', icon: '🏆', perms: ['ba.leaderboard.view'] };

const KPI_ITEMS: NavItem[] = [
  { label: 'Visit Analytics', href: '/dashboard', icon: '📊', perms: ['ba.dashboard.view'] },
  { label: 'Training', href: '/training', icon: '📋', perms: ['ba.kpi.training'] },
  { label: 'Sales & Stock', href: '/sales', icon: '💰', perms: ['ba.kpi.sales'] },
  { label: 'Display Maintenance', href: '/display-maintenance', icon: '🖥️', perms: ['ba.kpi.display'] },
  { label: 'Red Flags', href: '/red-flags', icon: '🚩', perms: ['ba.kpi.red_flags'] },
];

const CALL_CYCLE_ITEMS: NavItem[] = [
  { label: 'Schedule', href: '/call-cycles', icon: '🗓️', perms: ['cc.schedule.view'] },
  { label: 'Upload Planner', href: '/call-cycles/planner', icon: '📥', perms: ['cc.planner.upload'] },
  { label: 'Upload (other formats)', href: '/call-cycles/upload', icon: '📄', perms: ['cc.planner.upload'] },
  { label: 'Adherence', href: '/call-cycles/adherence', icon: '🎯', perms: ['cc.adherence.view'] },
  { label: 'Control Files', href: '/call-cycles/control-files', icon: '🗂️', perms: ['cc.control_files.manage'] },
];

const AFTER_KPI_ITEMS: NavItem[] = [
  { label: 'Score Entry', href: '/scores', icon: '✏️', perms: ['ba.scores.view', 'ba.scores.manage'] },
  { label: 'Reports', href: '/reports', icon: '📄', perms: ['ba.reports.view'] },
  { label: 'Scoring Guide', href: '/guide', icon: '📖', perms: ['ba.guide.view'] },
  { label: 'Site Guide', href: '/site-guide', icon: '📚', perms: ['shared.site_guide.view'] },
  { label: 'Activity Log', href: '/activity-log', icon: '📝', perms: ['shared.activity_log.view'] },
];

const ACCOUNT_ITEM: NavItem = { label: 'Account', href: '/account', icon: '👤', perms: [] };

const CONTROL_ITEMS: NavItem[] = [
  { label: 'Data Upload', href: '/upload', icon: '📤', perms: ['ba.upload.visits', 'ba.upload.dispo', 'ba.upload.training', 'ba.upload.targets', 'ba.upload.display', 'ba.upload.red_flags'] },
  { label: 'Reminders', href: '/reminders', icon: '🔔', perms: ['ba.reminders.view'] },
  { label: 'Sales Channels', href: '/admin/channels', icon: '📡', perms: ['system.channels.view'] },
  { label: 'Stores', href: '/admin/stores', icon: '🏪', perms: ['shared.stores.view'] },
  { label: 'Products', href: '/admin/products', icon: '📦', perms: ['ba.products.manage'] },
  { label: 'BA Management', href: '/bas', icon: '🧑‍💼', perms: ['ba.bas.view'] },
  { label: 'Users', href: '/users', icon: '👥', perms: ['system.users.view'] },
  { label: 'KPI Controls', href: '/kpi-controls', icon: '🎯', perms: ['ba.kpi_controls.view'] },
  { label: 'Week Mapping', href: '/week-mapping', icon: '📅', perms: ['ba.week_mapping.manage'] },
  { label: 'Roles', href: '/roles', icon: '🔑', perms: ['system.roles.manage'] },
  { label: 'Settings', href: '/settings', icon: '⚙️', perms: ['system.settings.view'] },
];

const SIDEBAR_KEY = 'snomaster_sidebar_open';
const CONTROL_KEY = 'snomaster_control_open';
const KPI_KEY = 'snomaster_kpi_open';
const CYCLE_KEY = 'snomaster_cycle_open';
const SIDEBAR_W = 240;
const TOPBAR_H = 52;

interface SidebarProps {
  role: Role;
  name: string;
  onLogout: () => void;
  /**
   * The signed-in user's permissions. Optional so existing callers keep
   * compiling; when omitted the sidebar reads them from the stored session,
   * which is where every page gets them anyway.
   */
  permissions?: string[];
}

function BurgerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export default function Sidebar({ role, name, onLogout, permissions }: SidebarProps) {
  const pathname = usePathname();

  const held = useMemo(() => {
    const list = permissions ?? getSession()?.permissions;
    return list ? new Set(list) : null;
  }, [permissions]);

  const can = useCallback((item: NavItem) => {
    if (item.perms.length === 0) return true;
    // A session predating the permission system has no list; fall back to the
    // old role behaviour so an open tab degrades rather than emptying the menu.
    if (!held) return role === 'super_admin' || role === 'admin';
    return item.perms.some(p => held.has(p));
  }, [held, role]);

  const visibleKPIItems = KPI_ITEMS.filter(can);
  const visibleCycleItems = CALL_CYCLE_ITEMS.filter(can);
  const visibleAfterKPI = AFTER_KPI_ITEMS.filter(can);
  const visibleControlItems = CONTROL_ITEMS.filter(can);
  const showControlCentre = visibleControlItems.length > 0;
  const showLeaderboard = can(LEADERBOARD);
  const showAccount = true;

  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem(SIDEBAR_KEY) !== 'false';
  });

  const [controlOpen, setControlOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem(CONTROL_KEY);
    if (stored !== null) return stored !== 'false';
    return role === 'super_admin' || role === 'admin';
  });

  const [kpiOpen, setKpiOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem(KPI_KEY);
    if (stored !== null) return stored !== 'false';
    return true;
  });

  const [cycleOpen, setCycleOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem(CYCLE_KEY);
    if (stored !== null) return stored !== 'false';
    return false;
  });

  // Sync body data attribute for CSS margin/padding rules
  useEffect(() => {
    document.body.dataset.sidebarClosed = String(!open);
  }, [open]);

  function toggle() {
    setOpen(prev => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  }

  function toggleControl() {
    setControlOpen(prev => {
      const next = !prev;
      localStorage.setItem(CONTROL_KEY, String(next));
      return next;
    });
  }

  function toggleKpi() {
    setKpiOpen(prev => {
      const next = !prev;
      localStorage.setItem(KPI_KEY, String(next));
      return next;
    });
  }

  function toggleCycle() {
    setCycleOpen(prev => {
      const next = !prev;
      localStorage.setItem(CYCLE_KEY, String(next));
      return next;
    });
  }

  function renderNavItem(item: NavItem, indent?: boolean) {
    const active = pathname === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          padding: indent ? '0.5rem 0.75rem 0.5rem 1.75rem' : '0.6rem 0.75rem',
          borderRadius: 8,
          color: active ? '#fff' : 'rgba(255,255,255,0.65)',
          background: active ? '#e31e1c' : 'transparent',
          textDecoration: 'none',
          fontSize: indent ? '0.82rem' : '0.85rem',
          fontWeight: active ? 600 : 400,
          marginBottom: 2,
          transition: 'background 0.15s, color 0.15s',
        }}
        onMouseEnter={e => {
          if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)';
        }}
        onMouseLeave={e => {
          if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent';
        }}
      >
        <span style={{ fontSize: indent ? '0.9rem' : '1rem' }}>{item.icon}</span>
        {item.label}
      </Link>
    );
  }

  // Check if any KPI sub-item is currently active (for highlighting the parent)
  const kpiActive = KPI_ITEMS.some(item => pathname === item.href);
  const cycleActive = CALL_CYCLE_ITEMS.some(item => pathname === item.href);

  return (
    <>
      {/* Top bar — visible when sidebar is closed */}
      {!open && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: TOPBAR_H,
            background: '#1a1a1a',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0 1rem',
            zIndex: 101,
            boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
          }}
        >
          <button
            onClick={toggle}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
            title="Open menu"
          >
            <BurgerIcon />
          </button>
          <img
            src="/snomaster-logo.png"
            alt="SnoMaster"
            style={{ height: 28, objectFit: 'contain' }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.7rem' }}>BA Measurement</span>
        </div>
      )}

      {/* Sidebar drawer */}
      <aside
        style={{
          width: SIDEBAR_W,
          minHeight: '100vh',
          background: '#1a1a1a',
          display: 'flex',
          flexDirection: 'column',
          position: 'fixed',
          left: open ? 0 : -SIDEBAR_W,
          top: 0,
          bottom: 0,
          zIndex: 102,
          transition: 'left 0.25s ease',
        }}
      >
        {/* Logo + burger toggle */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <img
              src="/snomaster-logo.png"
              alt="SnoMaster"
              style={{ width: 160, objectFit: 'contain' }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.7rem', marginTop: 4 }}>
              BA Measurement
            </div>
          </div>
          <button
            onClick={toggle}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}
            title="Close menu"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '0.75rem 0.5rem', overflowY: 'auto' }}>
          {/* Leaderboard */}
          {showLeaderboard && renderNavItem(LEADERBOARD)}

          {/* KPIs — collapsible */}
          {visibleKPIItems.length > 0 && (
            <>
              <div style={{ marginTop: '0.25rem', marginBottom: '0.15rem' }}>
                <button
                  onClick={toggleKpi}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    width: '100%',
                    padding: '0.6rem 0.75rem',
                    background: kpiActive && !kpiOpen ? 'rgba(227,30,28,0.25)' : 'none',
                    border: 'none',
                    color: kpiActive ? '#fff' : 'rgba(255,255,255,0.65)',
                    fontSize: '0.85rem',
                    fontWeight: kpiActive ? 600 : 400,
                    cursor: 'pointer',
                    borderRadius: 8,
                    transition: 'background 0.15s, color 0.15s',
                    textAlign: 'left',
                  }}
                  onMouseEnter={e => {
                    if (!kpiActive || kpiOpen) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = kpiActive && !kpiOpen ? 'rgba(227,30,28,0.25)' : 'transparent';
                  }}
                >
                  <span style={{ fontSize: '1rem' }}>📈</span>
                  <span style={{ flex: 1 }}>KPIs</span>
                  <ChevronIcon open={kpiOpen} />
                </button>
              </div>
              {kpiOpen && (
                <div>
                  {visibleKPIItems.map(item => renderNavItem(item, true))}
                </div>
              )}
            </>
          )}

          {/* Call Cycles — collapsible */}
          {visibleCycleItems.length > 0 && (
            <>
              <div style={{ marginTop: '0.25rem', marginBottom: '0.15rem' }}>
                <button
                  onClick={toggleCycle}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    width: '100%',
                    padding: '0.6rem 0.75rem',
                    background: cycleActive && !cycleOpen ? 'rgba(227,30,28,0.25)' : 'none',
                    border: 'none',
                    color: cycleActive ? '#fff' : 'rgba(255,255,255,0.65)',
                    fontSize: '0.85rem',
                    fontWeight: cycleActive ? 600 : 400,
                    cursor: 'pointer',
                    borderRadius: 8,
                    transition: 'background 0.15s, color 0.15s',
                    textAlign: 'left',
                  }}
                  onMouseEnter={e => {
                    if (!cycleActive || cycleOpen) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = cycleActive && !cycleOpen ? 'rgba(227,30,28,0.25)' : 'transparent';
                  }}
                >
                  <span style={{ fontSize: '1rem' }}>🔁</span>
                  <span style={{ flex: 1 }}>Call Cycles</span>
                  <ChevronIcon open={cycleOpen} />
                </button>
              </div>
              {cycleOpen && (
                <div>
                  {visibleCycleItems.map(item => renderNavItem(item, true))}
                </div>
              )}
            </>
          )}

          {/* Score Entry + Scoring Guide */}
          {visibleAfterKPI.length > 0 && (
            <div style={{ marginTop: '0.25rem' }}>
              {visibleAfterKPI.map(item => renderNavItem(item))}
            </div>
          )}

          {/* Control Centre — collapsible */}
          {showControlCentre && (
            <>
              <div style={{ marginTop: '0.75rem', marginBottom: '0.25rem' }}>
                <button
                  onClick={toggleControl}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    background: 'none',
                    border: 'none',
                    color: 'rgba(255,255,255,0.45)',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    borderRadius: 6,
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.45)'; }}
                >
                  <ChevronIcon open={controlOpen} />
                  Control Centre
                </button>
              </div>
              {controlOpen && (
                <div style={{ paddingLeft: '0.25rem' }}>
                  {visibleControlItems.map(item => renderNavItem(item))}
                </div>
              )}
            </>
          )}
        </nav>

        {/* Atomic Marketing section */}
        <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.6rem', marginBottom: 8, letterSpacing: '0.03em' }}>
            An Atomic Marketing Initiative
          </div>
          <div style={{ background: 'white', borderRadius: 8, padding: '6px 12px', display: 'inline-block' }}>
            <img
              src="/atomic-logo.png"
              alt="Atomic Marketing"
              style={{ height: 24, objectFit: 'contain', display: 'block' }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
        </div>

        {/* User footer with Account link */}
        <div
          style={{
            padding: '0.75rem 1rem',
            borderTop: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.7)',
            fontSize: '0.8rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontWeight: 500, color: '#fff' }}>{name}</div>
            {showAccount && (
              <Link
                href="/account"
                style={{
                  color: pathname === '/account' ? '#fff' : 'rgba(255,255,255,0.5)',
                  fontSize: '0.75rem',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: pathname === '/account' ? 'rgba(227,30,28,0.4)' : 'transparent',
                  transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={e => {
                  if (pathname !== '/account') {
                    (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)';
                    (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.8)';
                  }
                }}
                onMouseLeave={e => {
                  if (pathname !== '/account') {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                    (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.5)';
                  }
                }}
              >
                <span style={{ fontSize: '0.85rem' }}>👤</span>
                Account
              </Link>
            )}
          </div>
          <div style={{ marginBottom: 8, textTransform: 'capitalize' }}>{role.replace('_', ' ')}</div>
          <button
            onClick={onLogout}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: 'rgba(255,255,255,0.7)',
              padding: '0.35rem 0.75rem',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: '0.75rem',
              width: '100%',
            }}
          >
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}
