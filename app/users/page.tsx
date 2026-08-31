'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth, authFetch } from '@/lib/useAuth';
import type { Role } from '@/lib/userData';
import Sidebar from '@/components/Sidebar';
import Toast from '@/components/Toast';
import Footer from '@/components/Footer';
import PasswordInput from '@/components/PasswordInput';
import { INACTIVE_MESSAGE } from '@/lib/accountStatus';

interface UserRow {
  id: string;
  email: string;
  name: string;
  surname: string;
  cellNumber?: string;
  role: Role;
  /** Absent means active — see lib/accountStatus.ts. */
  active?: boolean;
  forcePasswordChange: boolean;
  createdAt: string;
}

/**
 * Fallback only. Roles are data — the real list is fetched from /api/roles so
 * that Sales, Marketing, MD and any role created on /roles all show up here
 * without this file needing to know about them.
 */
const FALLBACK_ROLES: { value: Role; label: string }[] = [
  { value: 'client', label: 'Client' },
  { value: 'sales', label: 'Sales' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'admin', label: 'Admin' },
  { value: 'md', label: 'MD' },
  { value: 'super_admin', label: 'Super Admin' },
];

interface UserForm {
  email: string;
  name: string;
  surname: string;
  cellNumber: string;
  role: Role;
  password: string;
  forcePasswordChange: boolean;
  sendWelcomeEmail: boolean;
}

export default function UsersPage() {
  const { session, loading: authLoading, logout } = useAuth('system.users.view');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [form, setForm] = useState<UserForm>({ email: '', name: '', surname: '', cellNumber: '', role: 'client', password: '', forcePasswordChange: true, sendWelcomeEmail: true });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [roles, setRoles] = useState<{ value: Role; label: string; description?: string }[]>(FALLBACK_ROLES);

  const loadUsers = useCallback(async () => {
    try {
      const res = await authFetch('/api/users');
      if (res.ok) setUsers(await res.json());
    } catch { /* ignore */ }
  }, []);

  // Roles are data, so pull the live list rather than hardcoding it.
  const loadRoles = useCallback(async () => {
    try {
      const res = await authFetch('/api/roles');
      if (!res.ok) return;
      const list: { name: string; label: string; description?: string }[] = await res.json();
      if (Array.isArray(list) && list.length) {
        setRoles(list.map(r => ({ value: r.name, label: r.label || r.name, description: r.description })));
      }
    } catch { /* keep the fallback */ }
  }, []);

  useEffect(() => {
    if (session) { loadUsers(); loadRoles(); }
  }, [session, loadUsers, loadRoles]);

  function openCreate() {
    setEditUser(null);
    setForm({ email: '', name: '', surname: '', cellNumber: '', role: 'client', password: '', forcePasswordChange: true, sendWelcomeEmail: true });
    setShowModal(true);
  }

  function openEdit(u: UserRow) {
    setEditUser(u);
    setForm({ email: u.email, name: u.name, surname: u.surname, cellNumber: u.cellNumber || '', role: u.role, password: '', forcePasswordChange: false, sendWelcomeEmail: false });
    setShowModal(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (editUser) {
        const body: Record<string, unknown> = {};
        if (form.name !== editUser.name) body.name = form.name;
        if (form.surname !== editUser.surname) body.surname = form.surname;
        if (form.email !== editUser.email) body.email = form.email;
        if (form.role !== editUser.role) body.role = form.role;
        if (form.cellNumber !== (editUser.cellNumber || '')) body.cellNumber = form.cellNumber;
        if (form.password) {
          body.password = form.password;
          body.forcePasswordChange = form.forcePasswordChange;
        }

        const res = await authFetch(`/api/users/${editUser.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json();
          setToast({ msg: data.error || 'Update failed', type: 'error' });
          setSaving(false);
          return;
        }
        setToast({ msg: 'User updated', type: 'success' });
      } else {
        const res = await authFetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...form,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          setToast({ msg: data.error || 'Create failed', type: 'error' });
          setSaving(false);
          return;
        }
        setToast({ msg: 'User created', type: 'success' });
      }
      setShowModal(false);
      loadUsers();
    } catch {
      setToast({ msg: 'Failed', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  /**
   * Switch sign-in on or off. This is deliberately NOT delete: the record, the
   * role and every score, visit and training row the person owns stay exactly
   * as they are, and reactivating restores access with their existing password.
   */
  async function toggleActive(u: UserRow) {
    const deactivating = u.active !== false;
    const who = `${u.name} ${u.surname}`;
    const ok = confirm(
      deactivating
        ? `Deactivate ${who}?

They keep everything — role, scores, visits, training and history all stay exactly as they are. They simply cannot sign in, and any session they still have open stops working.

You can reactivate them at any time.`
        : `Reactivate ${who}?

They will be able to sign in again with their existing password.`,
    );
    if (!ok) return;

    try {
      const res = await authFetch(`/api/users/${u.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !deactivating }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ msg: data.error || (deactivating ? 'Deactivate failed' : 'Reactivate failed'), type: 'error' });
        return;
      }
      setToast({
        msg: deactivating ? `${who} deactivated — they can no longer sign in` : `${who} reactivated`,
        type: 'success',
      });
      loadUsers();
    } catch {
      setToast({ msg: deactivating ? 'Deactivate failed' : 'Reactivate failed', type: 'error' });
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this user?')) return;
    try {
      const res = await authFetch(`/api/users/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setToast({ msg: 'User deleted', type: 'success' });
        loadUsers();
      } else {
        const data = await res.json();
        setToast({ msg: data.error || 'Delete failed', type: 'error' });
      }
    } catch {
      setToast({ msg: 'Delete failed', type: 'error' });
    }
  }

  async function handlePurge(u: { id: string; name: string; surname: string; email: string }) {
    if (!confirm(`PURGE ${u.name} ${u.surname} (${u.email})?\n\nThis permanently removes the account AND all their scores, visits and training records from every upload — as if they were never in the data. This cannot be undone.`)) return;
    try {
      const res = await authFetch(`/api/users/${u.id}/purge`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const p = data.purged || {};
        setToast({ msg: `Purged ${u.name} ${u.surname} — ${p.visitsRemoved ?? 0} visits, ${p.scoresRemoved ?? 0} scores, ${p.trainingRemoved ?? 0} training removed.`, type: 'success' });
        loadUsers();
      } else {
        setToast({ msg: data.error || 'Purge failed', type: 'error' });
      }
    } catch {
      setToast({ msg: 'Purge failed', type: 'error' });
    }
  }

  async function sendWelcome(userId: string) {
    try {
      const res = await authFetch('/api/users/send-welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const data = await res.json();
        setToast({ msg: data.error || 'Send failed', type: 'error' });
        return;
      }
      const result = await res.json();
      if (result.emailSent) {
        setToast({ msg: 'Welcome email sent', type: 'success' });
      } else {
        setToast({ msg: `Email failed. Temp password: ${result.tempPassword}`, type: 'error' });
      }
    } catch {
      setToast({ msg: 'Failed to send welcome email', type: 'error' });
    }
  }

  if (authLoading || !session) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>Loading...</div>;
  }

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar role={session.role} name={`${session.name} ${session.surname}`} onLogout={logout} />
      <main style={{ flex: 1, padding: '2rem', minHeight: '100vh' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#111827', margin: 0 }}>Users</h1>
            <p style={{ color: '#6b7280', fontSize: '0.85rem', margin: '4px 0 0' }}>Manage system users</p>
          </div>
          <button className="btn btn-primary" onClick={openCreate}>+ Add User</button>
        </div>

        {/* So an admin can see exactly what a locked-out user is being told. */}
        {users.some(u => u.active === false) && (
          <div
            style={{
              display: 'flex',
              gap: '0.6rem',
              alignItems: 'flex-start',
              background: '#fff7f7',
              border: '1px solid #fecaca',
              borderLeft: '4px solid #e31e1c',
              borderRadius: 8,
              padding: '0.75rem 1rem',
              marginBottom: '1rem',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e31e1c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div style={{ fontSize: '0.78rem', color: '#7f1d1d', lineHeight: 1.5 }}>
              <strong>{users.filter(u => u.active === false).length} deactivated account{users.filter(u => u.active === false).length === 1 ? '' : 's'}.</strong>{' '}
              Their data is untouched, they simply cannot sign in. On the login screen they see:
              <em style={{ display: 'block', marginTop: 2 }}>&ldquo;{INACTIVE_MESSAGE}&rdquo;</em>
            </div>
          </div>
        )}

        <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e5e7eb' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Cell</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th style={{ width: 260 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={u.active === false ? { background: '#fff7f7' } : undefined}>
                  <td>{u.name} {u.surname}</td>
                  <td>{u.email}</td>
                  <td>{u.cellNumber || '-'}</td>
                  <td style={{ textTransform: 'capitalize' }}>{u.role.replace('_', ' ')}</td>
                  <td>
                    {/* An account with no flag at all is active, and says so. */}
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '0.12rem 0.55rem',
                        borderRadius: 999,
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        ...(u.active === false
                          ? { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' }
                          : { background: '#d1fae5', color: '#065f46', border: '1px solid #6ee7b7' }),
                      }}
                    >
                      {u.active === false ? 'Inactive' : 'Active'}
                    </span>
                  </td>
                  <td>{new Date(u.createdAt).toLocaleDateString('en-ZA')}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        className="btn btn-outline"
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                        onClick={() => sendWelcome(u.id)}
                        title="Send welcome email with new credentials"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}>
                          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                          <polyline points="22,6 12,13 2,6" />
                        </svg>
                      </button>
                      <button className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => openEdit(u)}>Edit</button>
                      {u.id !== session.id && (
                        <button
                          className="btn btn-outline"
                          style={{
                            padding: '0.2rem 0.5rem',
                            fontSize: '0.75rem',
                            ...(u.active === false
                              ? { color: '#047857', borderColor: '#6ee7b7' }
                              : { color: '#b45309', borderColor: '#fcd34d' }),
                          }}
                          onClick={() => toggleActive(u)}
                          title={u.active === false
                            ? 'Allow this user to sign in again'
                            : 'Block sign-in but keep the account and all of their data'}
                        >
                          {u.active === false ? 'Reactivate' : 'Deactivate'}
                        </button>
                      )}
                      <button className="btn btn-danger" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => handleDelete(u.id)}>Delete</button>
                      {session.role === 'super_admin' && (
                        <button
                          className="btn btn-danger"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', background: '#7f1d1d' }}
                          onClick={() => handlePurge(u)}
                          title="Remove the user AND all their scores, visits & training data"
                        >
                          Purge
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: '#9ca3af', padding: '2rem' }}>No users</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <Footer />

        {/* Modal */}
        {showModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onMouseDown={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
            <div style={{ background: 'white', borderRadius: 14, padding: '1.75rem', width: '100%', maxWidth: 440, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }} onMouseDown={e => e.stopPropagation()}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1.25rem' }}>
                {editUser ? 'Edit User' : 'Add User'}
              </h2>
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#374151', marginBottom: 4 }}>Name</label>
                    <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#374151', marginBottom: 4 }}>Surname</label>
                    <input className="input" value={form.surname} onChange={e => setForm({ ...form, surname: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#374151', marginBottom: 4 }}>Email</label>
                  <input className="input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#374151', marginBottom: 4 }}>Cell Number</label>
                  <input className="input" type="tel" value={form.cellNumber} onChange={e => setForm({ ...form, cellNumber: e.target.value })} placeholder="e.g. 082 123 4567" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#374151', marginBottom: 4 }}>Role</label>
                  <select className="select" style={{ width: '100%' }} value={form.role} onChange={e => setForm({ ...form, role: e.target.value as Role })}>
                    {roles.filter(r => session.role === 'super_admin' || r.value !== 'super_admin').map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                  {roles.find(r => r.value === form.role)?.description && (
                    <p style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 4 }}>
                      {roles.find(r => r.value === form.role)!.description}
                    </p>
                  )}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#374151', marginBottom: 4 }}>
                    {editUser ? 'Reset Password (leave blank to keep)' : 'Password (leave blank for auto-generated)'}
                  </label>
                  <PasswordInput value={form.password} onChange={pw => setForm({ ...form, password: pw })} placeholder={editUser ? 'Leave blank to keep' : 'Auto-generated if empty'} />
                </div>

                {/* Checkboxes */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#374151', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={form.forcePasswordChange}
                      onChange={e => setForm({ ...form, forcePasswordChange: e.target.checked })}
                      style={{ width: 16, height: 16 }}
                    />
                    Force password change on first login
                  </label>
                  {!editUser && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#374151', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={form.sendWelcomeEmail}
                        onChange={e => setForm({ ...form, sendWelcomeEmail: e.target.checked })}
                        style={{ width: 16, height: 16 }}
                      />
                      Send welcome email
                    </label>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.email || !form.name || !form.surname}>
                  {saving ? 'Saving...' : editUser ? 'Save' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
