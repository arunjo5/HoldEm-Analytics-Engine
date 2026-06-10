import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext.jsx';

const ok = (data) => ({ ok: true, status: 200, json: async () => data });
const fail = (status = 500) => ({ ok: false, status, json: async () => ({}) });

// url-substring router; first matching key wins, sane auth defaults
function mockFetch(routes = {}) {
  const fn = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    for (const key of Object.keys(routes)) {
      if (u.includes(key)) {
        const h = routes[key];
        return typeof h === 'function' ? h(u, opts) : h;
      }
    }
    if (u.includes('/api/auth/session')) return ok({ user: null });
    if (u.includes('/api/auth/providers')) return ok({});
    if (u.includes('/api/auth/csrf')) return ok({ csrfToken: 'tok' });
    return fail(404);
  });
  global.fetch = fn;
  return fn;
}

const callsTo = (substr, method) =>
  global.fetch.mock.calls.filter(([u, o]) =>
    String(u).includes(substr) && (!method || ((o && o.method) || 'GET') === method));

function Probe() {
  const { user, loading, signIn, signOut } = useAuth();
  return (
    <div>
      <div data-testid="state">{loading ? 'loading' : user ? (user.name || user.email) : 'none'}</div>
      <button onClick={signIn}>open-modal</button>
      <button onClick={signOut}>do-signout</button>
    </div>
  );
}

const renderAuth = () => render(<AuthProvider><Probe /></AuthProvider>);
const state = () => screen.getByTestId('state').textContent;

function openModal() {
  fireEvent.click(screen.getByText('open-modal'));
}

function fillAndSubmit({ username = 'arun', password = 'hunter22' } = {}) {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  mockFetch();
});

describe('AuthContext session bootstrap', () => {
  it('sets user from GET /api/auth/session on mount', async () => {
    mockFetch({ '/api/auth/session': ok({ user: { name: 'Arun', email: 'a@b.c' } }) });
    renderAuth();
    await waitFor(() => expect(state()).toBe('Arun'));
  });

  it('non-ok session leaves user null with loading done', async () => {
    mockFetch({ '/api/auth/session': fail(500) });
    renderAuth();
    await waitFor(() => expect(state()).toBe('none'));
  });

  it('session fetch rejection leaves user null with loading done', async () => {
    mockFetch({ '/api/auth/session': () => { throw new Error('net'); } });
    renderAuth();
    await waitFor(() => expect(state()).toBe('none'));
  });
});

describe('AuthModal providers', () => {
  it('shows Google button when providers include google (credentials filtered)', async () => {
    mockFetch({ '/api/auth/providers': ok({ google: {}, credentials: {} }) });
    renderAuth();
    openModal();
    expect(await screen.findByText('Continue with Google')).toBeInTheDocument();
    expect(screen.getByText('or')).toBeInTheDocument();
  });

  it('omits the Google button and divider without a google provider', async () => {
    mockFetch({ '/api/auth/providers': ok({ credentials: {} }) });
    renderAuth();
    openModal();
    await screen.findByRole('dialog', { name: 'Sign in' });
    expect(screen.queryByText('Continue with Google')).toBeNull();
    expect(screen.queryByText('or')).toBeNull();
  });
});

describe('submitCredentials (signin)', () => {
  it('fetches csrf then POSTs the urlencoded callback with manual redirect', async () => {
    let authed = false;
    mockFetch({
      '/api/auth/callback/credentials': () => { authed = true; return ok({}); },
      '/api/auth/session': () => ok({ user: authed ? { name: 'Arun' } : null }),
    });
    renderAuth();
    openModal();
    fillAndSubmit({ username: '  Arun ' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const urls = global.fetch.mock.calls.map(([u]) => String(u));
    expect(urls.indexOf('/api/auth/csrf')).toBeGreaterThan(-1);
    expect(urls.indexOf('/api/auth/csrf')).toBeLessThan(urls.indexOf('/api/auth/callback/credentials'));

    const [, opts] = callsTo('/api/auth/callback/credentials', 'POST')[0];
    expect(opts.redirect).toBe('manual');
    expect(opts.credentials).toBe('include');
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(opts.body.get('csrfToken')).toBe('tok');
    expect(opts.body.get('username')).toBe('arun'); // trimmed + lowercased
    expect(opts.body.get('password')).toBe('hunter22');
    expect(opts.body.get('redirect')).toBe('false');
    await waitFor(() => expect(state()).toBe('Arun'));
  });

  it('surfaces the rate-limit message on a 429 and keeps the modal open', async () => {
    mockFetch({ '/api/auth/callback/credentials': fail(429) });
    renderAuth();
    openModal();
    fillAndSubmit();
    expect(await screen.findByText('Too many sign-in attempts. Try again in a few minutes.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows invalid-credentials when the post-callback refresh has no user', async () => {
    mockFetch({ '/api/auth/callback/credentials': ok({}) }); // session stays null
    renderAuth();
    openModal();
    fillAndSubmit();
    expect(await screen.findByText('Invalid username or password')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('submitCredentials (signup)', () => {
  it('a failing signup surfaces the server error and skips the credentials callback', async () => {
    mockFetch({
      '/api/auth/signup': { ok: false, status: 409, json: async () => ({ error: 'taken' }) },
    });
    renderAuth();
    openModal();
    fireEvent.click(screen.getByText('Need an account? Create one'));
    await screen.findByRole('dialog', { name: 'Create account' });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newbie' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('taken')).toBeInTheDocument();
    expect(callsTo('/api/auth/signup', 'POST')).toHaveLength(1);
    expect(callsTo('/api/auth/callback/credentials')).toHaveLength(0);
  });
});

describe('signOut', () => {
  it('clears the user even when the signout POST rejects, then re-syncs the session', async () => {
    let signedIn = true;
    mockFetch({
      '/api/auth/signout': () => { signedIn = false; throw new Error('net'); },
      '/api/auth/session': () => ok({ user: signedIn ? { name: 'Arun' } : null }),
    });
    renderAuth();
    await waitFor(() => expect(state()).toBe('Arun'));
    fireEvent.click(screen.getByText('do-signout'));
    await waitFor(() => expect(state()).toBe('none'));
    expect(callsTo('/api/auth/signout', 'POST')).toHaveLength(1);
    expect(callsTo('/api/auth/session').length).toBeGreaterThanOrEqual(2); // refresh re-called
  });
});

describe('useAuth guard', () => {
  it('throws outside AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('useAuth must be used inside AuthProvider');
    spy.mockRestore();
  });
});
