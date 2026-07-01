'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth, authFetch } from '@/lib/useAuth';
import Sidebar from '@/components/Sidebar';
import Toast from '@/components/Toast';
import Footer from '@/components/Footer';

interface StoreMaster {
  perigeeCode: string;
  storeName: string;
  channelId: string;
  channelName?: string;
  area?: string;
  assignedBaEmail?: string;
  assignedBaName?: string;
  salesName?: string;
  salesCode?: string;
  notInData?: boolean;
  isDc?: boolean;
  source?: 'visit' | 'sales' | 'manual';
  siteCode?: string;
  siteName?: string;       // resolved from retailer site file (read-only)
  siteProvince?: string;
  siteSubChannel?: string;
  _id: number; // runtime-only stable key
}

interface Channel {
  id: string;
  name: string;
}

interface BAOption {
  email: string;
  repName: string;
  lastSeen: string;
}

type Tab = 'all' | 'needsLink' | 'orphanSales' | 'notInData' | 'linked';

/** Store names that look like a distribution centre / warehouse (never visited). */
const DC_NAME_RE = /\bdc\b|ware\s*house|distribution\s*cent/i;

/** A store that has been visited (carries a Perigee code). */
function isVisited(s: StoreMaster): boolean {
  return !!(s.perigeeCode && s.perigeeCode.trim());
}
/** A store that has a sales feed linked. */
function isLinked(s: StoreMaster): boolean {
  return !!(s.salesName && s.salesName.trim());
}
/** Sales data with no matching visited store yet (DCs are never visited, so excluded). */
function isOrphanSales(s: StoreMaster): boolean {
  return !isVisited(s) && isLinked(s) && !s.isDc;
}
/** Visited store that needs attention: no sales feed and not marked "not in data". */
function needsLink(s: StoreMaster): boolean {
  return isVisited(s) && !isLinked(s) && !s.notInData;
}

export default function StoresPage() {
  const { session, loading: authLoading, logout } = useAuth(['super_admin', 'admin']);
  const [stores, setStores] = useState<StoreMaster[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [bas, setBas] = useState<BAOption[]>([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Link modal: pick a counterpart row to merge with `linkSource`.
  const [linkSource, setLinkSource] = useState<StoreMaster | null>(null);
  const [linkSearch, setLinkSearch] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [storesRes, channelsRes, basRes] = await Promise.all([
        authFetch('/api/stores'),
        authFetch('/api/channels'),
        authFetch('/api/bas'),
      ]);
      if (storesRes.ok) {
        const raw: StoreMaster[] = await storesRes.json();
        setStores(raw.map((s, i) => ({ ...s, _id: i })));
      }
      if (channelsRes.ok) setChannels(await channelsRes.json());
      if (basRes.ok) setBas(await basRes.json());
      setDirty(false);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (session) loadData();
  }, [session, loadData]);

  // DC / warehouse rows live in their own grid at the bottom, so the main grid
  // (and its tab counts) only cover real, visitable stores.
  const nonDcStores = useMemo(() => stores.filter(s => !s.isDc), [stores]);
  const dcStores = useMemo(() => stores.filter(s => s.isDc), [stores]);

  const counts = useMemo(() => ({
    all: nonDcStores.length,
    needsLink: nonDcStores.filter(needsLink).length,
    orphanSales: nonDcStores.filter(isOrphanSales).length,
    notInData: nonDcStores.filter(s => s.notInData).length,
    dc: dcStores.length,
    linked: nonDcStores.filter(isLinked).length,
  }), [nonDcStores, dcStores]);

  const matchesSearch = useCallback((s: StoreMaster, q: string) =>
    !q ||
    s.storeName.toLowerCase().includes(q) ||
    (s.siteName || '').toLowerCase().includes(q) ||
    (s.salesName || '').toLowerCase().includes(q) ||
    (s.perigeeCode || '').toLowerCase().includes(q) ||
    (s.salesCode || '').toLowerCase().includes(q) ||
    (s.area || '').toLowerCase().includes(q), []);

  const filtered = useMemo(() => {
    let list = nonDcStores;
    if (tab === 'needsLink') list = list.filter(needsLink);
    else if (tab === 'orphanSales') list = list.filter(isOrphanSales);
    else if (tab === 'notInData') list = list.filter(s => s.notInData);
    else if (tab === 'linked') list = list.filter(isLinked);

    const q = search.toLowerCase().trim();
    return q ? list.filter(s => matchesSearch(s, q)) : list;
  }, [nonDcStores, tab, search, matchesSearch]);

  const dcFiltered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return q ? dcStores.filter(s => matchesSearch(s, q)) : dcStores;
  }, [dcStores, search, matchesSearch]);

  function update(id: number, patch: Partial<StoreMaster>) {
    setStores(prev => prev.map(s => (s._id === id ? { ...s, ...patch } : s)));
    setDirty(true);
  }

  function toggleNotInData(s: StoreMaster) {
    update(s._id, { notInData: !s.notInData });
  }

  function toggleDc(s: StoreMaster) {
    update(s._id, { isDc: !s.isDc });
  }

  /** Bulk-tag every store whose name looks like a DC / warehouse. */
  function autoTagDcs() {
    let n = 0;
    setStores(prev => prev.map(s => {
      const looksDc = DC_NAME_RE.test(`${s.storeName} ${s.salesName || ''}`);
      if (looksDc && !s.isDc) { n++; return { ...s, isDc: true }; }
      return s;
    }));
    setDirty(true);
    setToast({ msg: n > 0 ? `Tagged ${n} DC/warehouse store${n > 1 ? 's' : ''} — review the DCs tab, then Save.` : 'No untagged DC/warehouse names found.', type: 'success' });
  }

  function unlinkSales(s: StoreMaster) {
    // Detach the sales feed and re-create it as an orphan sales row so it can be
    // re-linked later (the underlying sales data still exists, keyed by name).
    setStores(prev => {
      const next = prev.map(x => (x._id === s._id ? { ...x, salesName: '', salesCode: '', siteCode: '' } : x));
      if (s.salesName) {
        const newId = Math.max(0, ...next.map(x => x._id)) + 1;
        next.push({
          _id: newId, perigeeCode: '', storeName: s.salesName,
          salesName: s.salesName, salesCode: s.salesCode || '', siteCode: s.salesCode || '',
          channelId: '', source: 'sales',
        });
      }
      return next;
    });
    setDirty(true);
  }

  /** Merge a visited (Perigee) row and a sales row into one canonical row. */
  function merge(visited: StoreMaster, sales: StoreMaster) {
    setStores(prev => {
      const next = prev
        .filter(x => x._id !== sales._id)
        .map(x => x._id === visited._id
          ? { ...x, salesName: sales.salesName || '', salesCode: sales.salesCode || '', siteCode: sales.salesCode || '', channelId: x.channelId || sales.channelId }
          : x);
      return next;
    });
    setDirty(true);
    setLinkSource(null);
    setLinkSearch('');
    setToast({ msg: 'Linked — remember to Save', type: 'success' });
  }

  // Candidate rows for the link modal (opposite type of the source).
  const linkCandidates = useMemo(() => {
    if (!linkSource) return [];
    const sourceIsVisited = isVisited(linkSource);
    let list = stores.filter(s => s._id !== linkSource._id);
    list = sourceIsVisited ? list.filter(isOrphanSales) : list.filter(s => isVisited(s) && !isLinked(s));
    const q = linkSearch.toLowerCase().trim();
    if (q) {
      list = list.filter(s =>
        s.storeName.toLowerCase().includes(q) ||
        (s.salesName || '').toLowerCase().includes(q) ||
        (s.perigeeCode || '').toLowerCase().includes(q) ||
        (s.salesCode || '').toLowerCase().includes(q)
      );
    }
    return list.slice(0, 100);
  }, [linkSource, stores, linkSearch]);

  function pickCandidate(candidate: StoreMaster) {
    if (!linkSource) return;
    const visited = isVisited(linkSource) ? linkSource : candidate;
    const sales = isVisited(linkSource) ? candidate : linkSource;
    merge(visited, sales);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = stores.map(({ _id, channelName, ...rest }) => { void _id; void channelName; return rest; });
      const res = await authFetch('/api/stores', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stores: payload }),
      });
      if (res.ok) {
        setDirty(false);
        setToast({ msg: 'Stores saved', type: 'success' });
        loadData();
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

  async function handleSyncVisited() {
    if (dirty && !confirm('You have unsaved changes that will be discarded by the sync (it reloads from the server). Continue?')) return;
    setSyncing(true);
    try {
      const res = await authFetch('/api/stores/sync-visited', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ msg: `Synced ${data.visitsProcessed} visits — ${data.newVisitedRows} new store(s), ${data.newlyLinked} newly linked, ${data.unlinkedRemaining} still need linking.`, type: 'success' });
        loadData();
      } else {
        setToast({ msg: data.error || 'Sync failed', type: 'error' });
      }
    } catch {
      setToast({ msg: 'Sync failed', type: 'error' });
    } finally {
      setSyncing(false);
    }
  }

  if (authLoading || !session) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>Loading...</div>;
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'needsLink', label: 'Needs linking', count: counts.needsLink },
    { key: 'orphanSales', label: 'Sales w/o store', count: counts.orphanSales },
    { key: 'notInData', label: 'Not in data', count: counts.notInData },
    { key: 'linked', label: 'Linked', count: counts.linked },
  ];

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar role={session.role} name={`${session.name} ${session.surname}`} onLogout={logout} />
      <main style={{ flex: 1, padding: '2rem', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#111827', marginBottom: '0.25rem' }}>
          Stores
        </h1>
        <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: '1rem' }}>
          Every visited store appears here with its Perigee code. Link each store to its sales feed
          (Makro / Hirsch&apos;s), or mark stores that have no sales data as &quot;Not in data&quot;.
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={handleSyncVisited} disabled={syncing} style={{ fontSize: '0.82rem' }}>
            {syncing ? 'Syncing…' : 'Sync visited stores from history'}
          </button>
          <button className="btn btn-outline" onClick={autoTagDcs} style={{ fontSize: '0.82rem' }}>
            Auto-tag DCs &amp; warehouses
          </button>
          <span style={{ fontSize: '0.75rem', color: '#6b7280', maxWidth: 520 }}>
            <strong>Sync</strong> pulls every store from the visit history and auto-links it to its sales
            feed by name (Perigee codes like <code>HS07</code> differ from site codes like <code>120</code>).
            <strong> Auto-tag DCs</strong> flags distribution centres / warehouses that appear in sales data
            but are never visited, so they stop showing as &quot;sales without a store&quot;.
          </span>
        </div>

        {counts.needsLink > 0 && (
          <div style={{ padding: '0.6rem 1rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: '0.8rem', color: '#92400e', marginBottom: '1rem' }}>
            {counts.needsLink} visited store{counts.needsLink > 1 ? 's' : ''} not yet linked to sales data — link them or mark &quot;Not in data&quot;.
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="btn"
              style={{
                fontSize: '0.78rem', padding: '0.35rem 0.7rem',
                background: tab === t.key ? '#e31e1c' : '#f3f4f6',
                color: tab === t.key ? 'white' : '#374151',
                border: '1px solid ' + (tab === t.key ? '#e31e1c' : '#e5e7eb'),
              }}
            >
              {t.label} <span style={{ opacity: 0.75 }}>({t.count})</span>
            </button>
          ))}
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="input"
            placeholder="Search stores..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ minWidth: 200, maxWidth: 300 }}
          />
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? 'Saving...' : 'Save All'}
          </button>
          {dirty && <span style={{ fontSize: '0.75rem', color: '#dc2626' }}>Unsaved changes</span>}
          <span style={{ fontSize: '0.75rem', color: '#6b7280', marginLeft: 'auto' }}>
            {filtered.length} of {nonDcStores.length} stores{counts.dc > 0 ? ` · ${counts.dc} DC` : ''}
          </span>
        </div>

        {/* Table */}
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden', flex: 1 }}>
          <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Perigee Code</th>
                  <th>Store Name</th>
                  <th style={{ width: 220 }}>Sales Link</th>
                  <th style={{ width: 140 }}>Area</th>
                  <th style={{ width: 160 }}>Channel</th>
                  <th style={{ width: 180 }}>Assigned BA</th>
                  <th style={{ width: 150 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: '#9ca3af', padding: '2rem' }}>
                      {stores.length === 0 ? 'No stores yet — poll Perigee visits or upload sales data to populate' : 'No matches'}
                    </td>
                  </tr>
                ) : (
                  filtered.map(store => {
                    const rowBg = needsLink(store) ? '#fffbeb'
                      : store.notInData ? '#f9fafb'
                      : isOrphanSales(store) ? '#eff6ff'
                      : undefined;
                    return (
                      <tr key={store._id} style={rowBg ? { background: rowBg } : undefined}>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{store.perigeeCode || '—'}</td>
                        <td>
                          {store.storeName || store.siteName || <span style={{ color: '#9ca3af' }}>—</span>}
                          {!store.storeName && store.siteName && (
                            <span style={{ marginLeft: 6, fontSize: '0.65rem', color: '#047857', background: '#d1fae5', padding: '1px 6px', borderRadius: 4 }}>site file</span>
                          )}
                          {isOrphanSales(store) && (
                            <span style={{ marginLeft: 6, fontSize: '0.65rem', color: '#1d4ed8', background: '#dbeafe', padding: '1px 6px', borderRadius: 4 }}>sales only</span>
                          )}
                          {store.isDc && (
                            <span style={{ marginLeft: 6, fontSize: '0.65rem', color: '#92400e', background: '#fef3c7', padding: '1px 6px', borderRadius: 4 }}>DC</span>
                          )}
                          {(store.siteProvince || store.siteSubChannel) && (
                            <div style={{ fontSize: '0.68rem', color: '#9ca3af' }}>
                              {[store.siteSubChannel, store.siteProvince].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </td>
                        <td style={{ fontSize: '0.78rem' }}>
                          {isLinked(store) ? (
                            <span>
                              <span style={{ fontFamily: 'monospace', color: '#6b7280' }}>{store.salesCode || '—'}</span>
                              {' '}{store.salesName}
                            </span>
                          ) : store.notInData ? (
                            <span style={{ color: '#9ca3af' }}>Not in data</span>
                          ) : (
                            <span style={{ color: '#dc2626' }}>Not linked</span>
                          )}
                        </td>
                        <td>
                          <input
                            className="input"
                            value={store.area || ''}
                            onChange={e => update(store._id, { area: e.target.value })}
                            placeholder="—"
                            style={{ width: '100%', fontSize: '0.8rem' }}
                          />
                        </td>
                        <td>
                          <select
                            className="select"
                            value={store.channelId}
                            onChange={e => update(store._id, { channelId: e.target.value })}
                            style={{ width: '100%', fontSize: '0.8rem' }}
                          >
                            <option value="">— Select —</option>
                            {channels.map(ch => (
                              <option key={ch.id} value={ch.id}>{ch.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            className="select"
                            value={store.assignedBaEmail || ''}
                            onChange={e => {
                              const ba = bas.find(b => b.email === e.target.value);
                              update(store._id, { assignedBaEmail: e.target.value, assignedBaName: ba?.repName || '' });
                            }}
                            style={{ width: '100%', fontSize: '0.8rem' }}
                            title="Override which BA gets credited for this store. Leave on Auto to derive from Perigee visits."
                          >
                            <option value="">— Auto (from visits) —</option>
                            {store.assignedBaEmail && !bas.some(b => b.email === store.assignedBaEmail) && (
                              <option value={store.assignedBaEmail}>{store.assignedBaName || store.assignedBaEmail}</option>
                            )}
                            {bas.map(b => (
                              <option key={b.email} value={b.email}>{b.repName}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ fontSize: '0.75rem' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {isLinked(store) ? (
                              <button className="btn" onClick={() => unlinkSales(store)} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}>
                                Unlink sales
                              </button>
                            ) : (
                              <button className="btn" onClick={() => { setLinkSource(store); setLinkSearch(''); }} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}>
                                {isVisited(store) ? '＋ Link sales' : '＋ Link to store'}
                              </button>
                            )}
                            {isVisited(store) && !isLinked(store) && (
                              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: '#6b7280' }}>
                                <input type="checkbox" checked={!!store.notInData} onChange={() => toggleNotInData(store)} />
                                Not in data
                              </label>
                            )}
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: '#6b7280' }} title="Distribution centre / warehouse — appears in sales data but is never visited by a rep.">
                              <input type="checkbox" checked={!!store.isDc} onChange={() => toggleDc(store)} />
                              DC (no visits)
                            </label>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* DC / warehouse grid — kept separate so the main list stays clean */}
        {dcStores.length > 0 && (
          <div style={{ marginTop: '2rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#111827', marginBottom: '0.2rem' }}>
              Distribution Centres &amp; Warehouses ({dcFiltered.length}{search ? ` of ${dcStores.length}` : ''})
            </h2>
            <p style={{ color: '#6b7280', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
              These appear in sales/stock data but are never visited by a rep. Untick &quot;DC&quot; to move a
              row back into the main list. Remember to <strong>Save</strong>.
            </p>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto', maxHeight: 420 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 100 }}>Sales Code</th>
                      <th>Store Name</th>
                      <th style={{ width: 160 }}>Channel</th>
                      <th style={{ width: 120 }}>DC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dcFiltered.length === 0 ? (
                      <tr><td colSpan={4} style={{ textAlign: 'center', color: '#9ca3af', padding: '1.5rem' }}>No matches</td></tr>
                    ) : dcFiltered.map(store => (
                      <tr key={store._id} style={{ background: '#fffdf5' }}>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{store.salesCode || store.perigeeCode || '—'}</td>
                        <td>{store.salesName || store.storeName || <span style={{ color: '#9ca3af' }}>—</span>}</td>
                        <td>
                          <select
                            className="select"
                            value={store.channelId}
                            onChange={e => update(store._id, { channelId: e.target.value })}
                            style={{ width: '100%', fontSize: '0.8rem' }}
                          >
                            <option value="">— Select —</option>
                            {channels.map(ch => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
                          </select>
                        </td>
                        <td>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: '#6b7280', fontSize: '0.78rem' }}>
                            <input type="checkbox" checked={!!store.isDc} onChange={() => toggleDc(store)} />
                            DC
                          </label>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        <Footer />
      </main>

      {/* Link modal */}
      {linkSource && (
        <div
          onClick={() => setLinkSource(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 12, padding: '1.5rem', width: 'min(560px, 92vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
          >
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 4 }}>
              {isVisited(linkSource) ? 'Link sales data' : 'Link to a visited store'}
            </h2>
            <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.75rem' }}>
              {isVisited(linkSource)
                ? <>Linking sales data to <strong>{linkSource.storeName}</strong> <span style={{ fontFamily: 'monospace' }}>({linkSource.perigeeCode})</span>.</>
                : <>Linking sales entry <strong>{linkSource.salesName}</strong> to a Perigee store.</>}
            </p>
            <input
              className="input"
              autoFocus
              placeholder="Search..."
              value={linkSearch}
              onChange={e => setLinkSearch(e.target.value)}
              style={{ marginBottom: '0.75rem' }}
            />
            <div style={{ overflowY: 'auto', flex: 1, border: '1px solid #e5e7eb', borderRadius: 8 }}>
              {linkCandidates.length === 0 ? (
                <div style={{ padding: '1.5rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.85rem' }}>
                  {isVisited(linkSource) ? 'No unlinked sales entries found.' : 'No unlinked visited stores found.'}
                </div>
              ) : (
                linkCandidates.map(c => (
                  <button
                    key={c._id}
                    onClick={() => pickCandidate(c)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.55rem 0.8rem', border: 'none', borderBottom: '1px solid #f3f4f6', background: 'white', cursor: 'pointer', fontSize: '0.82rem' }}
                  >
                    {isVisited(linkSource) ? (
                      <><span style={{ fontFamily: 'monospace', color: '#6b7280' }}>{c.salesCode || '—'}</span> {c.salesName}</>
                    ) : (
                      <><span style={{ fontFamily: 'monospace', color: '#6b7280' }}>{c.perigeeCode}</span> {c.storeName}</>
                    )}
                  </button>
                ))
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.9rem' }}>
              <button className="btn" onClick={() => setLinkSource(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
