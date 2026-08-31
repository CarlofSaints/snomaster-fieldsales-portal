'use client';

import { useState, useEffect } from 'react';
import PasswordInput from '@/components/PasswordInput';
import { INACTIVE_MESSAGE } from '@/lib/accountStatus';

const SESSION_KEY = 'snomaster_session';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Shown when this account is deactivated, either because they just tried to
  // sign in or because they were switched off with a tab still open (useAuth
  // sends them here with ?inactive=1).
  const [inactive, setInactive] = useState(false);

  useEffect(() => {
    // Read from the URL directly rather than useSearchParams, which would need
    // a Suspense boundary around this page.
    if (new URLSearchParams(window.location.search).get('inactive') === '1') {
      setInactive(true);
    }
  }, []);

  // Forgot password state
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMsg, setForgotMsg] = useState('');

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setForgotMsg('');
    setForgotLoading(true);
    try {
      await fetch('/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      });
      setForgotMsg('If that email exists, a reset link has been sent. Check your inbox.');
    } catch {
      setForgotMsg('Network error. Please try again.');
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInactive(false);
    setLoading(true);

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.inactive) {
          setInactive(true);
          setError('');
        } else {
          setError(data.error || 'Login failed');
        }
        setLoading(false);
        return;
      }

      localStorage.setItem(SESSION_KEY, JSON.stringify(data));
      window.location.href = data.forcePasswordChange ? '/account?change-password=1' : '/dashboard';
    } catch {
      setError('Network error');
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundImage: 'none',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundColor: '#e31e1c',
        padding: '1rem',
        position: 'relative',
      }}
    >
      {/* Dark overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(135deg, rgba(227,30,28,0.85) 0%, rgba(26,26,46,0.9) 100%)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          background: 'rgba(255,255,255,0.97)',
          borderRadius: 16,
          padding: '2.5rem 2rem',
          width: '100%',
          maxWidth: 400,
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img
            src="/snomaster-logo.png"
            alt="SnoMaster"
            style={{ height: 48, objectFit: 'contain', marginBottom: 12 }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          <h1 style={{ fontSize: '1.1rem', color: '#374151', margin: 0, fontWeight: 600 }}>
            BA Measurement
          </h1>
          <p style={{ color: '#9ca3af', fontSize: '0.8rem', margin: '4px 0 0' }}>
            Sign in to your account
          </p>
        </div>

        {inactive && (
          <div
            role="alert"
            style={{
              display: 'flex',
              gap: '0.6rem',
              alignItems: 'flex-start',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderLeft: '4px solid #e31e1c',
              borderRadius: 8,
              padding: '0.85rem 1rem',
              marginBottom: '1.5rem',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e31e1c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#991b1b', marginBottom: 3 }}>
                Account unavailable
              </div>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#7f1d1d', lineHeight: 1.5 }}>
                {INACTIVE_MESSAGE}
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#374151', marginBottom: 4, fontWeight: 500 }}>
              Email
            </label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              placeholder="you@company.com"
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#374151', marginBottom: 4, fontWeight: 500 }}>
              Password
            </label>
            <PasswordInput value={password} onChange={setPassword} placeholder="Enter password" required />
          </div>

          {error && (
            <div style={{ color: '#dc2626', fontSize: '0.8rem', marginBottom: '1rem', textAlign: 'center' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', justifyContent: 'center', padding: '0.65rem', fontSize: '0.9rem' }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <button
            onClick={() => { setShowForgot(!showForgot); setForgotMsg(''); }}
            style={{ background: 'none', border: 'none', color: '#e31e1c', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Forgot My Password?
          </button>
        </div>

        {showForgot && (
          <form onSubmit={handleForgot} style={{ marginTop: '1rem', padding: '1rem', background: '#f3f4f6', borderRadius: 8 }}>
            <p style={{ fontSize: '0.8rem', color: '#374151', margin: '0 0 0.75rem' }}>
              Enter your email and we&apos;ll send you a reset link.
            </p>
            <input
              className="input"
              type="email"
              value={forgotEmail}
              onChange={e => setForgotEmail(e.target.value)}
              required
              placeholder="you@company.com"
              style={{ marginBottom: '0.75rem' }}
            />
            {forgotMsg && (
              <div style={{ fontSize: '0.8rem', color: forgotMsg.includes('error') ? '#dc2626' : '#059669', marginBottom: '0.75rem' }}>
                {forgotMsg}
              </div>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={forgotLoading}
              style={{ width: '100%', justifyContent: 'center', padding: '0.5rem', fontSize: '0.8rem' }}
            >
              {forgotLoading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
