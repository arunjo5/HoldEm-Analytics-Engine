import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

const AuthContext = createContext(null);

async function getCsrfToken() {
  const r = await fetch('/api/auth/csrf', { credentials: 'include' });
  const { csrfToken } = await r.json();
  return csrfToken;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/session', { credentials: 'include' });
      if (!r.ok) { setUser(null); return null; }
      const data = await r.json();
      setUser(data?.user ?? null);
      return data?.user ?? null;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  function signIn() {
    setModalError(null);
    setModalOpen(true);
  }

  async function submitCredentials({ username, password, name, mode }) {
    setModalBusy(true);
    setModalError(null);
    try {
      if (mode === 'signup') {
        const r = await fetch('/api/auth/signup', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, name }),
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error(e.error || `Sign up failed (${r.status})`);
        }
      }
      const csrf = await getCsrfToken();
      const body = new URLSearchParams({
        csrfToken: csrf,
        username,
        password,
        callbackUrl: window.location.origin,
        redirect: 'false',
      });
      await fetch('/api/auth/callback/credentials', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const u = await refresh();
      if (!u) throw new Error('Invalid username or password');
      setModalOpen(false);
    } catch (e) {
      setModalError(e.message || 'Something went wrong');
    } finally {
      setModalBusy(false);
    }
  }

  async function signOut() {
    const csrf = await getCsrfToken();
    const body = new URLSearchParams({
      csrfToken: csrf,
      callbackUrl: window.location.origin,
    });
    await fetch('/api/auth/signout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, refresh }}>
      {children}
      <AuthModal
        open={modalOpen}
        busy={modalBusy}
        error={modalError}
        onClose={() => setModalOpen(false)}
        onSubmit={submitCredentials}
      />
    </AuthContext.Provider>
  );
}

function AuthModal({ open, busy, error, onClose, onSubmit }) {
  const [mode, setMode] = useState('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    if (open) {
      setMode('signin');
      setUsername('');
      setPassword('');
      setName('');
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="picker-overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="share-modal" role="dialog" aria-label={mode === 'signup' ? 'Create account' : 'Sign in'}>
        <div className="share-head">
          <div>
            <div className="auth-title">{mode === 'signup' ? 'Create account' : 'Sign in'}</div>
            <div className="auth-sub">
              {mode === 'signup'
                ? 'Save and revisit hands across devices.'
                : 'Welcome back.'}
            </div>
          </div>
          <button className="modal-x" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>
        <form
          className="share-body"
          onSubmit={(e) => { e.preventDefault(); onSubmit({ username: username.trim().toLowerCase(), password, name: name.trim(), mode }); }}
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          {mode === 'signup' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Display name</span>
              <input
                className="share-link"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="(optional)"
                autoFocus
                autoComplete="name"
              />
            </label>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Username</span>
            <input
              className="share-link"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus={mode === 'signin'}
              required
              autoComplete="username"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Password</span>
            <input
              className="share-link"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </label>
          {error && (
            <div style={{ color: 'var(--red, #d8463e)', fontSize: 12, padding: '4px 0' }}>{error}</div>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy} style={{ marginTop: 4 }}>
            {busy ? '…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}
            disabled={busy}
            style={{ fontSize: 12 }}
          >
            {mode === 'signup' ? 'Have an account? Sign in' : 'Need an account? Create one'}
          </button>
        </form>
      </div>
    </div>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
