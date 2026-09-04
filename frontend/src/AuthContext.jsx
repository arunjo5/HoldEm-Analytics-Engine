import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

const AuthContext = createContext(null);

const EMPTY_PLAN = { plan: 'free', interval: null, expiresAt: null, saveCap: 25, saved: 0, hasCustomer: false, billingEnabled: false };
// survives the full-page google redirect so checkout resumes after sign-in
const CHECKOUT_KEY = 'pokerlab_checkout_intent';

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
  const [oauth, setOauth] = useState([]); // configured OAuth provider ids (e.g. ['google'])
  const [modalMode, setModalMode] = useState('signin');
  const [plan, setPlan] = useState(EMPTY_PLAN);
  // 'month' | 'year' while the sign-in modal is a step on the way to checkout
  const [checkoutIntent, setCheckoutIntent] = useState(null);

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

  const refreshPlan = useCallback(async () => {
    try {
      const r = await fetch('/api/billing/status', { credentials: 'include' });
      if (!r.ok) { setPlan(EMPTY_PLAN); return EMPTY_PLAN; }
      const next = { ...EMPTY_PLAN, ...(await r.json()) };
      setPlan(next);
      return next;
    } catch {
      setPlan(EMPTY_PLAN);
      return EMPTY_PLAN;
    }
  }, []);

  const userKey = user ? (user.id || user.email || 'user') : '';
  useEffect(() => { refreshPlan(); }, [userKey, refreshPlan]);

  const beginCheckout = useCallback(async (interval) => {
    try {
      const r = await fetch('/api/billing/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.url) return { ok: false, error: data.error || `Checkout failed (${r.status})` };
      window.location.assign(data.url);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error' };
    }
  }, []);

  // checkout needs an account: signed out, the modal opens first and checkout resumes after
  const startCheckout = useCallback(async (interval = 'year') => {
    if (!user) {
      setModalError(null);
      setModalMode('signin');
      setCheckoutIntent(interval);
      setModalOpen(true);
      return { ok: false, pending: true };
    }
    return beginCheckout(interval);
  }, [user, beginCheckout]);

  // back from google with a checkout waiting
  useEffect(() => {
    if (!user) return;
    let intent = null;
    try {
      intent = sessionStorage.getItem(CHECKOUT_KEY);
      if (intent) sessionStorage.removeItem(CHECKOUT_KEY);
    } catch { /* storage blocked */ }
    if (intent === 'month' || intent === 'year') beginCheckout(intent);
  }, [userKey, user, beginCheckout]);

  const openPortal = useCallback(async () => {
    try {
      const r = await fetch('/api/billing/portal', { method: 'POST', credentials: 'include' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.url) return { ok: false, error: data.error || `Could not open billing (${r.status})` };
      window.location.assign(data.url);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error' };
    }
  }, []);

  // Discover which OAuth providers the backend has configured (Google appears
  // only once its env vars are set), so the button shows only when usable.
  useEffect(() => {
    fetch('/api/auth/providers', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : {}))
      .then(p => setOauth(Object.keys(p || {}).filter(id => id !== 'credentials')))
      .catch(() => {});
  }, []);

  function signIn(opts) {
    setModalError(null);
    setModalMode(opts && opts.mode === 'signup' ? 'signup' : 'signin');
    setCheckoutIntent(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setCheckoutIntent(null);
  }

  // OAuth: a full-page POST so the browser follows the provider redirect chain
  // and the session cookie lands on this (frontend) origin via the /api proxy.
  async function oauthSignIn(provider) {
    if (checkoutIntent) {
      try { sessionStorage.setItem(CHECKOUT_KEY, checkoutIntent); } catch { /* storage blocked */ }
    }
    const csrf = await getCsrfToken();
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `/api/auth/signin/${provider}`;
    const field = (name, value) => {
      const i = document.createElement('input');
      i.type = 'hidden'; i.name = name; i.value = value;
      form.appendChild(i);
    };
    field('csrfToken', csrf);
    field('callbackUrl', window.location.origin);
    document.body.appendChild(form);
    form.submit();
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
      // redirect: 'manual' — NextAuth answers with a 302 whose Location is on
      // the backend origin; letting fetch follow it cross-origin throws
      // "Failed to fetch". We don't need the target: the session cookie is
      // already set on this response, so we just read it back via refresh().
      const resp = await fetch('/api/auth/callback/credentials', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        redirect: 'manual',
      });
      if (resp.status === 429) {
        throw new Error('Too many sign-in attempts. Try again in a few minutes.');
      }
      const u = await refresh();
      if (!u) throw new Error('Invalid username or password');
      setModalOpen(false);
      if (checkoutIntent) {
        setCheckoutIntent(null);
        beginCheckout(checkoutIntent);
      }
    } catch (e) {
      setModalError(e.message || 'Something went wrong');
    } finally {
      setModalBusy(false);
    }
  }

  async function signOut() {
    try {
      const csrf = await getCsrfToken();
      const body = new URLSearchParams({
        csrfToken: csrf,
        callbackUrl: window.location.origin,
      });
      // redirect: 'manual' for the same reason as sign-in — NextAuth's 302
      // points at the backend origin and following it cross-origin throws.
      // The session cookie is cleared on this response regardless.
      await fetch('/api/auth/signout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        redirect: 'manual',
      });
    } catch {
      // ignore network/redirect errors — we still clear local state below
    } finally {
      // Always drop the local user, then re-sync from the server so the UI
      // reflects the (now signed-out) session even if the cookie lingered.
      setUser(null);
      refresh();
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, refresh, plan, refreshPlan, startCheckout, openPortal }}>
      {children}
      <AuthModal
        open={modalOpen}
        busy={modalBusy}
        error={modalError}
        oauth={oauth}
        initialMode={modalMode}
        intent={checkoutIntent}
        onOauth={oauthSignIn}
        onClose={closeModal}
        onSubmit={submitCredentials}
      />
    </AuthContext.Provider>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

function AuthModal({ open, busy, error, oauth = [], initialMode = 'signin', intent = null, onOauth, onClose, onSubmit }) {
  const [mode, setMode] = useState(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setUsername('');
      setPassword('');
      setName('');
    }
  }, [open, initialMode]);

  if (!open) return null;

  return (
    <div className="picker-overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="share-modal" role="dialog" aria-label={mode === 'signup' ? 'Create account' : 'Sign in'}>
        <div className="share-head">
          <div>
            <div className="auth-title">
              {mode === 'signup' ? 'Create account' : intent ? 'Sign in to continue' : 'Sign in'}
            </div>
            <div className="auth-sub">
              {intent
                ? 'Pro is tied to your account. Sign in and we’ll take you straight to checkout.'
                : mode === 'signup'
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
          {oauth.includes('google') && (
            <>
              <button type="button" className="btn auth-oauth-btn" onClick={() => onOauth('google')} disabled={busy}>
                <GoogleIcon />
                Continue with Google
              </button>
              <div className="auth-divider"><span>or</span></div>
            </>
          )}
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
              minLength={mode === 'signup' ? 8 : undefined}
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
