import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import App from './App.jsx';
import { AuthProvider } from './AuthContext.jsx';
import { encodeScenario } from './scenario.js';

class FakeWorker {
  constructor() { FakeWorker.instances.push(this); this.onmessage = null; this.posted = []; this.terminated = false; }
  postMessage(m) { this.posted.push(m); }
  terminate() { this.terminated = true; }
}
FakeWorker.instances = [];

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

const verb = (o) => (o && o.method) || 'GET';
const callsTo = (substr, m) =>
  global.fetch.mock.calls.filter(([u, o]) => String(u).includes(substr) && (!m || verb(o) === m));

const paramsOf = (u) => Object.fromEntries(new URL(String(u), 'http://x').searchParams);
// GETs of the list itself, never /api/searches/<id>
const listGets = () => global.fetch.mock.calls
  .filter(([u, o]) => /^\/api\/searches\?/.test(String(u)) && verb(o) === 'GET')
  .map(([u]) => paramsOf(u));
const starredGets = () => listGets().filter(q => q.starred);

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

const page = (searches, nextCursor = null) => ({ searches, nextCursor });

// answers the list endpoint by query: cursor -> that page, starred -> the favorites
// fill, else page 1. `write` handles POST/DELETE.
const listApi = ({ first = {}, byCursor = {}, starred = {}, write } = {}) => (u, o) => {
  if (verb(o) !== 'GET') return write ? write(u, o) : ok({});
  const q = paramsOf(u);
  const pick = q.starred ? starred : q.cursor ? (byCursor[q.cursor] || {}) : first;
  return typeof pick === 'function' ? pick(u, o) : ok(pick);
};

const c = (s) => ({ v: s[0], s: s[1] });
const USER = { name: 'Arun', email: 'a@b.c' };
const P_AA = { kind: 'hand', hand: [c('As'), c('Ah')] };
const P_KK = { kind: 'hand', hand: [c('Ks'), c('Kh')] };

const scenarioEnc = () => encodeScenario({
  players: [P_AA, P_KK], board: [], playerNames: ['Hero', 'Villain'], pot: '100', callAmt: '50',
});

const histRow = (id, over = {}) => ({
  id, players: [P_AA, P_KK], board: [], playerNames: ['Hero', 'Villain'],
  odds: {}, favorite: false, createdAt: '2026-01-01T00:00:00Z',
  scenario: scenarioEnc(), ...over,
});

const REPLAY_HAND = {
  setup: {
    sb: 50, bb: 100, ante: 0, cents: false,
    seats: [
      { name: 'rex', stack: 10000, pos: 'BTN', cards: null },
      { name: 'pranad', stack: 8000, pos: 'SB', cards: [c('Ah'), c('Kh')] },
      { name: 'luc', stack: 12000, pos: 'BB', cards: [c('Qd'), c('Qs')] },
    ],
  },
  actions: [
    { seat: 0, type: 'fold', street: 0 },
    { seat: 1, type: 'call', street: 0 },
    { seat: 2, type: 'check', street: 0 },
  ],
  board: [c('2c'), c('7d'), c('Jh')],
  board2: null, won: null, runResults: null,
};

// what a paged list row carries for a replay: setup + counts, no action array
const slimReplayRow = (id, over = {}) => ({
  id, isReplay: true, favorite: false, createdAt: '2026-01-01T00:00:00Z',
  replay: { slim: true, setup: REPLAY_HAND.setup, board: REPLAY_HAND.board, actionCount: 3 },
  ...over,
});

const renderApp = () => render(<AuthProvider><App /></AuthProvider>);
const findChip = () => screen.findByRole('button', { name: /Arun/ });
const toastText = () => document.querySelector('.shared-toast')?.textContent;
const rowNames = () => [...document.querySelectorAll('.hist-row-name')].map(el => el.textContent);
const moreBtn = () => screen.queryByRole('button', { name: /Load more|Loading…/ });
const tabFor = (label) => screen.getByText(label).closest('button');

async function openDrawer() {
  fireEvent.click(await findChip());
  fireEvent.click(screen.getByText('Hand history'));
  return screen.findByRole('dialog', { name: 'Hand history' });
}

beforeEach(() => {
  localStorage.clear();
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  mockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

describe('history paging requests', () => {
  it('asks for the first page with limit=60 and credentials', async () => {
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/searches': listApi({ first: page([histRow('h1', { name: 'one' })]) }),
    });
    renderApp();
    await findChip();
    await waitFor(() => expect(listGets()).toHaveLength(1));
    expect(listGets()[0]).toEqual({ limit: '60' });
    expect(callsTo('/api/searches', 'GET')[0][1].credentials).toBe('include');
  });

  it('shows Load more only with a nextCursor, and asks for the next page by cursor', async () => {
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/searches': listApi({
        first: page([histRow('h1', { name: 'one' })], 'c1'),
        byCursor: { c1: page([histRow('h2', { name: 'two' })]) },
      }),
    });
    renderApp();
    await openDrawer();
    await screen.findByText('one');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('two')).toBeInTheDocument();
    expect(listGets().at(-1)).toEqual({ limit: '60', cursor: 'c1' });
    // the last page came back without a cursor, so the button retires
    expect(moreBtn()).toBeNull();
  });

  it('appends pages deduped by id and re-sorted newest first', async () => {
    const one = histRow('h1', { name: 'one', createdAt: '2026-01-01T00:00:00Z' });
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/searches': listApi({
        first: page([histRow('h2', { name: 'two', createdAt: '2026-01-02T00:00:00Z' }), one], 'c1'),
        byCursor: {
          c1: page([
            one, // already on screen
            histRow('h3', { name: 'three', createdAt: '2026-01-03T00:00:00Z' }),
            histRow('h0', { name: 'zero', createdAt: '2025-12-31T00:00:00Z' }),
          ], 'c2'),
        },
      }),
    });
    renderApp();
    await openDrawer();
    await screen.findByText('one');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('three');
    expect(rowNames()).toEqual(['three', 'two', 'one', 'zero']);
    expect(screen.getAllByText('one')).toHaveLength(1);
    expect(moreBtn()).toHaveTextContent('Load more'); // c2 keeps it alive
  });

  it('a failed Load more toasts and leaves the button usable', async () => {
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/searches': listApi({
        first: page([histRow('h1', { name: 'one' })], 'c1'),
        byCursor: { c1: () => fail(500) },
      }),
    });
    renderApp();
    await openDrawer();
    await screen.findByText('one');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(toastText()).toBe('HTTP 500'));
    expect(screen.getByRole('button', { name: 'Load more' })).not.toBeDisabled();
    expect(screen.getByText('one')).toBeInTheDocument();
  });

  it('the Starred tab fills favorites once with starred=1&limit=200', async () => {
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/searches': listApi({
        first: page([histRow('h1', { name: 'one' })], 'c1'),
        starred: page([histRow('h9', { name: 'old fave', favorite: true })]),
      }),
    });
    renderApp();
    await openDrawer();
    await screen.findByText('one');
    fireEvent.click(tabFor('Starred'));
    expect(await screen.findByText('old fave')).toBeInTheDocument();
    expect(starredGets()).toEqual([{ limit: '200', starred: '1' }]);
    // flipping back and forth must not refetch the same fill
    fireEvent.click(tabFor('All'));
    fireEvent.click(tabFor('Starred'));
    await act(async () => {});
    expect(starredGets()).toHaveLength(1);
  });

  it('the Starred tab skips the fill when the first page was the whole list', async () => {
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/searches': listApi({ first: page([histRow('h1', { name: 'one', favorite: true })]) }),
    });
    renderApp();
    await openDrawer();
    await screen.findByText('one');
    fireEvent.click(tabFor('Starred'));
    await act(async () => {});
    expect(starredGets()).toHaveLength(0);
    expect(screen.getByText('one')).toBeInTheDocument();
  });
});

describe('stale-while-revalidate history', () => {
  it('spins on the very first load, and one in-flight request serves both openers', async () => {
    const first = deferred();
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/searches': listApi({ first: () => first.promise }),
    });
    renderApp();
    await findChip();
    await waitFor(() => expect(listGets()).toHaveLength(1)); // prefetch
    const drawer = await openDrawer();
    expect(screen.getByText('Loading hand history…')).toBeInTheDocument();
    expect(listGets()).toHaveLength(1); // the open reused the in-flight prefetch
    fireEvent.click(within(drawer).getByLabelText('Close'));
    await openDrawer();
    expect(listGets()).toHaveLength(1); // and so did the reopen
    await act(async () => { first.resolve(ok(page([histRow('h1', { name: 'one' })]))); });
    expect(screen.getByText('one')).toBeInTheDocument();
    expect(screen.queryByText('Loading hand history…')).toBeNull();
  });

  it('keeps the rows on screen while a later refresh is in flight', async () => {
    const first = deferred();
    const second = deferred();
    let n = 0;
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/searches': listApi({ first: () => (++n === 1 ? first.promise : second.promise) }),
    });
    renderApp();
    await findChip();
    await waitFor(() => expect(listGets()).toHaveLength(1));
    await act(async () => { first.resolve(ok(page([histRow('h1', { name: 'one' })]))); });
    await openDrawer();
    await waitFor(() => expect(listGets()).toHaveLength(2));
    expect(screen.queryByText('Loading hand history…')).toBeNull();
    expect(screen.getByText('one')).toBeInTheDocument();
    await act(async () => {
      second.resolve(ok(page([histRow('h1', { name: 'one' }), histRow('h2', { name: 'two' })])));
    });
    expect(screen.getByText('two')).toBeInTheDocument();
  });

  it('prefetches the first page at sign-in, before the drawer is ever opened', async () => {
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/searches': listApi({ first: page([histRow('h1', { name: 'one' })]) }),
    });
    renderApp();
    await findChip();
    await waitFor(() => expect(listGets()).toHaveLength(1));
    expect(screen.queryByRole('dialog', { name: 'Hand history' })).toBeNull();
  });

  it('fetches nothing while signed out', async () => {
    mockFetch({ '/api/searches': listApi({ first: page([histRow('h1')]) }) });
    renderApp();
    await screen.findByRole('button', { name: /sign in/i });
    await act(async () => {});
    expect(listGets()).toHaveLength(0);
  });
});

describe('bulk clear', () => {
  const twoRows = () => page([
    histRow('h1', { name: 'one' }),
    histRow('h2', { name: 'two', favorite: true }),
  ], 'c1');

  it('sends one DELETE, drops the cursor, and refreshes the plan', async () => {
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/billing/status': ok({ plan: 'free', saveCap: 25, saved: 2, billingEnabled: true }),
      '/api/searches': listApi({ first: twoRows() }),
    });
    renderApp();
    const drawer = await openDrawer();
    await screen.findByText('one');
    expect(moreBtn()).toHaveTextContent('Load more');
    const plansBefore = callsTo('/api/billing/status', 'GET').length;
    const listsBefore = listGets().length;
    fireEvent.click(within(drawer).getByText('Clear all'));
    fireEvent.click(within(drawer).getByText('Clear'));
    expect(screen.queryByText('one')).toBeNull();
    expect(screen.getByText('two')).toBeInTheDocument();
    expect(moreBtn()).toBeNull();
    const dels = callsTo('/api/searches', 'DELETE');
    expect(dels).toHaveLength(1);
    expect(String(dels[0][0])).toBe('/api/searches');
    expect(dels[0][1].credentials).toBe('include');
    await waitFor(() => expect(callsTo('/api/billing/status', 'GET')).toHaveLength(plansBefore + 1));
    expect(listGets()).toHaveLength(listsBefore); // success needs no refetch
  });

  it('a failed DELETE toasts and refetches the list', async () => {
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/searches': listApi({ first: twoRows(), write: () => fail(500) }),
    });
    renderApp();
    const drawer = await openDrawer();
    await screen.findByText('one');
    const listsBefore = listGets().length;
    fireEvent.click(within(drawer).getByText('Clear all'));
    fireEvent.click(within(drawer).getByText('Clear'));
    expect(screen.queryByText('one')).toBeNull();
    await waitFor(() => expect(toastText()).toBe('Could not clear history'));
    expect(await screen.findByText('one')).toBeInTheDocument();
    expect(listGets()).toHaveLength(listsBefore + 1);
    expect(moreBtn()).toHaveTextContent('Load more'); // the refetch restored the cursor
  });
});

describe('slim replay rows', () => {
  it('pulls the full hand by id before opening the replayer', async () => {
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/searches/r1': (u, o) => (verb(o) === 'GET'
        ? ok({ search: { ...slimReplayRow('r1'), replay: REPLAY_HAND } })
        : ok({})),
      '/api/searches': listApi({ first: page([slimReplayRow('r1')]) }),
    });
    renderApp();
    await openDrawer();
    fireEvent.click(await screen.findByText('Full hand'));
    expect(await screen.findByText('Hand Replayer')).toBeInTheDocument();
    expect(callsTo('/api/searches/r1', 'GET')).toHaveLength(1);
    expect(callsTo('/api/searches/r1', 'GET')[0][1].credentials).toBe('include');
    expect(screen.getByText('rex')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Hand history' })).toBeNull();
  });

  it('a failed by-id fetch toasts and stays in the drawer', async () => {
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/searches/r1': (u, o) => (verb(o) === 'GET' ? fail(500) : ok({})),
      '/api/searches': listApi({ first: page([slimReplayRow('r1')]) }),
    });
    renderApp();
    await openDrawer();
    fireEvent.click(await screen.findByText('Full hand'));
    await waitFor(() => expect(toastText()).toBe('Could not load that hand'));
    expect(screen.queryByText('Hand Replayer')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Hand history' })).toBeInTheDocument();
  });

  it('opens a non-slim replay straight from the row', async () => {
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/searches/r1': ok({}),
      '/api/searches': listApi({
        first: page([{ ...slimReplayRow('r1'), replay: REPLAY_HAND }]),
      }),
    });
    renderApp();
    await openDrawer();
    fireEvent.click(await screen.findByText('Full hand'));
    expect(await screen.findByText('Hand Replayer')).toBeInTheDocument();
    expect(callsTo('/api/searches/r1', 'GET')).toHaveLength(0);
  });
});

describe('toHistoryItem preview fields', () => {
  it('labels a range hero from rangeCount, falling back to the range array', async () => {
    const rangeRow = (id, name, hero) => histRow(id, {
      name, players: [hero], playerNames: ['Hero'],
    });
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/searches': listApi({
        first: page([
          rangeRow('g1', 'counted', { kind: 'range', rangeCount: 42 }),
          rangeRow('g2', 'listed', { kind: 'range', range: ['AA', 'KK', 'QQ'] }),
          rangeRow('g3', 'bare', { kind: 'range' }),
        ]),
      }),
    });
    renderApp();
    await openDrawer();
    await screen.findByText('counted');
    const labelIn = (name) => screen.getByText(name).closest('.hist-row').querySelector('.range-tag').textContent;
    expect(labelIn('counted')).toBe('42 combos');
    expect(labelIn('listed')).toBe('3 combos');
    expect(labelIn('bare')).toBe('0 combos');
  });

  it('counts replay actions from actionCount, falling back to the action array', async () => {
    mockFetch({
      '/api/auth/session': ok({ user: USER }),
      '/api/searches': listApi({
        first: page([
          slimReplayRow('r1', { replay: { slim: true, setup: REPLAY_HAND.setup, board: [], actionCount: 7 } }),
          slimReplayRow('r2', { replay: REPLAY_HAND }),
        ]),
      }),
    });
    renderApp();
    await openDrawer();
    await screen.findAllByText('Full hand');
    expect(screen.getByText(/7 actions · click to replay/)).toBeInTheDocument();
    expect(screen.getByText(/3 actions · click to replay/)).toBeInTheDocument();
    expect(screen.getAllByText('3-way')).toHaveLength(2);
  });
});
