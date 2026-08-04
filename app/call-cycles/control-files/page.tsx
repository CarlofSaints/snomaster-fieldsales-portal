'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useAuth, authFetch } from '@/lib/useAuth';
import { uploadStoreControl, type StoreControlProgress } from '@/lib/callcycle/uploadStoreControl';
import Sidebar from '@/components/Sidebar';
import Toast from '@/components/Toast';
import Footer from '@/components/Footer';

interface StoreStatus {
  loaded: boolean;
  totalStores?: number;
  activeStores?: number;
  channels?: string[];
  uploadedAt?: string;
  uploadedBy?: string;
}

interface TeamStatus {
  loaded: boolean;
  totalMembers?: number;
  withUserId?: number;
  teams?: string[];
  uploadedAt?: string;
  uploadedBy?: string;
}

type Mode = 'replace' | 'merge';

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function ControlFilesPage() {
  const { session, loading: authLoading, logout } = useAuth(['super_admin', 'admin']);
  const [storeStatus, setStoreStatus] = useState<StoreStatus | null>(null);
  const [teamStatus, setTeamStatus] = useState<TeamStatus | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const [storeMode, setStoreMode] = useState<Mode>('replace');
  const [teamMode, setTeamMode] = useState<Mode>('replace');
  const [busy, setBusy] = useState<'store' | 'team' | null>(null);
  const [progress, setProgress] = useState<StoreControlProgress | null>(null);

  const storeInput = useRef<HTMLInputElement>(null);
  const teamInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([
        authFetch('/api/call-cycles/control-files/stores'),
        authFetch('/api/call-cycles/control-files/teams'),
      ]);
      setStoreStatus(s.ok ? await s.json() : { loaded: false });
      setTeamStatus(t.ok ? await t.json() : { loaded: false });
    } catch {
      setStoreStatus({ loaded: false });
      setTeamStatus({ loaded: false });
    }
  }, []);

  useEffect(() => { if (session) load(); }, [session, load]);

  async function upload(kind: 'store' | 'team', file: File) {
    setBusy(kind);
    setProgress(null);
    try {
      // The store export blows past the ~4.5 MB serverless body limit, so it is
      // parsed here in the browser and streamed up gzipped and chunked. The team
      // file is small, so it still posts as a plain upload.
      if (kind === 'store') {
        const result = await uploadStoreControl(file, storeMode, setProgress);
        if (result.ok) {
          setToast({ msg: `Store control loaded — ${result.totalStores?.toLocaleString()} stores (${result.activeStores?.toLocaleString()} active)`, type: 'success' });
          load();
        } else {
          setToast({ msg: result.error || 'Upload failed', type: 'error' });
        }
        return;
      }

      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', teamMode);
      const res = await authFetch('/api/call-cycles/control-files/teams', { method: 'POST', body: fd });
      const data = await res.json();
      if (res.ok) {
        setToast({ msg: `Team control loaded — ${data.totalMembers} members, ${data.withUserId} with a Perigee USER ID`, type: 'success' });
        load();
      } else {
        setToast({ msg: data.error || 'Upload failed', type: 'error' });
      }
    } catch (err) {
      setToast({ msg: err instanceof Error ? err.message : 'Upload failed', type: 'error' });
    } finally {
      setBusy(null);
      setProgress(null);
      if (kind === 'store' && storeInput.current) storeInput.current.value = '';
      if (kind === 'team' && teamInput.current) teamInput.current.value = '';
    }
  }

  async function clearFile(kind: 'store' | 'team') {
    const label = kind === 'store' ? 'store control file' : 'team control file';
    if (!confirm(`Delete the ${label}? Call cycle uploads will fall back to weaker matching until you load it again.`)) return;
    const url = kind === 'store'
      ? '/api/call-cycles/control-files/stores'
      : '/api/call-cycles/control-files/teams';
    const res = await authFetch(url, { method: 'DELETE' });
    if (res.ok) {
      setToast({ msg: `Cleared the ${label}`, type: 'success' });
      load();
    } else {
      setToast({ msg: 'Clear failed', type: 'error' });
    }
  }

  if (authLoading || !session) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>Loading...</div>;
  }

  const card: React.CSSProperties = {
    background: 'white', border: '1px solid #e5e7eb', borderRadius: 12,
    padding: '1.25rem', marginBottom: '1.25rem',
  };

  function modeToggle(value: Mode, set: (m: Mode) => void) {
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        {(['replace', 'merge'] as Mode[]).map(m => (
          <button key={m} className="btn" onClick={() => set(m)}
            style={{
              fontSize: '0.72rem', padding: '0.25rem 0.6rem',
              background: value === m ? '#e31e1c' : '#f3f4f6',
              color: value === m ? 'white' : '#374151',
              border: '1px solid ' + (value === m ? '#e31e1c' : '#e5e7eb'),
            }}>
            {m === 'replace' ? 'Replace all' : 'Merge'}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar role={session.role} name={`${session.name} ${session.surname}`} onLogout={logout} />
      <main style={{ flex: 1, padding: '2rem', minHeight: '100vh', display: 'flex', flexDirection: 'column', maxWidth: 1000 }}>
        <div style={{ marginBottom: '0.5rem' }}>
          <Link href="/call-cycles" style={{ fontSize: '0.78rem', color: '#e31e1c', textDecoration: 'none' }}>&larr; Back to Call Cycles</Link>
        </div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#111827', marginBottom: '0.25rem' }}>
          Perigee Control Files
        </h1>
        <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: '1.25rem', maxWidth: 780 }}>
          These two files are exported straight out of the Perigee portal. They are what make a built
          call cycle actually load back into Perigee — a site code is only unique <em>within</em> a
          channel, and the upload template requires each user&apos;s Perigee USER ID.
        </p>

        {/* Store control */}
        <section style={card}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 280 }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#111827' }}>Store control file</h2>
              <p style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 4 }}>
                Every site Perigee knows, with its code and channel. Needs at minimum a{' '}
                <strong>STORE CODE</strong> and <strong>STORE NAME</strong> column; CHANNEL, ACTIVE,
                PROVINCE and the rest are read when present. <strong>Any size is fine</strong> — the
                file is parsed in your browser and streamed up in pieces, so it never hits the
                server&apos;s upload limit.
              </p>
            </div>
            <div style={{
              padding: '0.5rem 0.9rem', borderRadius: 8, minWidth: 150,
              background: storeStatus?.loaded ? '#f0fdf4' : '#fffbeb',
              border: `1px solid ${storeStatus?.loaded ? '#bbf7d0' : '#fde68a'}`,
            }}>
              {storeStatus?.loaded ? (
                <>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#065f46' }}>{storeStatus.totalStores}</div>
                  <div style={{ fontSize: '0.68rem', color: '#047857' }}>stores ({storeStatus.activeStores} active)</div>
                </>
              ) : (
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#92400e' }}>Not loaded</div>
              )}
            </div>
          </div>

          {storeStatus?.loaded && (
            <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.75rem' }}>
              Uploaded {fmtDate(storeStatus.uploadedAt)} by {storeStatus.uploadedBy || '—'}
              {storeStatus.channels && storeStatus.channels.length > 0 && (
                <> &middot; Channels: {storeStatus.channels.join(', ')}</>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginTop: '1rem', flexWrap: 'wrap' }}>
            {modeToggle(storeMode, setStoreMode)}
            <input ref={storeInput} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) upload('store', f); }} />
            <button className="btn btn-primary" onClick={() => storeInput.current?.click()} disabled={busy === 'store'} style={{ fontSize: '0.8rem' }}>
              {busy === 'store' ? 'Uploading…' : 'Upload store control'}
            </button>
            {busy === 'store' && progress && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.76rem', color: '#6b7280' }}>
                <span style={{ display: 'inline-block', width: 120, height: 6, background: '#f3f4f6', borderRadius: 3, overflow: 'hidden' }}>
                  <span style={{
                    display: 'block', height: '100%', background: '#e31e1c', borderRadius: 3,
                    width: progress.percent === null ? '30%' : `${progress.percent}%`,
                    transition: 'width 0.2s',
                  }} />
                </span>
                {progress.detail}
              </span>
            )}
            <a href="/api/call-cycles/templates?type=store" className="btn btn-outline" style={{ fontSize: '0.8rem', textDecoration: 'none' }}>Template</a>
            {storeStatus?.loaded && (
              <button className="btn btn-outline" onClick={() => clearFile('store')} style={{ fontSize: '0.8rem', color: '#dc2626' }}>Clear</button>
            )}
          </div>
        </section>

        {/* Team control */}
        <section style={card}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 280 }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#111827' }}>Team control file</h2>
              <p style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 4 }}>
                Every user, their Perigee <strong>USER ID</strong>, and their team leader. Needs at
                minimum <strong>TEAM NAME</strong> and <strong>MEMBER EMAIL</strong>; without MEMBER ID
                the exported workbook has a blank USER ID column and Perigee will reject it.
              </p>
            </div>
            <div style={{
              padding: '0.5rem 0.9rem', borderRadius: 8, minWidth: 150,
              background: teamStatus?.loaded ? '#f0fdf4' : '#fffbeb',
              border: `1px solid ${teamStatus?.loaded ? '#bbf7d0' : '#fde68a'}`,
            }}>
              {teamStatus?.loaded ? (
                <>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#065f46' }}>{teamStatus.totalMembers}</div>
                  <div style={{ fontSize: '0.68rem', color: '#047857' }}>members ({teamStatus.withUserId} with USER ID)</div>
                </>
              ) : (
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#92400e' }}>Not loaded</div>
              )}
            </div>
          </div>

          {teamStatus?.loaded && (
            <>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.75rem' }}>
                Uploaded {fmtDate(teamStatus.uploadedAt)} by {teamStatus.uploadedBy || '—'}
                {teamStatus.teams && teamStatus.teams.length > 0 && (
                  <> &middot; Teams: {teamStatus.teams.join(', ')}</>
                )}
              </div>
              {typeof teamStatus.withUserId === 'number' && teamStatus.withUserId < (teamStatus.totalMembers || 0) && (
                <div style={{ padding: '0.55rem 0.9rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: '0.78rem', color: '#92400e', marginTop: '0.75rem' }}>
                  {(teamStatus.totalMembers || 0) - teamStatus.withUserId} member(s) have no Perigee USER ID.
                  Their rows will export with a blank USER ID — re-export the file from Perigee with the
                  MEMBER ID column included.
                </div>
              )}
            </>
          )}

          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginTop: '1rem', flexWrap: 'wrap' }}>
            {modeToggle(teamMode, setTeamMode)}
            <input ref={teamInput} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) upload('team', f); }} />
            <button className="btn btn-primary" onClick={() => teamInput.current?.click()} disabled={busy === 'team'} style={{ fontSize: '0.8rem' }}>
              {busy === 'team' ? 'Uploading…' : 'Upload team control'}
            </button>
            <a href="/api/call-cycles/templates?type=team" className="btn btn-outline" style={{ fontSize: '0.8rem', textDecoration: 'none' }}>Template</a>
            {teamStatus?.loaded && (
              <button className="btn btn-outline" onClick={() => clearFile('team')} style={{ fontSize: '0.8rem', color: '#dc2626' }}>Clear</button>
            )}
          </div>
        </section>

        <div style={{ padding: '0.75rem 1rem', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: '0.78rem', color: '#4b5563' }}>
          <strong>Replace vs Merge:</strong> Replace swaps the whole file for the new one — use it for a
          fresh export from Perigee. Merge keeps existing rows and overwrites only those whose store
          code (or member email) appears in the new file — use it for a partial update.
          <br /><br />
          <strong>No store control loaded?</strong> Uploads still work: site codes fall back to
          SnoMaster&apos;s own store master, which is already keyed by the Perigee visit code. The
          channel names then come from SnoMaster&apos;s Sales Channels, which may not match Perigee&apos;s
          exactly — so the control file is still the safer source.
        </div>

        <Footer />
      </main>

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
