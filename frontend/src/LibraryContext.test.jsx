import { useState } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthProvider, useAuth, DEFAULT_LIMITS } from './AuthContext.jsx';
import { LibraryProvider, useLibrary } from './LibraryContext.jsx';

const ok = (data) => ({ ok: true, status: 200, json: async () => data });
const fail = (status = 500, data = {}) => ({ ok: false, status, json: async () => data });

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
// the collection endpoints only — /api/ranges/<id> is a substring match away
const listCalls = (path) =>
  global.fetch.mock.calls.filter(([u, o]) => String(u) === path && ((o && o.method) || 'GET') === 'GET');
const bodyOf = (substr, method, i = 0) => JSON.parse(callsTo(substr, method)[i][1].body);

const USER = { name: 'Arun', email: 'a@b.c' };
const OTHER = { name: 'Bo', email: 'b@b.c' };
const status = (over = {}) => ok({ plan: 'free', saveCap: 25, saved: 0, billingEnabled: true, ...over });

const range = (id, name, keys = ['AA']) => ({ id, name, keys });
const solve = (id, name) => ({ id, name, config: {}, summary: {} });

function Probe() {
  const lib = useLibrary();
  const [last, setLast] = useState('');
  const run = (fn) => async () => setLast(JSON.stringify(await fn()));
  return (
    <div>
      <div data-testid="available">{String(lib.available)}</div>
      <div data-testid="plan">{String(lib.plan)}</div>
      <div data-testid="limits">{JSON.stringify(lib.limits)}</div>
      <div data-testid="ranges">{JSON.stringify(lib.ranges)}</div>
      <div data-testid="ranges-loaded">{String(lib.rangesLoaded)}</div>
      <div data-testid="solves">{JSON.stringify(lib.solves)}</div>
      <div data-testid="solves-loaded">{String(lib.solvesLoaded)}</div>
      <div data-testid="last">{last}</div>
      <button onClick={run(() => lib.refreshRanges())}>refresh-ranges</button>
      <button onClick={run(() => lib.saveRange('BTN open', ['AA', 'AKs']))}>save-range</button>
      <button onClick={run(() => lib.updateRange('r1', { name: 'CO open' }))}>update-range</button>
      <button onClick={run(() => lib.deleteRange('r1'))}>delete-range</button>
      <button onClick={run(() => lib.refreshSolves())}>refresh-solves</button>
      <button onClick={run(() => lib.saveSolve('River jam', { pot: 20 }, { sizes: 4 }))}>save-solve</button>
      <button onClick={run(() => lib.renameSolve('s1', 'Turn probe'))}>rename-solve</button>
      <button onClick={run(() => lib.deleteSolve('s1'))}>delete-solve</button>
      <button onClick={lib.openPlans}>open-plans</button>
    </div>
  );
}

// plansNonce and signOut live on the auth context, not the library one
function AuthBits() {
  const { plansNonce, signOut } = useAuth();
  return (
    <div>
      <div data-testid="nonce">{plansNonce}</div>
      <button onClick={signOut}>sign-out</button>
    </div>
  );
}

const renderStub = () => render(<Probe />);
const renderLib = () => render(<AuthProvider><LibraryProvider><AuthBits /><Probe /></LibraryProvider></AuthProvider>);

const txt = (id) => screen.getByTestId(id).textContent;
const json = (id) => JSON.parse(txt(id));
const names = (id) => json(id).map((r) => r.name);
const click = async (label) => { await act(async () => { fireEvent.click(screen.getByText(label)); }); };
const signedIn = () => waitFor(() => expect(txt('available')).toBe('true'));

beforeEach(() => { mockFetch(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('useLibrary without a provider', () => {
  it('reads as signed out with empty, unloaded lists', () => {
    renderStub();
    expect(txt('available')).toBe('false');
    expect(txt('plan')).toBe('free');
    expect(txt('limits')).toBe('null');
    expect(json('ranges')).toEqual([]);
    expect(json('solves')).toEqual([]);
    expect(txt('ranges-loaded')).toBe('false');
    expect(txt('solves-loaded')).toBe('false');
  });

  it('saving asks the user to sign in and nothing hits the network', async () => {
    renderStub();
    await click('save-range');
    expect(txt('last')).toBe(JSON.stringify({ ok: false, error: 'Sign in to save ranges' }));
    await click('save-solve');
    expect(txt('last')).toBe(JSON.stringify({ ok: false, error: 'Sign in to save solves' }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('update, delete and refresh are inert no-ops', async () => {
    renderStub();
    for (const label of ['update-range', 'delete-range', 'rename-solve', 'delete-solve']) {
      await click(label);
      expect(txt('last')).toBe(JSON.stringify({ ok: false }));
    }
    await click('refresh-ranges');
    await click('refresh-solves');
    await click('open-plans'); // stub openPlans must not throw
    expect(txt('ranges-loaded')).toBe('false');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('LibraryProvider signed out', () => {
  it('stays unavailable and refuses to fetch either list', async () => {
    renderLib();
    await waitFor(() => expect(callsTo('/api/billing/status')).toHaveLength(1));
    expect(txt('available')).toBe('false');
    await click('refresh-ranges');
    await click('refresh-solves');
    expect(callsTo('/api/ranges')).toHaveLength(0);
    expect(callsTo('/api/solves')).toHaveLength(0);
    expect(txt('ranges-loaded')).toBe('false');
    expect(txt('solves-loaded')).toBe('false');
  });
});

describe('LibraryProvider plan and limits', () => {
  it('exposes the caps for the current plan', async () => {
    mockFetch({ '/api/auth/session': ok({ user: USER }), '/api/billing/status': status() });
    renderLib();
    await signedIn();
    expect(txt('plan')).toBe('free');
    expect(json('limits')).toEqual(DEFAULT_LIMITS.free);
  });

  it('follows the plan to the pro caps', async () => {
    mockFetch({ '/api/auth/session': ok({ user: USER }), '/api/billing/status': status({ plan: 'pro' }) });
    renderLib();
    await signedIn();
    await waitFor(() => expect(txt('plan')).toBe('pro'));
    expect(json('limits')).toEqual(DEFAULT_LIMITS.pro);
  });

  it('reads the caps off the status response rather than the defaults', async () => {
    const limits = { free: { saveCap: 40, shareLinks: 2, ranges: 9, solves: 7 }, pro: DEFAULT_LIMITS.pro };
    mockFetch({ '/api/auth/session': ok({ user: USER }), '/api/billing/status': status({ limits }) });
    renderLib();
    await signedIn();
    await waitFor(() => expect(json('limits')).toEqual(limits.free));
  });

  it('reports no limits when the status carries none', async () => {
    mockFetch({ '/api/auth/session': ok({ user: USER }), '/api/billing/status': status({ limits: null }) });
    renderLib();
    await signedIn();
    await waitFor(() => expect(txt('limits')).toBe('null'));
  });
});

describe('refreshRanges / refreshSolves', () => {
  it('GETs each collection on demand and marks it loaded', async () => {
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/billing/status': status(),
      '/api/ranges': ok({ ranges: [range('r1', 'BTN open'), range('r2', 'CO open')] }),
      '/api/solves': ok({ solves: [solve('s1', 'River jam')] }),
    });
    renderLib();
    await signedIn();
    expect(callsTo('/api/ranges')).toHaveLength(0); // nothing until asked
    await click('refresh-ranges');
    expect(names('ranges')).toEqual(['BTN open', 'CO open']);
    expect(txt('ranges-loaded')).toBe('true');
    await click('refresh-solves');
    expect(names('solves')).toEqual(['River jam']);
    expect(txt('solves-loaded')).toBe('true');
    expect(listCalls('/api/ranges')).toHaveLength(1);
    expect(listCalls('/api/solves')).toHaveLength(1);
  });

  it('a failed list still marks the collection loaded and leaves it empty', async () => {
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/billing/status': status(),
      '/api/ranges': fail(500),
      '/api/solves': fail(500),
    });
    renderLib();
    await signedIn();
    await click('refresh-ranges');
    await click('refresh-solves');
    expect(json('ranges')).toEqual([]);
    expect(json('solves')).toEqual([]);
    expect(txt('ranges-loaded')).toBe('true');
    expect(txt('solves-loaded')).toBe('true');
  });

  it('tolerates a body with no list', async () => {
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/billing/status': status(),
      '/api/ranges': ok({}),
    });
    renderLib();
    await signedIn();
    await click('refresh-ranges');
    expect(json('ranges')).toEqual([]);
    expect(txt('ranges-loaded')).toBe('true');
  });
});

describe('saveRange / saveSolve', () => {
  it('prepends the created row and returns the api result', async () => {
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/billing/status': status(),
      '/api/ranges': (u, o) => (o.method === 'POST'
        ? ok({ range: range('r9', 'BTN open', ['AA', 'AKs']) })
        : ok({ ranges: [range('r1', 'CO open')] })),
    });
    renderLib();
    await signedIn();
    await click('refresh-ranges');
    await click('save-range');
    expect(names('ranges')).toEqual(['BTN open', 'CO open']);
    expect(bodyOf('/api/ranges', 'POST')).toEqual({ name: 'BTN open', keys: ['AA', 'AKs'] });
    expect(txt('last')).toBe(JSON.stringify({ ok: true, range: range('r9', 'BTN open', ['AA', 'AKs']) }));
  });

  it('a limit_reached refusal leaves the list alone and returns the code', async () => {
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/billing/status': status(),
      '/api/ranges': (u, o) => (o.method === 'POST'
        ? fail(403, { error: 'Free accounts keep 3 saved ranges.', code: 'limit_reached', cap: 3, plan: 'free' })
        : ok({ ranges: [range('r1', 'CO open')] })),
    });
    renderLib();
    await signedIn();
    await click('refresh-ranges');
    await click('save-range');
    expect(names('ranges')).toEqual(['CO open']);
    expect(JSON.parse(txt('last'))).toMatchObject({ ok: false, code: 'limit_reached', cap: 3 });
  });

  it('prepends a saved solve and posts the name, config and summary', async () => {
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/billing/status': status(),
      '/api/solves': (u, o) => (o.method === 'POST'
        ? ok({ solve: solve('s9', 'River jam') })
        : ok({ solves: [solve('s1', 'Turn probe')] })),
    });
    renderLib();
    await signedIn();
    await click('refresh-solves');
    await click('save-solve');
    expect(names('solves')).toEqual(['River jam', 'Turn probe']);
    expect(bodyOf('/api/solves', 'POST')).toEqual({ name: 'River jam', config: { pot: 20 }, summary: { sizes: 4 } });
  });
});

describe('optimistic range edits', () => {
  const routes = (over) => ({
    '/api/auth/session': ok({ user: USER }),
    '/api/billing/status': status(),
    '/api/ranges': (u, o) => {
      if (o.method === 'PATCH' || o.method === 'DELETE') return over(o);
      return ok({ ranges: [range('r1', 'BTN open'), range('r2', 'CO open')] });
    },
  });

  it('an update lands immediately and does not refetch on success', async () => {
    mockFetch(routes(() => ok({})));
    renderLib();
    await signedIn();
    await click('refresh-ranges');
    await click('update-range');
    expect(names('ranges')).toEqual(['CO open', 'CO open']); // r1 renamed in place
    expect(bodyOf('/api/ranges', 'PATCH')).toEqual({ name: 'CO open' });
    expect(listCalls('/api/ranges')).toHaveLength(1);
  });

  it('a failed update refetches, restoring the server copy', async () => {
    mockFetch(routes(() => fail(500)));
    renderLib();
    await signedIn();
    await click('refresh-ranges');
    await click('update-range');
    await waitFor(() => expect(listCalls('/api/ranges')).toHaveLength(2));
    await waitFor(() => expect(names('ranges')).toEqual(['BTN open', 'CO open']));
  });

  it('a delete removes the row immediately and does not refetch on success', async () => {
    mockFetch(routes(() => ok({})));
    renderLib();
    await signedIn();
    await click('refresh-ranges');
    await click('delete-range');
    expect(names('ranges')).toEqual(['CO open']);
    expect(callsTo('/api/ranges/r1', 'DELETE')).toHaveLength(1);
    expect(listCalls('/api/ranges')).toHaveLength(1);
  });

  it('a failed delete refetches, putting the row back', async () => {
    mockFetch(routes(() => fail(404, { error: 'Not found' })));
    renderLib();
    await signedIn();
    await click('refresh-ranges');
    await click('delete-range');
    await waitFor(() => expect(names('ranges')).toEqual(['BTN open', 'CO open']));
    expect(listCalls('/api/ranges')).toHaveLength(2);
    expect(JSON.parse(txt('last'))).toMatchObject({ ok: false, status: 404, error: 'Not found' });
  });
});

describe('optimistic solve edits', () => {
  const routes = (over) => ({
    '/api/auth/session': ok({ user: USER }),
    '/api/billing/status': status(),
    '/api/solves': (u, o) => {
      if (o.method === 'PATCH' || o.method === 'DELETE') return over(o);
      return ok({ solves: [solve('s1', 'River jam'), solve('s2', 'Flop probe')] });
    },
  });

  it('a rename lands immediately and does not refetch on success', async () => {
    mockFetch(routes(() => ok({})));
    renderLib();
    await signedIn();
    await click('refresh-solves');
    await click('rename-solve');
    expect(names('solves')).toEqual(['Turn probe', 'Flop probe']);
    expect(bodyOf('/api/solves', 'PATCH')).toEqual({ name: 'Turn probe' });
    expect(listCalls('/api/solves')).toHaveLength(1);
  });

  it('a failed rename refetches, restoring the server name', async () => {
    mockFetch(routes(() => fail(500)));
    renderLib();
    await signedIn();
    await click('refresh-solves');
    await click('rename-solve');
    await waitFor(() => expect(names('solves')).toEqual(['River jam', 'Flop probe']));
    expect(listCalls('/api/solves')).toHaveLength(2);
  });

  it('a delete removes the row immediately, and a failure puts it back', async () => {
    let down = false;
    mockFetch(routes(() => (down ? fail(500) : ok({}))));
    renderLib();
    await signedIn();
    await click('refresh-solves');
    await click('delete-solve');
    expect(names('solves')).toEqual(['Flop probe']);
    expect(callsTo('/api/solves/s1', 'DELETE')).toHaveLength(1);
    expect(listCalls('/api/solves')).toHaveLength(1);

    down = true;
    await click('refresh-solves');
    await click('delete-solve');
    await waitFor(() => expect(names('solves')).toEqual(['River jam', 'Flop probe']));
  });
});

describe('signed-in user changes', () => {
  it('drops both lists when the account changes', async () => {
    let who = USER;
    mockFetch({
      '/api/auth/session': () => ok({ user: who }),
      '/api/billing/status': status(),
      '/api/ranges': ok({ ranges: [range('r1', 'BTN open')] }),
      '/api/solves': ok({ solves: [solve('s1', 'River jam')] }),
      '/api/auth/signout': () => { who = OTHER; return ok({}); },
    });
    renderLib();
    await signedIn();
    await click('refresh-ranges');
    await click('refresh-solves');
    expect(names('ranges')).toEqual(['BTN open']);

    await click('sign-out'); // signOut re-reads the session, which now answers with another account
    await waitFor(() => expect(json('ranges')).toEqual([]));
    expect(json('solves')).toEqual([]);
    expect(txt('ranges-loaded')).toBe('false');
    expect(txt('solves-loaded')).toBe('false');
    expect(txt('available')).toBe('true');
  });
});

describe('openPlans', () => {
  it('passes the auth-context opener straight through', async () => {
    mockFetch({ '/api/auth/session': ok({ user: USER }), '/api/billing/status': status() });
    renderLib();
    await signedIn();
    expect(txt('nonce')).toBe('0');
    await click('open-plans');
    expect(txt('nonce')).toBe('1');
    await click('open-plans');
    expect(txt('nonce')).toBe('2');
  });
});
