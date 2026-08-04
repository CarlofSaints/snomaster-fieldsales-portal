'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useAuth, authFetch } from '@/lib/useAuth';
import Sidebar from '@/components/Sidebar';
import Toast from '@/components/Toast';
import Footer from '@/components/Footer';

interface ScheduleRow {
  userEmail: string;
  firstName: string;
  surname: string;
  storeId: string;
  storeName: string;
  channel: string;
  cycle: string;
  days: string[];
  action: 'ADD' | 'UPDATE' | 'REMOVE' | 'LIVE';
  uploadedAt: string;
  uploadedBy: string;
  teamLeader?: string;
}

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ALL_WEEKS = [1, 2, 3, 4, 5, 6];
const ACTION_OPTIONS: ScheduleRow['action'][] = ['ADD', 'UPDATE', 'REMOVE', 'LIVE'];

const ACTION_STYLE: Record<string, React.CSSProperties> = {
  ADD: { background: '#d1fae5', color: '#065f46', border: '1px solid #6ee7b7' },
  UPDATE: { background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' },
  REMOVE: { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' },
  LIVE: { background: '#f3f4f6', color: '#4b5563', border: '1px solid #d1d5db' },
};

function parseCycleWeeks(cycle: string): number[] {
  if (!cycle) return [];
  const nums = cycle.match(/\d+/g);
  return nums ? nums.map(Number).filter(n => n >= 1 && n <= 6).sort((a, b) => a - b) : [];
}

function formatCycle(cycle: string): string {
  const weeks = parseCycleWeeks(cycle);
  return weeks.length === 0 ? '—' : `Week ${weeks.join(', ')}`;
}

function daysShort(days: string[]): string {
  return days.map(d => d.slice(0, 3)).join(', ');
}

export default function CallCyclesPage() {
  const { session, loading: authLoading, logout } = useAuth(['super_admin', 'admin', 'client']);
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Inline edit state — index is into the FULL schedule array, which is what
  // the API mutates by position.
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editRow, setEditRow] = useState<ScheduleRow | null>(null);
  const [saving, setSaving] = useState(false);

  // Two-step clear confirmation.
  const [showClear, setShowClear] = useState(false);
  const [clearInput, setClearInput] = useState('');
  const [clearing, setClearing] = useState(false);

  const canEdit = session?.role === 'super_admin' || session?.role === 'admin';

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/call-cycles/schedule');
      if (res.ok) setSchedule(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (session) loadData(); }, [session, loadData]);

  const users = useMemo(() => {
    const set = new Map<string, string>();
    for (const r of schedule) {
      const key = r.userEmail || r.firstName;
      if (key && !set.has(key)) {
        set.set(key, `${r.firstName} ${r.surname}`.trim() || r.userEmail);
      }
    }
    return [...set.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [schedule]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return schedule
      .map((row, idx) => ({ row, idx }))
      .filter(({ row }) => {
        const matchText = !q ||
          row.userEmail.toLowerCase().includes(q) ||
          row.firstName.toLowerCase().includes(q) ||
          row.surname.toLowerCase().includes(q) ||
          row.storeName.toLowerCase().includes(q) ||
          row.storeId.toLowerCase().includes(q) ||
          (row.teamLeader || '').toLowerCase().includes(q);
        const matchAction = !actionFilter || row.action === actionFilter;
        const matchUser = !userFilter || (row.userEmail || row.firstName) === userFilter;
        return matchText && matchAction && matchUser;
      });
  }, [schedule, search, actionFilter, userFilter]);

  const stats = useMemo(() => {
    const reps = new Set(schedule.map(r => r.userEmail.toLowerCase()).filter(Boolean));
    const stores = new Set(schedule.map(r => r.storeId.toUpperCase()).filter(Boolean));
    const noChannel = schedule.filter(r => !r.channel).length;
    const noStoreId = schedule.filter(r => !r.storeId).length;
    return { rows: schedule.length, reps: reps.size, stores: stores.size, noChannel, noStoreId };
  }, [schedule]);

  function startEdit(idx: number) {
    setEditingIdx(idx);
    setEditRow({ ...schedule[idx], days: [...schedule[idx].days] });
  }

  function cancelEdit() {
    setEditingIdx(null);
    setEditRow(null);
  }

  async function handleSave() {
    if (editingIdx === null || !editRow) return;
    setSaving(true);
    try {
      const res = await authFetch('/api/call-cycles/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: editingIdx, row: editRow }),
      });
      if (res.ok) {
        setSchedule(await res.json());
        cancelEdit();
        setToast({ msg: 'Row saved', type: 'success' });
      } else {
        const data = await res.json().catch(() => ({}));
        setToast({ msg: data.error || 'Save failed', type: 'error' });
      }
    } catch {
      setToast({ msg: 'Save failed', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(idx: number) {
    const row = schedule[idx];
    if (!confirm(`Delete the row for ${row.firstName} ${row.surname} — ${row.storeName}?`)) return;
    try {
      const res = await authFetch('/api/call-cycles/schedule', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: idx }),
      });
      if (res.ok) {
        setSchedule(await res.json());
        if (editingIdx === idx) cancelEdit();
        setToast({ msg: 'Row deleted', type: 'success' });
      } else {
        setToast({ msg: 'Delete failed', type: 'error' });
      }
    } catch {
      setToast({ msg: 'Delete failed', type: 'error' });
    }
  }

  async function handleClearAll() {
    setClearing(true);
    try {
      const res = await authFetch('/api/call-cycles/schedule', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearAll: true }),
      });
      if (res.ok) {
        setSchedule([]);
        setShowClear(false);
        setClearInput('');
        setToast({ msg: 'Schedule cleared', type: 'success' });
      } else {
        setToast({ msg: 'Clear failed', type: 'error' });
      }
    } catch {
      setToast({ msg: 'Clear failed', type: 'error' });
    } finally {
      setClearing(false);
    }
  }

  /**
   * The download is fetched (not a plain link) because auth here rides on the
   * `x-user-id` header that authFetch adds — a bare <a href> would send no
   * header and come back 401.
   */
  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await authFetch('/api/call-cycles/download');
      if (!res.ok) {
        setToast({ msg: 'Download failed', type: 'error' });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SnoMaster - Perigee Call Schedule - ${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setToast({ msg: 'Download failed', type: 'error' });
    } finally {
      setDownloading(false);
    }
  }

  function toggleDay(day: string) {
    if (!editRow) return;
    const days = editRow.days.includes(day)
      ? editRow.days.filter(d => d !== day)
      : [...editRow.days, day];
    days.sort((a, b) => ALL_DAYS.indexOf(a) - ALL_DAYS.indexOf(b));
    setEditRow({ ...editRow, days });
  }

  function toggleWeek(week: number) {
    if (!editRow) return;
    const current = parseCycleWeeks(editRow.cycle);
    const updated = current.includes(week)
      ? current.filter(w => w !== week)
      : [...current, week].sort((a, b) => a - b);
    setEditRow({ ...editRow, cycle: updated.length ? `Week ${updated.join('&')}` : '' });
  }

  if (authLoading || !session) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>Loading...</div>;
  }

  const th: React.CSSProperties = {
    textAlign: 'left', padding: '0.5rem 0.6rem', fontSize: '0.7rem', fontWeight: 700,
    color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em',
    borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = {
    padding: '0.5rem 0.6rem', fontSize: '0.8rem', color: '#374151',
    borderBottom: '1px solid #f3f4f6', verticalAlign: 'top',
  };

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar role={session.role} name={`${session.name} ${session.surname}`} onLogout={logout} />
      <main style={{ flex: 1, padding: '2rem', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#111827', marginBottom: '0.25rem' }}>
          Call Cycles
        </h1>
        <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: '1rem', maxWidth: 780 }}>
          The working call cycle schedule. Managers&apos; Excel files are uploaded here in whatever
          shape they arrive in, merged into this grid, then exported as a Perigee-ready workbook you
          upload straight into the Perigee portal.
        </p>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
          {canEdit && (
            <>
              <Link href="/call-cycles/upload" className="btn btn-primary" style={{ fontSize: '0.82rem', textDecoration: 'none' }}>
                Upload call cycle file
              </Link>
              <button className="btn btn-accent" onClick={handleDownload} disabled={downloading || schedule.length === 0} style={{ fontSize: '0.82rem' }}>
                {downloading ? 'Building…' : 'Download Perigee file'}
              </button>
              <Link href="/call-cycles/control-files" className="btn btn-outline" style={{ fontSize: '0.82rem', textDecoration: 'none' }}>
                Control files
              </Link>
            </>
          )}
          <Link href="/call-cycles/adherence" className="btn btn-outline" style={{ fontSize: '0.82rem', textDecoration: 'none' }}>
            Adherence
          </Link>
          {canEdit && schedule.length > 0 && (
            <button className="btn btn-danger" onClick={() => setShowClear(true)} style={{ fontSize: '0.82rem', marginLeft: 'auto' }}>
              Clear schedule
            </button>
          )}
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {[
            { label: 'Rows', value: stats.rows },
            { label: 'Reps', value: stats.reps },
            { label: 'Stores', value: stats.stores },
            { label: 'No channel', value: stats.noChannel, warn: stats.noChannel > 0 },
            { label: 'No site ID', value: stats.noStoreId, warn: stats.noStoreId > 0 },
          ].map(s => (
            <div key={s.label} style={{
              padding: '0.5rem 0.9rem', borderRadius: 8,
              background: s.warn ? '#fffbeb' : '#f9fafb',
              border: `1px solid ${s.warn ? '#fde68a' : '#e5e7eb'}`,
              minWidth: 92,
            }}>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: s.warn ? '#92400e' : '#111827' }}>{s.value}</div>
              <div style={{ fontSize: '0.68rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {(stats.noChannel > 0 || stats.noStoreId > 0) && (
          <div style={{ padding: '0.6rem 1rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: '0.8rem', color: '#92400e', marginBottom: '1rem' }}>
            Rows with a blank channel or site ID will not load into Perigee. Load the store control
            file under <strong>Control files</strong>, then re-upload the call cycle so the codes resolve.
          </div>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="input"
            placeholder="Search rep, store or site code..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth: 300, fontSize: '0.82rem' }}
          />
          <select className="input" value={userFilter} onChange={e => setUserFilter(e.target.value)} style={{ maxWidth: 220, fontSize: '0.82rem' }}>
            <option value="">All reps</option>
            {users.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select className="input" value={actionFilter} onChange={e => setActionFilter(e.target.value)} style={{ maxWidth: 160, fontSize: '0.82rem' }}>
            <option value="">All actions</option>
            {ACTION_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>
            {filtered.length} of {schedule.length} rows
          </span>
        </div>

        {/* Grid */}
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>Loading schedule…</div>
        ) : schedule.length === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: '#6b7280', border: '1px dashed #d1d5db', borderRadius: 10 }}>
            <p style={{ fontWeight: 600, color: '#374151' }}>No call cycle loaded yet.</p>
            <p style={{ fontSize: '0.85rem', marginTop: 6 }}>
              Upload the Perigee control files first, then a manager&apos;s call cycle spreadsheet.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white' }}>
              <thead>
                <tr>
                  <th style={th}>Rep</th>
                  <th style={th}>Team leader</th>
                  <th style={th}>Site ID</th>
                  <th style={th}>Store</th>
                  <th style={th}>Channel</th>
                  <th style={th}>Cycle</th>
                  <th style={th}>Days</th>
                  <th style={th}>Action</th>
                  {canEdit && <th style={th}></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ row, idx }) => {
                  const editing = editingIdx === idx;
                  if (editing && editRow) {
                    return (
                      <tr key={idx} style={{ background: '#fff7f7' }}>
                        <td style={td} colSpan={canEdit ? 9 : 8}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', padding: '0.4rem 0' }}>
                            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                              <input className="input" style={{ fontSize: '0.8rem', maxWidth: 220 }} value={editRow.userEmail}
                                onChange={e => setEditRow({ ...editRow, userEmail: e.target.value })} placeholder="Perigee email" />
                              <input className="input" style={{ fontSize: '0.8rem', maxWidth: 130 }} value={editRow.firstName}
                                onChange={e => setEditRow({ ...editRow, firstName: e.target.value })} placeholder="First name" />
                              <input className="input" style={{ fontSize: '0.8rem', maxWidth: 130 }} value={editRow.surname}
                                onChange={e => setEditRow({ ...editRow, surname: e.target.value })} placeholder="Surname" />
                            </div>
                            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                              <input className="input" style={{ fontSize: '0.8rem', maxWidth: 120 }} value={editRow.storeId}
                                onChange={e => setEditRow({ ...editRow, storeId: e.target.value })} placeholder="Site ID" />
                              <input className="input" style={{ fontSize: '0.8rem', maxWidth: 280 }} value={editRow.storeName}
                                onChange={e => setEditRow({ ...editRow, storeName: e.target.value })} placeholder="Store name" />
                              <input className="input" style={{ fontSize: '0.8rem', maxWidth: 180 }} value={editRow.channel}
                                onChange={e => setEditRow({ ...editRow, channel: e.target.value })} placeholder="Channel" />
                              <select className="input" style={{ fontSize: '0.8rem', maxWidth: 130 }} value={editRow.action}
                                onChange={e => setEditRow({ ...editRow, action: e.target.value as ScheduleRow['action'] })}>
                                {ACTION_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                              </select>
                            </div>
                            <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap' }}>
                              <div>
                                <div style={{ fontSize: '0.68rem', color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>Weeks</div>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  {ALL_WEEKS.map(w => {
                                    const on = parseCycleWeeks(editRow.cycle).includes(w);
                                    return (
                                      <button key={w} type="button" onClick={() => toggleWeek(w)} className="btn"
                                        style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', background: on ? '#e31e1c' : '#f3f4f6', color: on ? 'white' : '#374151', border: '1px solid ' + (on ? '#e31e1c' : '#e5e7eb') }}>
                                        {w}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: '0.68rem', color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>Days</div>
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                  {ALL_DAYS.map(d => {
                                    const on = editRow.days.includes(d);
                                    return (
                                      <button key={d} type="button" onClick={() => toggleDay(d)} className="btn"
                                        style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', background: on ? '#e31e1c' : '#f3f4f6', color: on ? 'white' : '#374151', border: '1px solid ' + (on ? '#e31e1c' : '#e5e7eb') }}>
                                        {d.slice(0, 3)}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize: '0.78rem' }}>
                                {saving ? 'Saving…' : 'Save'}
                              </button>
                              <button className="btn btn-outline" onClick={cancelEdit} style={{ fontSize: '0.78rem' }}>Cancel</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={idx}>
                      <td style={td}>
                        <div style={{ fontWeight: 600, color: '#111827' }}>
                          {`${row.firstName} ${row.surname}`.trim() || '—'}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>{row.userEmail || 'no email'}</div>
                      </td>
                      <td style={{ ...td, fontSize: '0.75rem', color: '#6b7280' }}>{row.teamLeader || '—'}</td>
                      <td style={{ ...td, fontFamily: 'monospace', color: row.storeId ? '#374151' : '#dc2626' }}>
                        {row.storeId || 'MISSING'}
                      </td>
                      <td style={td}>{row.storeName}</td>
                      <td style={{ ...td, color: row.channel ? '#374151' : '#dc2626' }}>{row.channel || 'MISSING'}</td>
                      <td style={td}>{formatCycle(row.cycle)}</td>
                      <td style={{ ...td, fontSize: '0.75rem' }}>{daysShort(row.days)}</td>
                      <td style={td}>
                        <span style={{ ...ACTION_STYLE[row.action], padding: '2px 8px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700 }}>
                          {row.action}
                        </span>
                      </td>
                      {canEdit && (
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          <button className="btn btn-outline" onClick={() => startEdit(idx)} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}>Edit</button>
                          <button className="btn btn-outline" onClick={() => handleDelete(idx)} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', marginLeft: 4, color: '#dc2626' }}>Delete</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <Footer />
      </main>

      {/* Clear-all confirmation */}
      {showClear && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ background: 'white', borderRadius: 12, padding: '1.5rem', maxWidth: 460, width: '90%' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#111827', marginBottom: '0.5rem' }}>
              Clear the entire schedule?
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#4b5563', marginBottom: '0.9rem' }}>
              This deletes all {schedule.length} rows. It does <strong>not</strong> touch anything already
              live in Perigee — but you will have to re-upload every manager&apos;s file to rebuild it.
              Type <strong>CLEAR</strong> to confirm.
            </p>
            <input className="input" value={clearInput} onChange={e => setClearInput(e.target.value)} placeholder="CLEAR" style={{ marginBottom: '0.9rem' }} />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => { setShowClear(false); setClearInput(''); }} style={{ fontSize: '0.82rem' }}>Cancel</button>
              <button className="btn btn-danger" onClick={handleClearAll} disabled={clearInput !== 'CLEAR' || clearing} style={{ fontSize: '0.82rem' }}>
                {clearing ? 'Clearing…' : 'Clear schedule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
