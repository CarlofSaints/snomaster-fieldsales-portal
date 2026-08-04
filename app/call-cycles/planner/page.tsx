'use client';

import { useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useAuth, authFetch } from '@/lib/useAuth';
import Sidebar from '@/components/Sidebar';
import Toast from '@/components/Toast';
import Footer from '@/components/Footer';

/* ── Types mirroring the analyse endpoint ── */

interface LegendEntry {
  fill: string;
  label: string;
  cellCount: number;
  suggestedIsVisit: boolean;
  unknown: boolean;
}

interface StoreAlt { storeCode: string; storeName: string; channel: string; score: number }

interface StoreMatch {
  input: string;
  confidence: 'exact' | 'high' | 'low' | 'none';
  storeCode: string;
  storeName: string;
  channel: string;
  score: number;
  alternatives: StoreAlt[];
}

interface StoreRow {
  rowNumber: number;
  index: string;
  inputName: string;
  section: string;
  typedCode: string;
  match: StoreMatch;
  hasVisits: boolean;
  visitDays: { day: number; weekday: string; week: number }[];
  entryGroups: { cycle: string; days: string[] }[];
}

interface SheetAnalysis {
  sheetName: string;
  title: string;
  regionTitle: string;
  repName: string;
  suggestedEmail: string;
  gridMonth: number | null;
  gridYear: number | null;
  usesTypedMarkers: boolean;
  hasCodeColumn: boolean;
  storesWithCodes: number;
  legend: LegendEntry[];
  storeCount: number;
  storesWithVisits: number;
  totalMarkedDays: number;
  stores: StoreRow[];
  warnings: string[];
}

interface Issue {
  sheetName: string;
  level: 'error' | 'warning';
  title: string;
  detail: string;
  fix: string;
}

interface Analysis {
  ok: boolean;
  blocked: boolean;
  issues: Issue[];
  warnings: string[];
  filename: string;
  storeSource: 'control' | 'store-master' | 'none';
  storeRefCount: number;
  reps: { email: string; memberId: string; teamName: string; teamLeader: string }[];
  sheets: SheetAnalysis[];
  error?: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const CONF_STYLE: Record<string, React.CSSProperties> = {
  exact: { background: '#d1fae5', color: '#065f46', border: '1px solid #6ee7b7' },
  high: { background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd' },
  low: { background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' },
  none: { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' },
};

/** Approximate an Excel theme colour well enough to show a swatch. */
function swatch(fill: string): string {
  if (/^[0-9A-F]{8}$/i.test(fill)) return '#' + fill.slice(2);
  const m = fill.match(/^T(\d+)\/(-?[\d.]+)$/);
  if (!m) return '#e5e7eb';
  const base = ['#FFFFFF', '#000000', '#E7E6E6', '#44546A', '#4472C4', '#ED7D31',
    '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47'][Number(m[1])] || '#9CA3AF';
  const tint = Number(m[2]);
  const n = parseInt(base.slice(1), 16);
  let [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  if (tint < 0) { r *= 1 + tint; g *= 1 + tint; b *= 1 + tint; }
  else if (tint > 0) { r += (255 - r) * tint; g += (255 - g) * tint; b += (255 - b) * tint; }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

export default function PlannerUploadPage() {
  const { session, loading: authLoading, logout } = useAuth('cc.planner.upload');
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<{ rowsWritten: number; storesWritten: number; rowsReplaced: number; reps: string[]; warnings: string[] } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [buildingTemplate, setBuildingTemplate] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Template builder — defaults to next month, since a planner is written ahead.
  const [tplMonth, setTplMonth] = useState(() => {
    const m = new Date().getMonth() + 2;
    return m > 12 ? 1 : m;
  });
  const [tplYear, setTplYear] = useState(() => {
    const d = new Date();
    return d.getMonth() + 2 > 12 ? d.getFullYear() + 1 : d.getFullYear();
  });

  // Per-sheet review state, keyed by sheet name.
  const [repEmail, setRepEmail] = useState<Record<string, string>>({});
  const [visitFills, setVisitFills] = useState<Record<string, Set<string>>>({});
  const [storeCodes, setStoreCodes] = useState<Record<string, Record<string, string>>>({});
  const [showAllStores, setShowAllStores] = useState<Record<string, boolean>>({});

  /**
   * Fetched rather than linked: auth rides on the `x-user-id` header that
   * authFetch adds, so a plain <a href> would come back 401.
   */
  async function downloadTemplate() {
    setBuildingTemplate(true);
    try {
      const res = await authFetch(`/api/call-cycles/planner-template?month=${tplMonth}&year=${tplYear}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setToast({ msg: data.error || 'Could not build the planners', type: 'error' });
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `SnoMaster Planner - All Reps - ${MONTHS[tplMonth - 1]} ${tplYear}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setToast({ msg: 'Could not build the planners', type: 'error' });
    } finally {
      setBuildingTemplate(false);
    }
  }

  async function analyse(f: File) {
    setAnalysing(true);
    setAnalysis(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await authFetch('/api/call-cycles/planner/analyse', { method: 'POST', body: fd });
      const data: Analysis = await res.json();
      if (!res.ok && !data.sheets) {
        setToast({ msg: data.error || 'Could not read the planner', type: 'error' });
        return;
      }
      setAnalysis(data);

      // Seed the review state from what the parser suggested.
      const rep: Record<string, string> = {};
      const fills: Record<string, Set<string>> = {};
      const codes: Record<string, Record<string, string>> = {};
      for (const sh of data.sheets) {
        rep[sh.sheetName] = sh.suggestedEmail || '';
        fills[sh.sheetName] = new Set(sh.legend.filter(l => l.suggestedIsVisit).map(l => l.fill));
        codes[sh.sheetName] = {};
        for (const s of sh.stores) {
          // Only auto-accept matches we're actually confident in. Anything
          // weaker is left blank so it can't slip through unreviewed.
          if (s.match.confidence === 'exact' || s.match.confidence === 'high') {
            codes[sh.sheetName][String(s.rowNumber)] = s.match.storeCode;
          }
        }
      }
      setRepEmail(rep);
      setVisitFills(fills);
      setStoreCodes(codes);
    } catch {
      setToast({ msg: 'Could not read the planner', type: 'error' });
    } finally {
      setAnalysing(false);
    }
  }

  function toggleFill(sheetName: string, fill: string) {
    setVisitFills(prev => {
      const next = new Set(prev[sheetName] ?? []);
      if (next.has(fill)) next.delete(fill); else next.add(fill);
      return { ...prev, [sheetName]: next };
    });
  }

  function setStoreCode(sheetName: string, rowNumber: number, code: string) {
    setStoreCodes(prev => ({
      ...prev,
      [sheetName]: { ...(prev[sheetName] ?? {}), [String(rowNumber)]: code },
    }));
  }

  /**
   * Which stores would actually be written, given the colours currently ticked.
   * Recomputed in the browser so changing a colour updates the count instantly
   * rather than needing another round trip.
   */
  const previewBySheet = useMemo(() => {
    const out: Record<string, { withVisits: number; resolved: number; unresolved: number; markedDays: number }> = {};
    if (!analysis) return out;
    for (const sh of analysis.sheets) {
      const fills = visitFills[sh.sheetName] ?? new Set<string>();
      let withVisits = 0, resolved = 0, unresolved = 0, markedDays = 0;
      for (const s of sh.stores) {
        // A store counts if any of its marks is a typed marker or a ticked colour.
        const days = s.visitDays.length;
        const counted = s.hasVisits
          ? days > 0 && (sh.usesTypedMarkers || [...fills].length > 0)
          : false;
        if (!counted) continue;
        withVisits++;
        markedDays += days;
        if ((storeCodes[sh.sheetName] ?? {})[String(s.rowNumber)]) resolved++;
        else unresolved++;
      }
      out[sh.sheetName] = { withVisits, resolved, unresolved, markedDays };
    }
    return out;
  }, [analysis, visitFills, storeCodes]);

  async function commit() {
    if (!file || !analysis) return;
    setCommitting(true);
    try {
      const decisions = analysis.sheets.map(sh => ({
        sheetName: sh.sheetName,
        userEmail: repEmail[sh.sheetName] || '',
        visitFills: [...(visitFills[sh.sheetName] ?? [])],
        storeCodes: storeCodes[sh.sheetName] ?? {},
      }));
      const fd = new FormData();
      fd.append('file', file);
      fd.append('decisions', JSON.stringify(decisions));
      const res = await authFetch('/api/call-cycles/planner/commit', { method: 'POST', body: fd });
      const data = await res.json();
      if (res.ok) {
        setResult(data);
        setAnalysis(null);
        setToast({ msg: `Loaded ${data.storesWritten} stores for ${data.reps.join(', ')}`, type: 'success' });
      } else {
        setToast({ msg: data.error || 'Save failed', type: 'error' });
      }
    } catch {
      setToast({ msg: 'Save failed', type: 'error' });
    } finally {
      setCommitting(false);
    }
  }

  if (authLoading || !session) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>Loading...</div>;
  }

  const card: React.CSSProperties = {
    background: 'white', border: '1px solid #e5e7eb', borderRadius: 12,
    padding: '1.25rem', marginBottom: '1.25rem',
  };
  const th: React.CSSProperties = {
    textAlign: 'left', padding: '0.4rem 0.5rem', fontSize: '0.68rem', fontWeight: 700,
    color: '#6b7280', textTransform: 'uppercase', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = {
    padding: '0.4rem 0.5rem', fontSize: '0.78rem', color: '#374151', borderBottom: '1px solid #f3f4f6',
  };

  const errors = analysis?.issues.filter(i => i.level === 'error') ?? [];
  const warns = analysis?.issues.filter(i => i.level === 'warning') ?? [];
  const anyUnresolved = analysis?.sheets.some(sh => (previewBySheet[sh.sheetName]?.unresolved ?? 0) > 0) ?? false;
  const anyRepMissing = analysis?.sheets.some(sh => !repEmail[sh.sheetName]) ?? false;

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar role={session.role} name={`${session.name} ${session.surname}`} onLogout={logout} />
      <main style={{ flex: 1, padding: '2rem', minHeight: '100vh', display: 'flex', flexDirection: 'column', maxWidth: 1180 }}>
        <div style={{ marginBottom: '0.5rem' }}>
          <Link href="/call-cycles" style={{ fontSize: '0.78rem', color: '#e31e1c', textDecoration: 'none' }}>&larr; Back to Call Cycles</Link>
        </div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#111827', marginBottom: '0.25rem' }}>
          Upload Monthly Store Visit Planner
        </h1>
        <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: '1.25rem', maxWidth: 820 }}>
          For the SnoMaster rep planners — one rep, one month, stores down the side and the days of
          the month across the top. The marked days are converted into Perigee cycle weeks and
          weekdays. Loading a planner <strong>replaces</strong> everything currently held for that
          rep, because the planner is re-sent every month.
        </p>

        {/* Send the reps a template rather than fixing their files afterwards */}
        <section style={{ ...card, background: '#f0f9ff', border: '1px solid #bae6fd' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0c4a6e' }}>
            Send the reps a ready-made planner
          </h2>
          <p style={{ fontSize: '0.8rem', color: '#0369a1', marginTop: 4, maxWidth: 780 }}>
            The dates and weekday headers are built for the month, each rep&apos;s stores come
            pre-filled with their <strong>Perigee site codes</strong>, and the sheet tells them to
            type <strong>1</strong> for every in-store day. That removes the four things that
            actually go wrong in hand-made planners: a title that disagrees with the calendar, a
            shading colour missing from the key, an inserted column that shifts the grid, and blank
            site codes.
          </p>
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', marginTop: '0.9rem', flexWrap: 'wrap' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, color: '#0369a1', textTransform: 'uppercase', marginBottom: 3 }}>Month</label>
              <select className="input" value={tplMonth} onChange={e => setTplMonth(Number(e.target.value))} style={{ fontSize: '0.8rem' }}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, color: '#0369a1', textTransform: 'uppercase', marginBottom: 3 }}>Year</label>
              <input className="input" type="number" value={tplYear} onChange={e => setTplYear(Number(e.target.value))} style={{ fontSize: '0.8rem', width: 92 }} />
            </div>
            <button
              className="btn btn-primary"
              onClick={downloadTemplate}
              disabled={buildingTemplate}
              style={{ fontSize: '0.82rem' }}
            >
              {buildingTemplate ? 'Building…' : 'Download planners for all reps'}
            </button>
          </div>
          <p style={{ fontSize: '0.72rem', color: '#0369a1', marginTop: 8 }}>
            One sheet per rep who currently has a schedule. Reps with no stores on file get an empty
            sheet to fill in.
          </p>
        </section>

        {/* Drop zone */}
        {!result && (
          <section style={card}>
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault(); setDragOver(false);
                const f = e.dataTransfer.files[0];
                if (f) { setFile(f); analyse(f); }
              }}
              style={{
                border: `2px dashed ${dragOver ? '#e31e1c' : '#d1d5db'}`,
                background: dragOver ? '#fff5f5' : 'transparent',
                borderRadius: 12, padding: '2rem', textAlign: 'center', cursor: 'pointer',
              }}
            >
              <input ref={inputRef} type="file" accept=".xlsx" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); analyse(f); } }} />
              {file ? (
                <>
                  <p style={{ fontSize: '0.88rem', fontWeight: 600, color: '#111827' }}>{file.name}</p>
                  <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 4 }}>
                    {analysing ? 'Reading…' : 'Click to choose a different file'}
                  </p>
                </>
              ) : (
                <>
                  <p style={{ fontSize: '0.88rem', color: '#6b7280' }}>Drop a planner here, or click to browse</p>
                  <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 4 }}>.xlsx only — colours can&apos;t be read from the older .xls format</p>
                </>
              )}
            </div>
          </section>
        )}

        {/* Success */}
        {result && (
          <section style={{ ...card, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
            <p style={{ fontWeight: 700, color: '#065f46', fontSize: '0.95rem' }}>Planner loaded</p>
            <p style={{ color: '#047857', fontSize: '0.83rem', marginTop: 6 }}>
              {result.storesWritten} stores &middot; {result.rowsWritten} schedule rows for {result.reps.join(', ')}
              {result.rowsReplaced > 0 && <> &middot; replaced {result.rowsReplaced} previous row(s) for {result.reps.length > 1 ? 'these reps' : 'this rep'}</>}
            </p>
            {result.warnings.length > 0 && (
              <ul style={{ fontSize: '0.76rem', color: '#a16207', marginTop: 10, paddingLeft: '1.1rem', maxHeight: 220, overflowY: 'auto' }}>
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <Link href="/call-cycles" className="btn btn-primary" style={{ fontSize: '0.82rem', textDecoration: 'none' }}>View the schedule</Link>
              <button className="btn btn-outline" onClick={() => { setResult(null); setFile(null); }} style={{ fontSize: '0.82rem' }}>Load another planner</button>
            </div>
          </section>
        )}

        {/* Blocking errors */}
        {errors.length > 0 && (
          <section style={{ ...card, background: '#fef2f2', border: '1px solid #fecaca' }}>
            <p style={{ fontWeight: 700, color: '#991b1b', fontSize: '0.95rem' }}>
              This planner can&apos;t be loaded — {errors.length} problem{errors.length === 1 ? '' : 's'} to fix in the file
            </p>
            <p style={{ fontSize: '0.78rem', color: '#b91c1c', marginTop: 4 }}>
              Nothing has been saved. Correct the file and upload it again.
            </p>
            <div style={{ marginTop: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              {errors.map((i, n) => (
                <div key={n} style={{ background: 'white', border: '1px solid #fecaca', borderRadius: 8, padding: '0.7rem 0.9rem' }}>
                  <div style={{ fontSize: '0.83rem', fontWeight: 700, color: '#991b1b' }}>{i.title}</div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }}>Sheet: {i.sheetName}</div>
                  <div style={{ fontSize: '0.79rem', color: '#374151', marginTop: 6 }}>{i.detail}</div>
                  <div style={{ fontSize: '0.79rem', color: '#065f46', marginTop: 6 }}><strong>Fix:</strong> {i.fix}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Review */}
        {analysis && analysis.sheets.map(sh => {
          const preview = previewBySheet[sh.sheetName] ?? { withVisits: 0, resolved: 0, unresolved: 0, markedDays: 0 };
          const codes = storeCodes[sh.sheetName] ?? {};
          const fills = visitFills[sh.sheetName] ?? new Set<string>();
          const showAll = showAllStores[sh.sheetName] ?? false;
          const needsReview = sh.stores.filter(s => s.hasVisits && !codes[String(s.rowNumber)]);
          const visible = showAll ? sh.stores.filter(s => s.hasVisits) : needsReview;

          return (
            <section key={sh.sheetName} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#111827' }}>{sh.sheetName}</h2>
                  <p style={{ fontSize: '0.76rem', color: '#6b7280', marginTop: 2 }}>
                    {sh.title || 'no title'} &middot;{' '}
                    <strong>{sh.gridMonth ? `${MONTHS[sh.gridMonth - 1]} ${sh.gridYear}` : 'month unknown'}</strong>
                    {' '}&middot; {sh.storeCount} store rows
                    {sh.usesTypedMarkers && <> &middot; <span style={{ color: '#065f46', fontWeight: 600 }}>uses typed markers</span></>}
                    {sh.hasCodeColumn
                      ? <> &middot; <span style={{ color: '#065f46', fontWeight: 600 }}>site codes: {sh.storesWithCodes}/{sh.storeCount}</span></>
                      : <> &middot; <span style={{ color: '#b45309', fontWeight: 600 }}>no site code column — matching on names</span></>}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {[
                    { label: 'Stores to load', value: preview.withVisits },
                    { label: 'Visit days', value: preview.markedDays },
                    { label: 'Need a store', value: preview.unresolved, warn: preview.unresolved > 0 },
                  ].map(s => (
                    <div key={s.label} style={{
                      padding: '0.4rem 0.8rem', borderRadius: 8, minWidth: 84, textAlign: 'center',
                      background: s.warn ? '#fffbeb' : '#f9fafb',
                      border: `1px solid ${s.warn ? '#fde68a' : '#e5e7eb'}`,
                    }}>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: s.warn ? '#92400e' : '#111827' }}>{s.value}</div>
                      <div style={{ fontSize: '0.63rem', color: '#6b7280', textTransform: 'uppercase' }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Rep */}
              <div style={{ marginTop: '1rem' }}>
                <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
                  Whose planner is this?
                </label>
                <select
                  className="input"
                  value={repEmail[sh.sheetName] || ''}
                  onChange={e => setRepEmail(p => ({ ...p, [sh.sheetName]: e.target.value }))}
                  style={{ fontSize: '0.82rem', maxWidth: 380, borderColor: repEmail[sh.sheetName] ? undefined : '#fca5a5' }}
                >
                  <option value="">— select the Perigee user —</option>
                  {analysis.reps.map(r => (
                    <option key={r.email} value={r.email}>{r.email}{r.teamName ? ` (${r.teamName})` : ''}</option>
                  ))}
                </select>
                {sh.repName && (
                  <span style={{ fontSize: '0.75rem', color: '#6b7280', marginLeft: 10 }}>
                    file says &ldquo;{sh.repName}&rdquo;
                  </span>
                )}
                {analysis.reps.length === 0 && (
                  <p style={{ fontSize: '0.75rem', color: '#b91c1c', marginTop: 4 }}>
                    No team control file loaded, so there are no Perigee users to pick from.{' '}
                    <Link href="/call-cycles/control-files" style={{ color: '#b91c1c', fontWeight: 600 }}>Load it first &rarr;</Link>
                  </p>
                )}
              </div>

              {/* Colour key */}
              <div style={{ marginTop: '1.25rem' }}>
                <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                  Which colours mean the rep is in store?
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {sh.legend.filter(l => l.cellCount > 0).map(l => (
                    <label key={l.fill} style={{
                      display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer',
                      padding: '0.35rem 0.6rem', borderRadius: 8,
                      background: fills.has(l.fill) ? '#fff5f5' : 'transparent',
                      border: `1px solid ${fills.has(l.fill) ? '#fecaca' : 'transparent'}`,
                    }}>
                      <input type="checkbox" checked={fills.has(l.fill)} onChange={() => toggleFill(sh.sheetName, l.fill)} style={{ accentColor: '#e31e1c' }} />
                      <span style={{ width: 22, height: 16, borderRadius: 3, background: swatch(l.fill), border: '1px solid #d1d5db', flexShrink: 0 }} />
                      <span style={{ fontSize: '0.82rem', color: '#111827', fontWeight: l.unknown ? 700 : 500 }}>
                        {l.label || 'Not in this sheet’s colour key'}
                      </span>
                      <span style={{ fontSize: '0.73rem', color: '#6b7280' }}>{l.cellCount} cells</span>
                      {l.unknown && (
                        <span style={{ fontSize: '0.7rem', background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', padding: '1px 7px', borderRadius: 999 }}>
                          unlabelled — you decide
                        </span>
                      )}
                    </label>
                  ))}
                </div>
                {sh.legend.some(l => l.unknown && l.cellCount > 0) && (
                  <p style={{ fontSize: '0.75rem', color: '#92400e', marginTop: 6 }}>
                    A colour is used in the grid that isn&apos;t in this sheet&apos;s key. Tick it if it means
                    &ldquo;in store&rdquo;, or ask the rep to add it to their key.
                  </p>
                )}
                {preview.withVisits === 0 && (
                  <p style={{ fontSize: '0.78rem', color: '#b91c1c', marginTop: 8, fontWeight: 600 }}>
                    No visits would be loaded from this sheet. Either nothing is marked, or the colour
                    that means &ldquo;in store&rdquo; isn&apos;t ticked above.
                  </p>
                )}
              </div>

              {/* Store matching */}
              {preview.withVisits > 0 && (
                <div style={{ marginTop: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>
                      Store matching {needsReview.length > 0 && <span style={{ color: '#b91c1c' }}>— {needsReview.length} need{needsReview.length === 1 ? 's' : ''} a choice</span>}
                    </label>
                    <button className="btn btn-outline" onClick={() => setShowAllStores(p => ({ ...p, [sh.sheetName]: !showAll }))} style={{ fontSize: '0.72rem', padding: '0.2rem 0.6rem' }}>
                      {showAll ? 'Show only unresolved' : `Show all ${preview.withVisits}`}
                    </button>
                  </div>

                  {analysis.storeSource === 'none' ? (
                    <p style={{ fontSize: '0.78rem', color: '#b91c1c' }}>
                      There are no stores to match against.{' '}
                      <Link href="/call-cycles/control-files" style={{ color: '#b91c1c', fontWeight: 600 }}>Load the Perigee store control file &rarr;</Link>
                    </p>
                  ) : visible.length === 0 ? (
                    <p style={{ fontSize: '0.8rem', color: '#065f46' }}>Every store matched confidently.</p>
                  ) : (
                    <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, maxHeight: 460, overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white' }}>
                        <thead style={{ position: 'sticky', top: 0, background: 'white' }}>
                          <tr>
                            <th style={th}>Name in the planner</th>
                            <th style={th}>Cycle</th>
                            <th style={th}>Match</th>
                            <th style={th}>Perigee store</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visible.map(s => (
                            <tr key={s.rowNumber}>
                              <td style={td}>
                                <div style={{ fontWeight: 600, color: '#111827' }}>{s.inputName}</div>
                                <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>row {s.rowNumber}{s.section ? ` · ${s.section}` : ''}</div>
                              </td>
                              <td style={{ ...td, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                                {s.entryGroups.map((g, i) => (
                                  <div key={i}>{g.cycle}: {g.days.map(d => d.slice(0, 3)).join(', ')}</div>
                                ))}
                              </td>
                              <td style={td}>
                                <span style={{ ...CONF_STYLE[s.match.confidence], padding: '1px 7px', borderRadius: 999, fontSize: '0.66rem', fontWeight: 700 }}>
                                  {s.match.confidence}
                                </span>
                              </td>
                              <td style={td}>
                                <select
                                  className="input"
                                  value={codes[String(s.rowNumber)] || ''}
                                  onChange={e => setStoreCode(sh.sheetName, s.rowNumber, e.target.value)}
                                  style={{
                                    fontSize: '0.76rem', minWidth: 300,
                                    borderColor: codes[String(s.rowNumber)] ? undefined : '#fca5a5',
                                  }}
                                >
                                  <option value="">— skip this store —</option>
                                  {s.match.alternatives.map(a => (
                                    <option key={a.storeCode} value={a.storeCode}>
                                      {a.storeName} [{a.storeCode}]{a.channel ? ` · ${a.channel}` : ''}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {sh.warnings.length > 0 && (
                <ul style={{ fontSize: '0.75rem', color: '#a16207', marginTop: 10, paddingLeft: '1.1rem' }}>
                  {sh.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
            </section>
          );
        })}

        {/* Non-blocking warnings */}
        {warns.length > 0 && (
          <section style={{ ...card, background: '#fffbeb', border: '1px solid #fde68a' }}>
            <p style={{ fontSize: '0.83rem', fontWeight: 700, color: '#92400e' }}>Worth checking</p>
            <ul style={{ fontSize: '0.78rem', color: '#a16207', marginTop: 6, paddingLeft: '1.1rem' }}>
              {warns.map((i, n) => <li key={n} style={{ marginBottom: 4 }}><strong>{i.title}</strong> — {i.detail}</li>)}
            </ul>
          </section>
        )}

        {/* Commit */}
        {analysis && !analysis.blocked && (
          <section style={{ ...card, position: 'sticky', bottom: 0, boxShadow: '0 -4px 12px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={commit} disabled={committing || anyRepMissing} style={{ fontSize: '0.85rem' }}>
                {committing ? 'Saving…' : 'Load into the schedule'}
              </button>
              {anyRepMissing && (
                <span style={{ fontSize: '0.78rem', color: '#b91c1c' }}>Pick which rep each sheet belongs to first.</span>
              )}
              {!anyRepMissing && anyUnresolved && (
                <span style={{ fontSize: '0.78rem', color: '#92400e' }}>
                  Stores left as &ldquo;skip&rdquo; won&apos;t be loaded — that&apos;s fine if they aren&apos;t in Perigee yet.
                </span>
              )}
              <span style={{ fontSize: '0.78rem', color: '#6b7280', marginLeft: 'auto' }}>
                Replaces everything currently held for {analysis.sheets.length === 1 ? 'this rep' : 'these reps'}.
              </span>
            </div>
          </section>
        )}

        <Footer />
      </main>

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
