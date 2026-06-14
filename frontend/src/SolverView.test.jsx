import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SolverView } from './SolverView.jsx';

class FakeWorker {
  constructor() { FakeWorker.instances.push(this); this.onmessage = null; this.posted = []; this.terminated = false; }
  postMessage(m) { this.posted.push(m); }
  terminate() { this.terminated = true; }
}
FakeWorker.instances = [];

const VALS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const SUIT_ROWS = ['s', 'h', 'c', 'd'];
const c = (v, s) => ({ v, s });
const BOARD = [c('2', 's'), c('7', 'h'), c('9', 'c'), c('J', 'd'), c('K', 's')];

function clickPickerCard(v, s) {
  const grid = document.querySelector('.picker-grid');
  fireEvent.click(grid.querySelectorAll('.pcard')[SUIT_ROWS.indexOf(s) * 13 + VALS.indexOf(v)]);
}

function dealStreet(slotIdx, cards) {
  fireEvent.click(document.querySelectorAll('.sv-board-row .board-strip-btn')[slotIdx]);
  cards.forEach((card) => clickPickerCard(card.v, card.s));
  fireEvent.click(document.querySelector('.picker-foot .btn-primary'));
}
function setBoard() {
  dealStreet(0, BOARD.slice(0, 3)); // flop button
  dealStreet(1, BOARD.slice(3, 4)); // turn
  dealStreet(2, BOARD.slice(4, 5)); // river
}

function setOopHandAhKh() {
  fireEvent.click(within(document.querySelectorAll('.sv-range-row')[0]).getByRole('button', { name: 'Hand' }));
  clickPickerCard('A', 'h');
  clickPickerCard('K', 'h');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm hand' }));
}

function setIpRangeAA() {
  fireEvent.click(within(document.querySelectorAll('.sv-range-row')[1]).getByRole('button', { name: 'Range' }));
  fireEvent.mouseDown(screen.getByText('AA'));
  fireEvent.click(screen.getByRole('button', { name: 'Save range' }));
}

function renderReady() {
  const utils = render(<SolverView onExit={() => {}} theme="dark" onToggleTheme={() => {}} />);
  setBoard();
  setOopHandAhKh();
  setIpRangeAA();
  return utils;
}

const worker = () => FakeWorker.instances[0];
const msg = (data) => act(() => { worker().onmessage({ data }); });
const solveBtn = () => screen.getByRole('button', { name: 'Solve' });
const pctText = () => document.querySelector('.sv-solving-pct').textContent;

const fixtureResult = () => ({
  nodes: [{
    id: 'oop_first', actor: 'OOP', label: 'OOP — first to act',
    actions: [
      { id: 'check', kind: 'check', label: 'Check' },
      { id: 'b75', kind: 'bet', sizePct: 75, label: 'Bet 75%' },
    ],
  }],
  nodeSolves: { oop_first: { byKey: {}, combos: [], count: 0 } },
  meta: { potBb: 20, evOOP: 10, evIP: 9.9, exploitPctPot: 0.42, iterations: 256, sizeCount: 4 },
  trace: [5, 3, 1, 0.4],
});

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SolverView worker lifecycle', () => {
  it('creates one worker on mount and terminates it on unmount', () => {
    const { unmount } = render(<SolverView onExit={() => {}} theme="dark" onToggleTheme={() => {}} />);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(worker().terminated).toBe(false);
    unmount();
    expect(worker().terminated).toBe(true);
  });
});

describe('runSolve', () => {
  it('posts the job and switches to the solving stage', () => {
    renderReady();
    fireEvent.click(solveBtn());
    expect(worker().posted).toHaveLength(1);
    const m = worker().posted[0];
    expect(m.jobId).toBe(1);
    expect(m.board).toEqual(BOARD);
    expect(m.oopKeys).toEqual(['AKs']);
    expect(m.ipKeys).toEqual(['AA']);
    expect(m.spot).toMatchObject({ pot: 20, stack: 80, allIn: true });
    expect(m.spot.betSizes.map((b) => b.pct)).toEqual([33, 75, 125]);
    expect(screen.getByText(/Running CFR iterations/)).toBeInTheDocument();
    expect(screen.queryByText('Spot configuration')).toBeNull();
  });

  it('restricts a hand side to both card orderings and leaves a range side null', () => {
    renderReady();
    fireEvent.click(solveBtn());
    const { opts } = worker().posted[0];
    expect(opts.oopRestrict).toEqual(new Set(['AhKh', 'KhAh']));
    expect(opts.ipRestrict).toBeNull();
  });
});

describe('solving stage', () => {
  it('shows combo counts, tree size, and 0% before any progress', () => {
    renderReady();
    fireEvent.click(solveBtn());
    expect(document.querySelector('.sv-solving-sub').textContent).toBe('4 × 6 combos · 4-size tree · pot 20 bb');
    expect(pctText()).toBe('0%');
  });

  it('progress message updates pct, iterations, and exploitability', () => {
    renderReady();
    fireEvent.click(solveBtn());
    msg({ jobId: worker().posted[0].jobId, type: 'progress', iter: 128, total: 256, exploit: 1.5, pct: 0.5 });
    expect(pctText()).toBe('50%');
    const stats = document.querySelectorAll('.sv-solving-stat-val');
    expect(stats[0].textContent).toBe('128');
    expect(stats[1].textContent).toContain('1.50');
    expect(stats[2].textContent).toBe('256');
  });
});

describe('done / error messages', () => {
  it('done switches to results', () => {
    renderReady();
    fireEvent.click(solveBtn());
    msg({ jobId: 1, type: 'done', result: fixtureResult() });
    expect(screen.getByText('Decision node')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-solve' })).toBeInTheDocument();
  });

  it('done with an empty result shows the banner and returns to setup', () => {
    renderReady();
    fireEvent.click(solveBtn());
    msg({ jobId: 1, type: 'done', result: { empty: true } });
    expect(document.querySelector('.sv-error-banner').textContent).toBe('No live combos to solve — check the board and ranges.');
    expect(screen.getByText('Spot configuration')).toBeInTheDocument();
  });

  it('error shows the message, returns to setup, and a new solve clears it', () => {
    renderReady();
    fireEvent.click(solveBtn());
    msg({ jobId: 1, type: 'error', message: 'boom' });
    expect(document.querySelector('.sv-error-banner').textContent).toBe('boom');
    expect(screen.getByText('Spot configuration')).toBeInTheDocument();
    fireEvent.click(solveBtn());
    expect(document.querySelector('.sv-error-banner')).toBeNull();
  });
});

describe('jobId staleness guard', () => {
  it('ignores late messages from a superseded job', () => {
    renderReady();
    fireEvent.click(solveBtn());
    msg({ jobId: 1, type: 'done', result: fixtureResult() });
    fireEvent.click(screen.getByRole('button', { name: 'Re-solve' }));
    expect(worker().posted[1].jobId).toBe(2);
    msg({ jobId: 1, type: 'done', result: fixtureResult() });
    expect(screen.queryByText('Decision node')).toBeNull();
    expect(screen.getByText(/Running CFR iterations/)).toBeInTheDocument();
    msg({ jobId: 1, type: 'progress', iter: 200, total: 256, exploit: 1, pct: 0.9 });
    expect(pctText()).toBe('0%');
    msg({ jobId: 2, type: 'progress', iter: 64, total: 256, exploit: 2, pct: 0.25 });
    expect(pctText()).toBe('25%');
  });

  it('re-solve resets progress and result before posting', () => {
    renderReady();
    fireEvent.click(solveBtn());
    msg({ jobId: 1, type: 'progress', iter: 128, total: 256, exploit: 1.5, pct: 0.5 });
    msg({ jobId: 1, type: 'done', result: fixtureResult() });
    fireEvent.click(screen.getByRole('button', { name: 'Re-solve' }));
    expect(screen.queryByText('Decision node')).toBeNull();
    expect(pctText()).toBe('0%');
    expect(document.querySelectorAll('.sv-solving-stat-val')[0].textContent).toBe('0');
  });
});
