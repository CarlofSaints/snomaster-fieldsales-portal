'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth, authFetch } from '@/lib/useAuth';
import Sidebar from '@/components/Sidebar';
import Footer from '@/components/Footer';

type ParseMode = 'team-leader' | 'user' | 'user-4wk';

interface UploadResult {
  ok?: boolean;
  error?: string;
  format?: string;
  entriesFound?: number;
  rowsAdded?: number;
  rowsUpdated?: number;
  totalRows?: number;
  warnings?: string[];
  skippedRows?: number;
  unmatchedDuplicates?: {
    storeCode: string;
    storeName: string;
    candidateChannels: string[];
    assignedChannel: string;
  }[];
}

const MODES: { key: ParseMode; title: string; note?: string; blurb: string; template: string }[] = [
  {
    key: 'user-4wk',
    title: 'User Sheets 4wk',
    note: 'recommended',
    blurb: 'Sheet name = the rep\'s Perigee email. Four week blocks (WEEK 1 / WEEK 2 / WEEK 3 / WEEK 4) stacked vertically with merged week labels in column A. Columns from H onwards are ignored.',
    template: 'cc-user-4wk',
  },
  {
    key: 'team-leader',
    title: 'Team Leader Sheets',
    blurb: 'Sheet name = the team leader\'s email. Each rep under them has an "Email:" + "Week:" marker above their cycle table.',
    template: 'cc-team-leader',
  },
  {
    key: 'user',
    title: 'User Sheets',
    blurb: 'Sheet name = the rep\'s Perigee email. One rep per sheet, only a "Week:" marker needed.',
    template: 'cc-user',
  },
];

export default function CallCycleUploadPage() {
  const { session, loading: authLoading, logout } = useAuth(['super_admin', 'admin']);
  const [file, setFile] = useState<File | null>(null);
  const [parseMode, setParseMode] = useState<ParseMode>('user-4wk');
  const [ignoreErrorSites, setIgnoreErrorSites] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [control, setControl] = useState<{ stores: boolean; teams: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadControlStatus = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([
        authFetch('/api/call-cycles/control-files/stores'),
        authFetch('/api/call-cycles/control-files/teams'),
      ]);
      const sj = s.ok ? await s.json() : { loaded: false };
      const tj = t.ok ? await t.json() : { loaded: false };
      setControl({ stores: !!sj.loaded, teams: !!tj.loaded });
    } catch {
      setControl({ stores: false, teams: false });
    }
  }, []);

  useEffect(() => { if (session) loadControlStatus(); }, [session, loadControlStatus]);

  async function handleUpload(forceIgnoreSheetNames = false) {
    if (!file) return;
    setUploading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('parseMode', parseMode);
      if (forceIgnoreSheetNames) formData.append('ignoreSheetNames', '1');
      if (ignoreErrorSites) formData.append('ignoreErrorSites', '1');

      const res = await authFetch('/api/call-cycles/upload', { method: 'POST', body: formData });
      setResult(await res.json());
    } catch {
      setResult({ error: 'Network error. Please try again.' });
    } finally {
      setUploading(false);
    }
  }

  // Sheets named by person rather than email can sometimes still be resolved
  // against the control files — offer a retry rather than a dead end.
  const hasSheetNameWarnings = !result?.ok && result?.warnings?.some(
    w => w.toLowerCase().includes('sheet name is not an email address')
  );

  if (authLoading || !session) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>Loading...</div>;
  }

  const card: React.CSSProperties = {
    background: 'white', border: '1px solid #e5e7eb', borderRadius: 12,
    padding: '1.25rem', marginBottom: '1.25rem',
  };

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar role={session.role} name={`${session.name} ${session.surname}`} onLogout={logout} />
      <main style={{ flex: 1, padding: '2rem', minHeight: '100vh', display: 'flex', flexDirection: 'column', maxWidth: 1000 }}>
        <div style={{ marginBottom: '0.5rem' }}>
          <Link href="/call-cycles" style={{ fontSize: '0.78rem', color: '#e31e1c', textDecoration: 'none' }}>&larr; Back to Call Cycles</Link>
        </div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#111827', marginBottom: '0.25rem' }}>
          Upload Call Cycle File
        </h1>
        <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: '1.25rem', maxWidth: 760 }}>
          Upload a manager&apos;s call cycle spreadsheet. It is parsed into individual rep/store/day rows
          and merged into the schedule — existing rows are updated, new ones added.
        </p>

        {/* Control file status */}
        {control && (!control.stores || !control.teams) && (
          <div style={{ padding: '0.7rem 1rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: '0.82rem', color: '#92400e', marginBottom: '1.25rem' }}>
            <strong>Control files missing.</strong>{' '}
            {!control.stores && 'No store control file — site codes cannot be matched to a Perigee channel. '}
            {!control.teams && 'No team control file — Perigee USER IDs will be blank on the export, and sheets named by person cannot be matched. '}
            <Link href="/call-cycles/control-files" style={{ color: '#92400e', fontWeight: 600 }}>Upload them first &rarr;</Link>
          </div>
        )}

        {/* Sheet format */}
        <section style={card}>
          <h2 style={{ fontSize: '0.75rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem' }}>
            Sheet format
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {MODES.map(m => {
              const on = parseMode === m.key;
              return (
                <label key={m.key} style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                  border: `1px solid ${on ? '#e31e1c' : '#e5e7eb'}`,
                  background: on ? '#fff5f5' : 'white',
                  borderRadius: 10, padding: '0.75rem 1rem', cursor: 'pointer',
                }}>
                  <input type="radio" name="parseMode" checked={on} onChange={() => setParseMode(m.key)} style={{ marginTop: 3, accentColor: '#e31e1c' }} />
                  <span style={{ flex: 1 }}>
                    <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#111827' }}>
                      {m.title}
                      {m.note && <span style={{ fontSize: '0.7rem', fontWeight: 400, color: '#e31e1c', marginLeft: 6 }}>({m.note})</span>}
                    </span>
                    <span style={{ display: 'block', fontSize: '0.78rem', color: '#6b7280', marginTop: 2 }}>{m.blurb}</span>
                    <a
                      href={`/api/call-cycles/templates?type=${m.template}`}
                      target="_blank" rel="noopener"
                      onClick={e => e.stopPropagation()}
                      style={{ display: 'inline-block', marginTop: 6, fontSize: '0.72rem', color: '#e31e1c' }}
                    >
                      Download template &darr;
                    </a>
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        {/* Drop zone */}
        <section style={card}>
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
            style={{
              border: `2px dashed ${dragOver ? '#e31e1c' : '#d1d5db'}`,
              background: dragOver ? '#fff5f5' : 'transparent',
              borderRadius: 12, padding: '2rem', textAlign: 'center', cursor: 'pointer',
            }}
          >
            <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]); }} />
            {file ? (
              <>
                <p style={{ fontSize: '0.88rem', fontWeight: 600, color: '#111827' }}>{file.name}</p>
                <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 4 }}>{(file.size / 1024).toFixed(1)} KB</p>
              </>
            ) : (
              <>
                <p style={{ fontSize: '0.88rem', color: '#6b7280' }}>Drop an Excel file here, or click to browse</p>
                <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 4 }}>Supported: .xlsx, .xls</p>
              </>
            )}
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', marginTop: '1rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={ignoreErrorSites} onChange={e => setIgnoreErrorSites(e.target.checked)} style={{ marginTop: 3, accentColor: '#e31e1c' }} />
            <span>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#111827' }}>Ignore error sites</span>
              <span style={{ display: 'block', fontSize: '0.76rem', color: '#6b7280' }}>
                When a duplicate site code can&apos;t be matched to a channel by its store name, skip
                those rows and load the rest. <strong>Unticked</strong>, the whole load fails so you can
                fix the file first. Either way the unmatched sites are listed below.
              </span>
            </span>
          </label>

          <button className="btn btn-primary" onClick={() => handleUpload()} disabled={!file || uploading} style={{ fontSize: '0.85rem', marginTop: '1rem' }}>
            {uploading ? 'Processing…' : 'Upload & process'}
          </button>
        </section>

        {/* Result */}
        {result && (
          <section style={{
            ...card,
            background: result.ok ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${result.ok ? '#bbf7d0' : '#fecaca'}`,
          }}>
            {result.ok ? (
              <>
                <p style={{ fontWeight: 700, color: '#065f46', fontSize: '0.9rem' }}>Upload successful</p>
                <p style={{ color: '#047857', fontSize: '0.82rem', marginTop: 6 }}>
                  Format: <strong>{result.format}</strong> &middot; Entries found: {result.entriesFound} &middot;{' '}
                  Added: {result.rowsAdded} &middot; Updated: {result.rowsUpdated} &middot; Total in schedule: {result.totalRows}
                </p>
                {!!result.skippedRows && (
                  <p style={{ color: '#92400e', fontSize: '0.82rem', marginTop: 6 }}>
                    Skipped {result.skippedRows} error-site row(s) — see the list below.
                  </p>
                )}
                <Link href="/call-cycles" className="btn btn-accent" style={{ fontSize: '0.8rem', marginTop: '0.9rem', display: 'inline-block', textDecoration: 'none' }}>
                  View the schedule
                </Link>
              </>
            ) : (
              <>
                <p style={{ fontWeight: 700, color: '#991b1b', fontSize: '0.9rem' }}>{result.error}</p>
                {hasSheetNameWarnings && (
                  <div style={{ marginTop: '0.9rem', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '0.75rem' }}>
                    <p style={{ fontSize: '0.82rem', color: '#92400e', fontWeight: 600 }}>
                      Some sheets were skipped because their names are not email addresses.
                    </p>
                    <p style={{ fontSize: '0.76rem', color: '#a16207', marginTop: 4 }}>
                      Retry and the parser will try to find the email inside the sheet, or match the sheet
                      name against the team control file.
                    </p>
                    <button className="btn" onClick={() => handleUpload(true)} disabled={uploading}
                      style={{ fontSize: '0.76rem', marginTop: 8, background: '#d97706', color: 'white' }}>
                      {uploading ? 'Processing…' : 'Load anyway'}
                    </button>
                  </div>
                )}
              </>
            )}

            {result.warnings && result.warnings.length > 0 && (
              <div style={{ marginTop: '0.9rem' }}>
                <p style={{ fontSize: '0.78rem', fontWeight: 600, color: '#92400e' }}>Warnings ({result.warnings.length})</p>
                <ul style={{ fontSize: '0.75rem', color: '#a16207', marginTop: 4, paddingLeft: '1.1rem', maxHeight: 240, overflowY: 'auto' }}>
                  {result.warnings.map((w, i) => <li key={i} style={{ marginBottom: 2 }}>{w}</li>)}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* Unmatched duplicate site codes */}
        {result?.unmatchedDuplicates && result.unmatchedDuplicates.length > 0 && (
          <section style={{ ...card, background: '#fef2f2', border: '1px solid #fecaca' }}>
            <p style={{ fontSize: '0.88rem', fontWeight: 700, color: '#991b1b' }}>
              {result.unmatchedDuplicates.length} site{result.unmatchedDuplicates.length === 1 ? '' : 's'} with an unmatched duplicate site code
            </p>
            <p style={{ fontSize: '0.76rem', color: '#b91c1c', marginTop: 4 }}>
              These codes exist under more than one channel and the store name didn&apos;t clearly say
              which — usually a typo in the store name.
              {result.ok
                ? ' They were skipped. Fix the names and reload to include them.'
                : ' Nothing was loaded — fix the names and reload, or tick “Ignore error sites” to load the rest.'}
            </p>
            <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#991b1b', borderBottom: '1px solid #fecaca' }}>
                    <th style={{ padding: '4px 12px 4px 0' }}>Site code</th>
                    <th style={{ padding: '4px 12px 4px 0' }}>Store name (from file)</th>
                    <th style={{ padding: '4px 0' }}>Possible channels</th>
                  </tr>
                </thead>
                <tbody>
                  {result.unmatchedDuplicates.map((d, i) => (
                    <tr key={i} style={{ color: '#b91c1c', borderBottom: '1px solid #fee2e2' }}>
                      <td style={{ padding: '4px 12px 4px 0', fontFamily: 'monospace' }}>{d.storeCode}</td>
                      <td style={{ padding: '4px 12px 4px 0' }}>{d.storeName}</td>
                      <td style={{ padding: '4px 0' }}>{d.candidateChannels.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <Footer />
      </main>
    </div>
  );
}
