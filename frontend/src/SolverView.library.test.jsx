import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthProvider } from './AuthContext.jsx';
import { LibraryProvider } from './LibraryContext.jsx';
import { SolverView } from './SolverView.jsx';

class FakeWorker {
  constructor() { FakeWorker.instances.push(this); this.onmessage = null; this.posted = []; this.terminated = false; }
  postMessage(m) { this.posted.push(m); }
  terminate() { this.terminated = true; }
}
FakeWorker.instances = [];

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
const bodyOf = (substr, method) => JSON.parse(callsTo(substr, method)[0][1].body);

const USER = { name: 'Arun', email: 'a@b.c' };
const status = (over = {}) => ok({ plan: 'free', saveCap: 25, saved: 0, billingEnabled: true, ...over });

const VALS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const SUIT_ROWS = ['s', 'h', 'c', 'd'];
const c = (v, s) => ({ v, s });
const BOARD = [c('2', 's'), c('7', 'h'), c('9', 'c'), c('J', 'd'), c('K', 's')];
const OOP_HAND = { kind: 'hand', cards: [c('A', 'h'), c('K', 'h')] };
const IP_RANGE = { kind: 'range', keys: ['AA'] };
const SPOT = { pot: 30, stack: 60, betSizes: [{ id: 'b50', pct: 50, on: true }], allIn: false };

// mirrors SolverView.test.jsx: drive the real setup screen to a solvable spot
function clickPickerCard(v, s) {
  const grid = document.querySelector('.picker-grid');
  fireEvent.click(grid.querySelectorAll('.pcard')[SUIT_ROWS.indexOf(s) * 13 + VALS.indexOf(v)]);
}
function dealStreet(slotIdx, cards) {
  fireEvent.click(document.querySelectorAll('.sv-board-row .board-strip-btn')[slotIdx]);
  cards.forEach((card) => clickPickerCard(card.v, card.s));
  fireEvent.click(document.querySelector('.picker-foot .btn-primary'));
}
async function setUpSpot() {
  dealStreet(0, BOARD.slice(0, 3));
  dealStreet(1, BOARD.slice(3, 4));
  dealStreet(2, BOARD.slice(4, 5));
  fireEvent.click(within(document.querySelectorAll('.sv-range-row')[0]).getByRole('button', { name: 'Hand' }));
  clickPickerCard('A', 'h');
  clickPickerCard('K', 'h');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm hand' }));
  fireEvent.click(within(document.querySelectorAll('.sv-range-row')[1]).getByRole('button', { name: 'Range' }));
  fireEvent.mouseDown(screen.getByText('AA'));
  fireEvent.click(screen.getByRole('button', { name: 'Save range' }));
  // the picker asks the library for saved ranges on the way past
  await act(async () => {});
}

const savedSolve = (over = {}) => ({
  id: 's1',
  name: 'River jam',
  createdAt: '2026-02-14T10:00:00.000Z',
  config: { board: BOARD, oopSide: OOP_HAND, ipSide: IP_RANGE, spot: SPOT },
  summary: { oopCombos: 4, ipCombos: 6, sizes: 2, exploit: 0.42 },
  ...over,
});

const fixtureResult = () => ({
  nodes: [{
    id: 'oop_first', actor: 'OOP', label: 'OOP — first to act',
    actions: [{ id: 'check', kind: 'check', label: 'Check' }, { id: 'b75', kind: 'bet', sizePct: 75, label: 'Bet 75%' }],
  }],
  nodeSolves: { oop_first: { byKey: {}, combos: [], count: 0 } },
  meta: { potBb: 20, evOOP: 10, evIP: 9.9, exploitPctPot: 0.42, iterations: 256, sizeCount: 4 },
  trace: [5, 3, 1, 0.4],
});

const worker = () => FakeWorker.instances[0];
const msg = (data) => act(() => { worker().onmessage({ data }); });
const panel = () => document.querySelector('.sv-saved');
const rows = () => [...document.querySelectorAll('.sv-saved-row')];

function renderSolver(routes = {}) {
  mockFetch({ '/api/auth/session': ok({ user: USER }), '/api/billing/status': status(), '/api/ranges': ok({ ranges: [] }), ...routes });
  return render(
    <AuthProvider>
      <LibraryProvider>
        <SolverView onExit={() => {}} theme="dark" onToggleTheme={() => {}} />
      </LibraryProvider>
    </AuthProvider>,
  );
}

// setup → solve → results, with the fixture result on screen
async function toResults(routes = {}) {
  const utils = renderSolver(routes);
  await waitFor(() => expect(panel()).not.toBeNull()); // signed in, library ready
  await setUpSpot();
  fireEvent.click(screen.getByRole('button', { name: 'Solve' }));
  await msg({ jobId: 1, type: 'done', result: fixtureResult() });
  return utils;
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  mockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('saved solves panel visibility', () => {
  it('is absent with no library provider at all', () => {
    render(<SolverView onExit={() => {}} theme="dark" onToggleTheme={() => {}} />);
    expect(panel()).toBeNull();
    expect(screen.queryByText(/Saved solves/)).toBeNull();
  });

  it('is absent while signed out, and nothing is fetched', async () => {
    mockFetch({ '/api/billing/status': status() });
    render(<AuthProvider><LibraryProvider><SolverView onExit={() => {}} theme="dark" onToggleTheme={() => {}} /></LibraryProvider></AuthProvider>);
    await waitFor(() => expect(callsTo('/api/billing/status')).toHaveLength(1));
    expect(panel()).toBeNull();
    expect(callsTo('/api/solves')).toHaveLength(0);
  });

  it('appears under the setup screen once signed in, listing the saved spots', async () => {
    renderSolver({ '/api/solves': ok({ solves: [savedSolve(), savedSolve({ id: 's2', name: 'Turn probe' })] }) });
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByText('Spot configuration')).toBeInTheDocument();
    expect(panel().querySelector('.sv-field-hint').textContent).toBe('2 of 3');
    expect(rows()[0].querySelector('.sv-saved-name').textContent).toBe('River jam');
  });

  it('hides the panel while solving and on the results screen', async () => {
    await toResults({ '/api/solves': ok({ solves: [savedSolve()] }) });
    expect(panel()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit spot' }));
    expect(panel()).not.toBeNull();
  });
});

describe('loading a saved solve', () => {
  it('restores the board, ranges and spot, then re-solves straight away', async () => {
    renderSolver({ '/api/solves': ok({ solves: [savedSolve()] }) });
    await waitFor(() => expect(rows()).toHaveLength(1));
    await act(async () => { fireEvent.click(rows()[0].querySelector('.sv-saved-load')); });

    await waitFor(() => expect(worker().posted).toHaveLength(1));
    const m = worker().posted[0];
    expect(m.board).toEqual(BOARD);
    expect(m.oopKeys).toEqual(['AKs']);
    expect(m.ipKeys).toEqual(['AA']);
    expect(m.spot).toEqual(SPOT);
    expect(m.opts.oopRestrict).toEqual(new Set(['AhKh', 'KhAh']));
    expect(m.opts.ipRestrict).toBeNull();
    expect(screen.getByText(/Running CFR iterations/)).toBeInTheDocument();
  });

  it('pads a short board back out to five slots', async () => {
    const flop = { ...savedSolve(), config: { board: BOARD.slice(0, 3), oopSide: OOP_HAND, ipSide: IP_RANGE, spot: SPOT } };
    renderSolver({ '/api/solves': ok({ solves: [flop] }) });
    await waitFor(() => expect(rows()).toHaveLength(1));
    await act(async () => { fireEvent.click(rows()[0].querySelector('.sv-saved-load')); });
    await waitFor(() => expect(worker().posted).toHaveLength(1));
    expect(worker().posted[0].board).toEqual([...BOARD.slice(0, 3), null, null]);
  });

  it('copies the spot rather than sharing it with the saved row', async () => {
    const solve = savedSolve();
    renderSolver({ '/api/solves': ok({ solves: [solve] }) });
    await waitFor(() => expect(rows()).toHaveLength(1));
    await act(async () => { fireEvent.click(rows()[0].querySelector('.sv-saved-load')); });
    await waitFor(() => expect(worker().posted).toHaveLength(1));
    expect(worker().posted[0].spot).not.toBe(solve.config.spot);
    expect(worker().posted[0].spot.betSizes[0]).not.toBe(solve.config.spot.betSizes[0]);
  });

  it('deleting a saved row drops it without loading anything', async () => {
    renderSolver({
      '/api/solves': (u, o) => (o.method === 'DELETE' ? ok({}) : ok({ solves: [savedSolve(), savedSolve({ id: 's2', name: 'Turn probe' })] })),
    });
    await waitFor(() => expect(rows()).toHaveLength(2));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete River jam' })); });
    expect(callsTo('/api/solves/s1', 'DELETE')).toHaveLength(1);
    expect(rows()).toHaveLength(1);
    expect(worker().posted).toHaveLength(0);
    expect(screen.getByText('Spot configuration')).toBeInTheDocument();
  });
});

describe('saving a solve from the results screen', () => {
  it('is offered only when the library is available', async () => {
    mockFetch({ '/api/billing/status': status() });
    render(<AuthProvider><LibraryProvider><SolverView onExit={() => {}} theme="dark" onToggleTheme={() => {}} /></LibraryProvider></AuthProvider>);
    await waitFor(() => expect(callsTo('/api/billing/status')).toHaveLength(1));
    await setUpSpot();
    fireEvent.click(screen.getByRole('button', { name: 'Solve' }));
    await msg({ jobId: 1, type: 'done', result: fixtureResult() });
    expect(screen.getByRole('button', { name: 'Re-solve' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save solve' })).toBeNull();
  });

  it('posts the solved spot and its headline numbers', async () => {
    await toResults({
      '/api/solves': (u, o) => (o.method === 'POST' ? ok({ solve: savedSolve({ name: 'Ks river' }) }) : ok({ solves: [] })),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save solve' }));
    fireEvent.change(screen.getByLabelText('Solve name'), { target: { value: 'Ks river' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });

    const body = bodyOf('/api/solves', 'POST');
    expect(body.name).toBe('Ks river');
    expect(body.config.board).toEqual(BOARD);
    expect(body.config.oopSide).toEqual(OOP_HAND);
    expect(body.config.ipSide).toEqual(IP_RANGE);
    expect(body.config.spot).toMatchObject({ pot: 20, stack: 80, allIn: true });
    expect(body.summary).toEqual({
      exploit: 0.42, evOOP: 10, evIP: 9.9, iterations: 256, sizes: 4, oopCombos: 4, ipCombos: 6,
    });
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('the new solve is waiting in the panel back on the setup screen', async () => {
    await toResults({
      '/api/solves': (u, o) => (o.method === 'POST' ? ok({ solve: savedSolve({ name: 'Ks river' }) }) : ok({ solves: [] })),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save solve' }));
    fireEvent.change(screen.getByLabelText('Solve name'), { target: { value: 'Ks river' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    fireEvent.click(screen.getByRole('button', { name: 'Edit spot' }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector('.sv-saved-name').textContent).toBe('Ks river');
  });

  it('surfaces a limit refusal with the upgrade link', async () => {
    await toResults({
      '/api/solves': (u, o) => (o.method === 'POST'
        ? fail(403, { error: 'Free accounts keep 3 saved solves.', code: 'limit_reached', cap: 3 })
        : ok({ solves: [] })),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save solve' }));
    fireEvent.change(screen.getByLabelText('Solve name'), { target: { value: 'Fourth' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    const msgEl = document.querySelector('.range-save-msg');
    expect(msgEl).toHaveClass('limit');
    expect(msgEl.textContent).toContain('Free accounts keep 3 saved solves.');
    expect(within(msgEl).getByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument();
  });
});
