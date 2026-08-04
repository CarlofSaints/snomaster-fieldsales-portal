'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth, authFetch } from '@/lib/useAuth';
import Sidebar from '@/components/Sidebar';
import Footer from '@/components/Footer';

interface Metrics {
  expectedVisits: number;
  accurateHits: number;
  accurateHitRate: number;
  scheduledStores: number;
  visitedStores: number;
  storesVisitedPct: number;
  missedStores: number;
  missedPct: number;
  totalVisits: number;
  unscheduledVisits: number;
  unscheduledPct: number;
}

interface UserRow extends Metrics {
  email: string;
  name: string;
  teamLeader: string;
}

interface AdherenceResponse {
  from: string;
  to: string;
  totals: Metrics;
  byUser: Record<string, UserRow>;
  byTeamLeader: Record<string, Metrics>;
  byChannel: Record<string, Metrics>;
}

type SortKey = 'name' | 'accurateHitRate' | 'storesVisitedPct' | 'missedPct' | 'unscheduledPct' | 'scheduledStores';

/** Green when high is good, red when low. `invert` for metrics where low is good. */
function pctStyle(pct: number, invert = false): React.CSSProperties {
  const good = invert ? pct <= 10 : pct >= 80;
  const mid = invert ? pct <= 25 : pct >= 60;
  const c = good
    ? { background: '#d1fae5', color: '#065f46' }
    : mid
      ? { background: '#fef3c7', color: '#92400e' }
      : { background: '#fee2e2', color: '#991b1b' };
  return { ...c, padding: '2px 8px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700, display: 'inline-block', minWidth: 42, textAlign: 'center' };
}

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function today(): string {
  return new Date().toISOString().split('T')[0];
}

export default function AdherencePage() {
  const { session, loading: authLoading, logout } = useAuth('cc.adherence.view');
  const [data, setData] = useState<AdherenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [sortKey, setSortKey] = useState<SortKey>('accurateHitRate');
  const [sortDesc, setSortDesc] = useState(true);

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch(`/api/call-cycles/adherence?from=${f}&to=${t}`);
      if (res.ok) setData(await res.json());
      else setError((await res.json().catch(() => ({}))).error || 'Failed to load adherence');
    } catch {
      setError('Failed to load adherence');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (session) load(from, to); }, [session, load, from, to]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDesc(d => !d);
    else { setSortKey(key); setSortDesc(true); }
  }

  const users = data ? Object.values(data.byUser) : [];
  const sorted = [...users].sort((a, b) => {
    const dir = sortDesc ? -1 : 1;
    if (sortKey === 'name') return a.name.localeCompare(b.name) * -dir;
    return ((a[sortKey] as number) - (b[sortKey] as number)) * dir;
  });

  if (authLoading || !session) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>Loading...</div>;
  }

  const th: React.CSSProperties = {
    textAlign: 'left', padding: '0.5rem 0.6rem', fontSize: '0.7rem', fontWeight: 700,
    color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em',
    borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
  };
  const td: React.CSSProperties = {
    padding: '0.5rem 0.6rem', fontSize: '0.8rem', color: '#374151', borderBottom: '1px solid #f3f4f6',
  };

  const kpis = data ? [
    { label: 'Accurate hit rate', value: `${data.totals.accurateHitRate}%`, sub: `${data.totals.accurateHits} of ${data.totals.expectedVisits} expected visits on the exact day`, tone: data.totals.accurateHitRate >= 80 ? 'good' : data.totals.accurateHitRate >= 60 ? 'mid' : 'bad' },
    { label: 'Stores visited', value: `${data.totals.storesVisitedPct}%`, sub: `${data.totals.visitedStores} of ${data.totals.scheduledStores} scheduled stores seen at least once`, tone: data.totals.storesVisitedPct >= 80 ? 'good' : data.totals.storesVisitedPct >= 60 ? 'mid' : 'bad' },
    { label: 'Missed', value: `${data.totals.missedPct}%`, sub: `${data.totals.missedStores} scheduled stores never visited`, tone: data.totals.missedPct <= 10 ? 'good' : data.totals.missedPct <= 25 ? 'mid' : 'bad' },
    { label: 'Unscheduled', value: `${data.totals.unscheduledPct}%`, sub: `${data.totals.unscheduledVisits} of ${data.totals.totalVisits} visits were to stores not in the cycle`, tone: data.totals.unscheduledPct <= 10 ? 'good' : data.totals.unscheduledPct <= 25 ? 'mid' : 'bad' },
  ] : [];

  const toneBg: Record<string, { bg: string; border: string; fg: string }> = {
    good: { bg: '#f0fdf4', border: '#bbf7d0', fg: '#065f46' },
    mid: { bg: '#fffbeb', border: '#fde68a', fg: '#92400e' },
    bad: { bg: '#fef2f2', border: '#fecaca', fg: '#991b1b' },
  };

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar role={session.role} name={`${session.name} ${session.surname}`} onLogout={logout} />
      <main style={{ flex: 1, padding: '2rem', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: '0.5rem' }}>
          <Link href="/call-cycles" style={{ fontSize: '0.78rem', color: '#e31e1c', textDecoration: 'none' }}>&larr; Back to Call Cycles</Link>
        </div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#111827', marginBottom: '0.25rem' }}>
          Call Cycle Adherence
        </h1>
        <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: '1.25rem', maxWidth: 800 }}>
          Measures the loaded call cycle against the actual Perigee visit history already in SnoMaster.
          Expected dates are generated from each row&apos;s cycle weeks and days — &quot;Week 1&amp;3&quot; +
          Monday means the 1st and 3rd Monday of each month. The end of the range is capped at today so
          future visits never count as missed.
        </p>

        {/* Date range */}
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.78rem', color: '#6b7280' }}>From</label>
          <input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ fontSize: '0.82rem', maxWidth: 160 }} />
          <label style={{ fontSize: '0.78rem', color: '#6b7280' }}>To</label>
          <input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} style={{ fontSize: '0.82rem', maxWidth: 160 }} />
          <button className="btn btn-outline" onClick={() => { setFrom(firstOfMonth()); setTo(today()); }} style={{ fontSize: '0.78rem' }}>
            This month
          </button>
        </div>

        {error && (
          <div style={{ padding: '0.7rem 1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: '0.82rem', color: '#991b1b', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>Calculating…</div>
        ) : !data || data.totals.scheduledStores === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: '#6b7280', border: '1px dashed #d1d5db', borderRadius: 10 }}>
            <p style={{ fontWeight: 600, color: '#374151' }}>Nothing to measure yet.</p>
            <p style={{ fontSize: '0.85rem', marginTop: 6 }}>
              Load a call cycle first — adherence compares it against the visit history.
            </p>
          </div>
        ) : (
          <>
            {/* KPI cards */}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
              {kpis.map(k => {
                const t = toneBg[k.tone];
                return (
                  <div key={k.label} style={{
                    flex: '1 1 200px', minWidth: 200, padding: '0.9rem 1.1rem', borderRadius: 10,
                    background: t.bg, border: `1px solid ${t.border}`,
                  }}>
                    <div style={{ fontSize: '1.6rem', fontWeight: 700, color: t.fg }}>{k.value}</div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.03em', marginTop: 2 }}>{k.label}</div>
                    <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 4 }}>{k.sub}</div>
                  </div>
                );
              })}
            </div>

            {/* Per rep */}
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#111827', marginBottom: '0.6rem' }}>By rep</h2>
            <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: '1.5rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white' }}>
                <thead>
                  <tr>
                    <th style={th} onClick={() => toggleSort('name')}>Rep</th>
                    <th style={th}>Team leader</th>
                    <th style={th} onClick={() => toggleSort('scheduledStores')}>Stores</th>
                    <th style={th} onClick={() => toggleSort('accurateHitRate')}>Accurate hit</th>
                    <th style={th} onClick={() => toggleSort('storesVisitedPct')}>Visited</th>
                    <th style={th} onClick={() => toggleSort('missedPct')}>Missed</th>
                    <th style={th} onClick={() => toggleSort('unscheduledPct')}>Unscheduled</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(u => (
                    <tr key={u.email}>
                      <td style={td}>
                        <div style={{ fontWeight: 600, color: '#111827' }}>{u.name || u.email}</div>
                        <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>{u.email}</div>
                      </td>
                      <td style={{ ...td, fontSize: '0.75rem', color: '#6b7280' }}>{u.teamLeader || '—'}</td>
                      <td style={td}>{u.scheduledStores}</td>
                      <td style={td}>
                        <span style={pctStyle(u.accurateHitRate)}>{u.accurateHitRate}%</span>
                        <span style={{ fontSize: '0.7rem', color: '#9ca3af', marginLeft: 6 }}>{u.accurateHits}/{u.expectedVisits}</span>
                      </td>
                      <td style={td}><span style={pctStyle(u.storesVisitedPct)}>{u.storesVisitedPct}%</span></td>
                      <td style={td}><span style={pctStyle(u.missedPct, true)}>{u.missedPct}%</span></td>
                      <td style={td}><span style={pctStyle(u.unscheduledPct, true)}>{u.unscheduledPct}%</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Per channel */}
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#111827', marginBottom: '0.6rem' }}>By channel</h2>
            <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white' }}>
                <thead>
                  <tr>
                    <th style={{ ...th, cursor: 'default' }}>Channel</th>
                    <th style={{ ...th, cursor: 'default' }}>Stores</th>
                    <th style={{ ...th, cursor: 'default' }}>Accurate hit</th>
                    <th style={{ ...th, cursor: 'default' }}>Visited</th>
                    <th style={{ ...th, cursor: 'default' }}>Missed</th>
                    <th style={{ ...th, cursor: 'default' }}>Unscheduled</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.byChannel).sort((a, b) => a[0].localeCompare(b[0])).map(([ch, m]) => (
                    <tr key={ch}>
                      <td style={{ ...td, fontWeight: 600, color: '#111827' }}>{ch}</td>
                      <td style={td}>{m.scheduledStores}</td>
                      <td style={td}><span style={pctStyle(m.accurateHitRate)}>{m.accurateHitRate}%</span></td>
                      <td style={td}><span style={pctStyle(m.storesVisitedPct)}>{m.storesVisitedPct}%</span></td>
                      <td style={td}><span style={pctStyle(m.missedPct, true)}>{m.missedPct}%</span></td>
                      <td style={td}><span style={pctStyle(m.unscheduledPct, true)}>{m.unscheduledPct}%</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <Footer />
      </main>
    </div>
  );
}
