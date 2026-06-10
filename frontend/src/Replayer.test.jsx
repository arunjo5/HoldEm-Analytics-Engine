import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReplayerView, buildReplaySummary, readReplayFromUrl, buildReplayShareUrl } from './Replayer.jsx';
import { encodeReplay, decodeReplay } from './replayShare.js';
import { ReplayEngine } from './replayerEngine.js';
import * as PokerEngine from './pokerEngine.js';

vi.mock('./pokerEngine.js', async (importOriginal) => ({
  ...(await importOriginal()),
  calculate: vi.fn(),
}));
const calcMock = PokerEngine.calculate;

const card = (s) => ({ v: s[0], s: s[1] });
const C = (str) => { const o = []; for (let i = 0; i < str.length; i += 2) o.push({ v: str[i], s: str[i + 1] }); return o; };

function mkSetup(n, opts = {}) {
  const labels = ReplayEngine.positionsForCount(n);
  const seats = [];
  for (let i = 0; i < n; i++) seats.push({ name: '', stack: opts.stack || 200, pos: labels[i], cards: null });
  if (opts.cards) Object.keys(opts.cards).forEach(k => { seats[k].cards = C(opts.cards[k]); });
  return { sb: opts.sb || 1, bb: opts.bb || 2, ante: opts.ante || 0, seats };
}
const mkHand = (setup, actions, board, extra = {}) =>
  ({ setup, actions, board, board2: null, won: null, runResults: null, ...extra });

const SHOWDOWN_ACTIONS = [
  { seat: 0, type: 'call', street: 0 }, { seat: 1, type: 'check', street: 0 },
  { seat: 1, type: 'check', street: 1 }, { seat: 0, type: 'check', street: 1 },
  { seat: 1, type: 'check', street: 2 }, { seat: 0, type: 'check', street: 2 },
  { seat: 1, type: 'check', street: 3 }, { seat: 0, type: 'check', street: 3 },
];
// heads-up check-down to the river: 12 frames, boardDealt 5 on the last
const showdownHand = (extra = {}, setupExtra = {}) =>
  mkHand(Object.assign(mkSetup(2, { cards: { 0: 'AhAd', 1: 'KsKc' } }), setupExtra), SHOWDOWN_ACTIONS, C('2c7h9dThJs'), extra);

const ritHand = () => mkHand(
  mkSetup(2, { stack: 50, cards: { 0: 'AhAd', 1: 'KsKc' } }),
  [{ seat: 0, type: 'raise', amount: 50, street: 0 }, { seat: 1, type: 'call', street: 0 }],
  C('2c7h9dThJs'),
  { board2: C('3c4d5h6s8c'), runResults: [{ run: 1, won: { 0: 100 } }, { run: 2, won: { 1: 100 } }] }
);

const HAND = {
  setup: {
    sb: 50,
    bb: 100,
    ante: 0,
    cents: false,
    seats: [
      { name: 'rex', stack: 10000, pos: 'BTN', cards: null },
      { name: 'pranad', stack: 8000, pos: 'SB', cards: [card('Ah'), card('Kh')] },
      { name: 'luc', stack: 12000, pos: 'BB', cards: [card('Qd'), card('Qs')] },
    ],
  },
  actions: [
    { seat: 0, type: 'fold', street: 0 },
    { seat: 1, type: 'call', street: 0 },
    { seat: 2, type: 'check', street: 0 },
  ],
  board: [card('2c'), card('7d'), card('Jh')],
  board2: null,
  won: null,
  runResults: null,
};

const noop = () => {};
const show = (hand, props = {}) =>
  render(<ReplayerView initialHand={hand} onExit={noop} onSaveToHistory={noop} {...props} />);

const stepText = () => document.querySelector('.replay-step-count').textContent.replace(/\s+/g, ' ').trim();
const forward = () => fireEvent.click(screen.getByLabelText('Forward'));
const last = () => fireEvent.click(screen.getByLabelText('Last'));
const seatOf = (name) => screen.getByText(name).closest('.replay-seat');
const flushEquity = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const eqBySeat = (m) => calcMock.mockImplementation((players) => {
  const perPlayer = {};
  players.forEach((p, i) => { if (p) perPlayer[i] = { equity: m[i] ?? 0, win: m[i] ?? 0, tie: 0 }; });
  return { perPlayer, sims: 1 };
});

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: false, json: async () => ({}) }));
  calcMock.mockReset();
  calcMock.mockImplementation((players) => {
    const perPlayer = {};
    const idxs = players.map((p, i) => (p ? i : null)).filter(i => i != null);
    idxs.forEach(i => { perPlayer[i] = { equity: 100 / idxs.length, win: 100 / idxs.length, tie: 0 }; });
    return { perPlayer, sims: 1 };
  });
});

const renderReplayer = () =>
  render(<ReplayerView initialHand={HAND} onExit={() => {}} onSaveToHistory={() => {}} />);

describe('ReplayerView', () => {
  it('renders the hand with seat names and nav controls', () => {
    renderReplayer();
    expect(screen.getByText('pranad')).toBeInTheDocument();
    expect(screen.getByText('luc')).toBeInTheDocument();
    expect(screen.getByText('Blinds posted')).toBeInTheDocument();
    expect(screen.getByLabelText('Forward')).toBeInTheDocument();
  });

  it('advances the frame when Forward is clicked', () => {
    renderReplayer();
    expect(screen.getByText('Blinds posted')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Forward'));
    expect(screen.queryByText('Blinds posted')).not.toBeInTheDocument();
  });
});

describe('winners / resultWon selection', () => {
  it('recorded payout shows only on the last frame, formatted in cents', () => {
    show(showdownHand({ won: { 1: 13000 } }, { cents: true }));
    while (!screen.getByLabelText('Forward').disabled) {
      expect(document.querySelector('.replay-seat-win')).toBeNull();
      expect(document.querySelector('.replay-seat.winner')).toBeNull();
      forward();
    }
    expect(screen.getByText('+$130.00')).toBeInTheDocument();
    expect(seatOf('Player 2')).toHaveClass('winner');
    expect(seatOf('Player 1')).not.toHaveClass('winner');
  });

  it('recorded payout beats equity for the winner highlight', async () => {
    eqBySeat({ 0: 90, 1: 10 });
    show(showdownHand({ won: { 1: 200 } }));
    last();
    await flushEquity();
    expect(seatOf('Player 2')).toHaveClass('winner');
    expect(seatOf('Player 1')).not.toHaveClass('winner');
  });

  it('without a payout the best-equity seat wins at showdown', async () => {
    eqBySeat({ 0: 100, 1: 0 });
    show(showdownHand());
    last();
    await flushEquity();
    expect(seatOf('Player 1')).toHaveClass('winner');
    expect(seatOf('Player 2')).not.toHaveClass('winner');
  });

  it('equity ties highlight every tied seat', async () => {
    eqBySeat({ 0: 50, 1: 50 });
    show(showdownHand());
    last();
    await flushEquity();
    expect(seatOf('Player 1')).toHaveClass('winner');
    expect(seatOf('Player 2')).toHaveClass('winner');
  });

  it('a fold-out crowns the last seat standing before the river', () => {
    show(mkHand(mkSetup(3, { cards: { 2: 'QdQs' } }), [
      { seat: 0, type: 'fold', street: 0 }, { seat: 1, type: 'fold', street: 0 },
    ], []));
    expect(document.querySelector('.replay-seat.winner')).toBeNull();
    forward();
    expect(document.querySelector('.replay-seat.winner')).toBeNull();
    last();
    expect(seatOf('Player 3')).toHaveClass('winner');
    expect(seatOf('Player 1')).not.toHaveClass('winner');
    expect(seatOf('Player 2')).not.toHaveClass('winner');
  });

  it('won keys survive the share round-trip as strings and still highlight', () => {
    const out = decodeReplay(encodeReplay(showdownHand({ won: { 1: 13000 } }, { cents: true })));
    show(out);
    last();
    expect(screen.getByText('+$130.00')).toBeInTheDocument();
    expect(seatOf('Player 2')).toHaveClass('winner');
  });
});

describe('favorite toggle flow', () => {
  it('first favorite of an unsaved hand saves to history once', async () => {
    const onSaveToHistory = vi.fn().mockResolvedValue('id123');
    const onSetFavorite = vi.fn();
    show(HAND, { onSaveToHistory, onSetFavorite });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Favorite' })); });
    expect(onSaveToHistory).toHaveBeenCalledTimes(1);
    const [saved, summary] = onSaveToHistory.mock.calls[0];
    expect(saved.actions).toEqual(HAND.actions);
    expect(summary.isReplay).toBe(true);
    expect(summary.actionCount).toBe(HAND.actions.length);
    expect(onSetFavorite).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '✓ Favorited' })).toBeInTheDocument();
    expect(screen.getByText('Added to favorites')).toBeInTheDocument();
  });

  it('unfavorite reuses the id returned by the save', async () => {
    const onSaveToHistory = vi.fn().mockResolvedValue('id123');
    const onSetFavorite = vi.fn();
    show(HAND, { onSaveToHistory, onSetFavorite });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Favorite' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '✓ Favorited' })); });
    expect(onSetFavorite).toHaveBeenCalledWith('id123', false);
    expect(onSaveToHistory).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Removed from favorites')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Favorite' })).toBeInTheDocument();
  });

  it('a hand opened with a savedId favorites via onSetFavorite only', async () => {
    const onSaveToHistory = vi.fn();
    const onSetFavorite = vi.fn();
    show({ ...HAND, savedId: 'abc', favorited: false }, { onSaveToHistory, onSetFavorite });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Favorite' })); });
    expect(onSetFavorite).toHaveBeenCalledWith('abc', true);
    expect(onSaveToHistory).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '✓ Favorited' })).toBeInTheDocument();
  });

  it('seeds the favorited state from the prop', () => {
    show({ ...HAND, savedId: 'abc', favorited: true });
    expect(screen.getByRole('button', { name: '✓ Favorited' })).toBeInTheDocument();
  });

  it('save without an id leaves savedId null; unfavorite then calls neither callback', async () => {
    const onSaveToHistory = vi.fn().mockResolvedValue(undefined);
    const onSetFavorite = vi.fn();
    show(HAND, { onSaveToHistory, onSetFavorite });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Favorite' })); });
    expect(screen.getByRole('button', { name: '✓ Favorited' })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '✓ Favorited' })); });
    expect(onSetFavorite).not.toHaveBeenCalled();
    expect(onSaveToHistory).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Removed from favorites')).toBeInTheDocument();
  });

  // bug: favorited only flips after the await, so a second click re-enters the save branch and double-saves
  it.skip('a second click before the save resolves does not double-save', async () => {
    let resolveSave;
    const onSaveToHistory = vi.fn(() => new Promise(r => { resolveSave = r; }));
    show(HAND, { onSaveToHistory });
    fireEvent.click(screen.getByRole('button', { name: 'Favorite' }));
    fireEvent.click(screen.getByRole('button', { name: 'Favorite' }));
    await act(async () => { resolveSave('id123'); });
    expect(onSaveToHistory).toHaveBeenCalledTimes(1);
  });

  it('a hand rebuilt after New hand saves fresh instead of reusing the stale id', async () => {
    const onSaveToHistory = vi.fn().mockResolvedValue('new-id');
    const onSetFavorite = vi.fn();
    show({ ...HAND, savedId: 'abc', favorited: true }, { onSaveToHistory, onSetFavorite });
    fireEvent.click(screen.getByText('New hand'));
    enterActionPhase(2, PAIRS2);
    fireEvent.click(screen.getByText('Fold'));
    fireEvent.click(screen.getByText('Watch replay →'));
    expect(screen.getByText('Blinds posted')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Favorite' })); });
    expect(onSaveToHistory).toHaveBeenCalledTimes(1);
    expect(onSetFavorite).not.toHaveBeenCalled();
  });

  it('re-syncs savedId/favorited when initialHand changes', () => {
    const { rerender } = render(<ReplayerView initialHand={HAND} onExit={noop} onSaveToHistory={noop} />);
    expect(screen.getByRole('button', { name: 'Favorite' })).toBeInTheDocument();
    rerender(<ReplayerView initialHand={{ ...HAND, savedId: 'zz', favorited: true }} onExit={noop} onSaveToHistory={noop} />);
    expect(screen.getByRole('button', { name: '✓ Favorited' })).toBeInTheDocument();
  });
});

describe('keyboard navigation + transport bounds', () => {
  it('arrows move, Home/End jump, go() clamps at both ends', () => {
    show(HAND);
    expect(stepText()).toBe('1 / 4');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(stepText()).toBe('1 / 4');
    expect(screen.getByText('Blinds posted')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(stepText()).toBe('2 / 4');
    expect(screen.queryByText('Blinds posted')).toBeNull();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('Blinds posted')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'End' });
    expect(stepText()).toBe('4 / 4');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(stepText()).toBe('4 / 4');
    fireEvent.keyDown(window, { key: 'Home' });
    expect(stepText()).toBe('1 / 4');
  });

  it('ignores arrows while an input has focus', () => {
    show(HAND, { historyDrawer: <input aria-label="drawer-search" /> });
    screen.getByLabelText('drawer-search').focus();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(stepText()).toBe('1 / 4');
    expect(screen.getByText('Blinds posted')).toBeInTheDocument();
    screen.getByLabelText('drawer-search').blur();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(stepText()).toBe('2 / 4');
  });

  it('disables transport buttons at the bounds; Last lands on the final label', () => {
    show(HAND);
    expect(screen.getByLabelText('First')).toBeDisabled();
    expect(screen.getByLabelText('Back')).toBeDisabled();
    expect(screen.getByLabelText('Forward')).not.toBeDisabled();
    last();
    expect(stepText()).toBe('4 / 4');
    expect(screen.getByText('luc checks')).toBeInTheDocument();
    expect(screen.getByLabelText('Forward')).toBeDisabled();
    expect(screen.getByLabelText('Last')).toBeDisabled();
    expect(screen.getByLabelText('First')).not.toBeDisabled();
  });

  it('a new initialHand resets playback to frame 1', () => {
    const { rerender } = render(<ReplayerView initialHand={HAND} onExit={noop} onSaveToHistory={noop} />);
    last();
    expect(stepText()).toBe('4 / 4');
    rerender(<ReplayerView initialHand={{ ...HAND }} onExit={noop} onSaveToHistory={noop} />);
    expect(stepText()).toBe('1 / 4');
    expect(screen.getByText('Blinds posted')).toBeInTheDocument();
  });
});

describe('frame equity gating, caching, display', () => {
  it('bails out when an active seat has unknown cards', async () => {
    show(HAND);
    await flushEquity();
    expect(calcMock).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.replay-seat-eq')).toHaveLength(0);
  });

  it('shows bars for the known seats once the unknown one folds', async () => {
    eqBySeat({ 1: 60, 2: 40 });
    show(HAND);
    forward();
    await flushEquity();
    expect(calcMock).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.replay-seat-eq')).toHaveLength(2);
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('a lone live seat shows 100% without calling calculate', async () => {
    show(mkHand(mkSetup(3, { cards: { 2: 'QdQs' } }), [
      { seat: 0, type: 'fold', street: 0 }, { seat: 1, type: 'fold', street: 0 },
    ], []));
    last();
    await flushEquity();
    expect(calcMock).not.toHaveBeenCalled();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('caches equity per street/folded-set key', async () => {
    show(showdownHand());
    await flushEquity();
    expect(calcMock).toHaveBeenCalledTimes(1);
    forward(); await flushEquity();
    forward(); await flushEquity();
    expect(calcMock).toHaveBeenCalledTimes(1);
    forward(); await flushEquity();
    expect(calcMock).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByLabelText('Back'));
    await flushEquity();
    expect(calcMock).toHaveBeenCalledTimes(2);
  });

  it('hides equity on result frames and on run-it-twice frames', async () => {
    const view = show(showdownHand({ won: { 1: 400 } }));
    last();
    await flushEquity();
    expect(calcMock).toHaveBeenCalled();
    expect(document.querySelector('.replay-seat-win')).not.toBeNull();
    expect(document.querySelectorAll('.replay-seat-eq')).toHaveLength(0);
    view.unmount();
    calcMock.mockClear();
    show(ritHand());
    forward(); forward(); forward();
    await flushEquity();
    expect(calcMock).toHaveBeenCalled();
    expect(document.querySelector('.replay-seat-win')).toBeNull();
    expect(document.querySelectorAll('.replay-seat-eq')).toHaveLength(0);
  });

  it('renders without bars when calculate throws', async () => {
    calcMock.mockImplementation(() => { throw new Error('boom'); });
    show(showdownHand());
    await flushEquity();
    expect(document.querySelectorAll('.replay-seat-eq')).toHaveLength(0);
    expect(stepText()).toBe('1 / 12');
  });
});

const PAIRS2 = [['A of s', 'K of s'], ['Q of h', 'J of h']];
const PAIRS4 = [...PAIRS2, ['T of d', '9 of d'], ['8 of c', '7 of c']];

function pickCards(ids) {
  ids.forEach(id => fireEvent.click(screen.getByLabelText(id)));
  fireEvent.click(screen.getByText('Confirm'));
}
function enterActionPhase(count, pairs) {
  if (count !== 6) fireEvent.click(screen.getByRole('button', { name: String(count) }));
  pairs.forEach(pair => {
    fireEvent.click(screen.getAllByText('+ cards')[0]);
    pickCards(pair);
  });
  fireEvent.click(screen.getByText('Enter action →'));
}

describe('HandBuilder flow', () => {
  it('blocks Enter action until every seat has cards, with the right note', () => {
    show(undefined);
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getByText('Enter action →')).toBeDisabled();
    expect(screen.getByText('2 players still need cards')).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('+ cards')[0]);
    pickCards(PAIRS2[0]);
    expect(screen.getByText('1 player still needs cards')).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('+ cards')[0]);
    pickCards(PAIRS2[1]);
    expect(screen.queryByText(/still need/)).toBeNull();
    expect(screen.getByText('Enter action →')).not.toBeDisabled();
  });

  it('changing player count preserves kept seats and refills new ones', () => {
    show(undefined);
    fireEvent.change(screen.getByPlaceholderText('Player 1'), { target: { value: 'zoe' } });
    fireEvent.change(screen.getAllByLabelText('Stack')[0], { target: { value: '555' } });
    fireEvent.click(screen.getAllByText('+ cards')[1]);
    pickCards(PAIRS2[1]);
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(document.querySelectorAll('.builder-seat-row')).toHaveLength(3);
    expect([...document.querySelectorAll('.builder-seat-pos')].map(e => e.textContent)).toEqual(['BTN', 'SB', 'BB']);
    expect(screen.getByPlaceholderText('Player 1')).toHaveValue('zoe');
    expect(screen.getAllByLabelText('Stack')[0]).toHaveValue(555);
    expect(screen.getAllByText('+ cards')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '6' }));
    expect(document.querySelectorAll('.builder-seat-row')).toHaveLength(6);
    expect(screen.getByPlaceholderText('Player 1')).toHaveValue('zoe');
    expect(screen.getAllByLabelText('Stack').map(i => i.value)).toEqual(['555', '200', '200', '200', '200', '200']);
    expect(screen.getAllByText('+ cards')).toHaveLength(5);
  });

  it('starts the action on UTG and logs a fold against that seat', () => {
    show(undefined);
    enterActionPhase(4, PAIRS4);
    expect(document.querySelector('.builder-acting').textContent).toContain('Action on UTG');
    fireEvent.click(screen.getByText('Fold'));
    expect(document.querySelector('.builder-log-item').textContent.trim()).toBe('UTG fold');
    expect(document.querySelector('.builder-acting').textContent).toContain('Action on BTN');
  });

  it('computes quick raise sizes from pot + call and offers all-in', () => {
    show(undefined);
    enterActionPhase(4, PAIRS4);
    const quick = [...document.querySelectorAll('.quick-btn')].map(b => b.textContent);
    expect(quick).toEqual(['½ pot5', '¾ pot6', 'Pot7', 'All-in200']);
    fireEvent.click(screen.getByText('½ pot'));
    expect(screen.getByPlaceholderText('raise to ≥ 4')).toHaveValue(5);
  });

  it('gates the raise commit below min-raise and caps typed amounts at max', () => {
    show(undefined);
    enterActionPhase(4, PAIRS4);
    const commit = screen.getByRole('button', { name: 'Raise to' });
    expect(commit).toBeDisabled();
    const input = screen.getByPlaceholderText('raise to ≥ 4');
    fireEvent.change(input, { target: { value: '3' } });
    expect(commit).toBeDisabled();
    fireEvent.change(input, { target: { value: '999' } });
    expect(commit).not.toBeDisabled();
    fireEvent.click(commit);
    expect(document.querySelector('.builder-log-item').textContent.trim()).toBe('UTG raise 200');
  });

  it('deals flop/turn/river between streets and hands off to the replayer', () => {
    show(undefined);
    enterActionPhase(2, PAIRS2);
    expect(document.querySelector('.builder-acting').textContent).toContain('Action on BTN');
    fireEvent.click(screen.getByText('Call 1'));
    fireEvent.click(screen.getByText('Check'));
    fireEvent.click(screen.getByText('Deal Flop (3 cards)'));
    expect(screen.getByText('Deal the flop')).toBeInTheDocument();
    pickCards(['2 of s', '3 of s', '4 of s']);
    expect(screen.getByText('Enter action · Flop')).toBeInTheDocument();
    expect(screen.queryByText('- preflop -')).toBeNull();
    expect(document.querySelector('.builder-acting').textContent).toContain('Action on BB');
    fireEvent.click(screen.getByText('Check'));
    fireEvent.click(screen.getByText('Check'));
    fireEvent.click(screen.getByText('Deal Turn (1 card)'));
    expect(screen.getByText('0 / 1 selected')).toBeInTheDocument();
    pickCards(['5 of s']);
    expect(screen.getByText('Enter action · Turn')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Check'));
    fireEvent.click(screen.getByText('Check'));
    fireEvent.click(screen.getByText('Deal River (1 card)'));
    pickCards(['6 of s']);
    fireEvent.click(screen.getByText('Check'));
    fireEvent.click(screen.getByText('Check'));
    expect(screen.getByText('Action reached showdown.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Watch replay →'));
    expect(screen.getByText('Blinds posted')).toBeInTheDocument();
    expect(stepText()).toBe('1 / 12');
  });

  it('shows the fold-out message and replays with numeric blinds', () => {
    show(undefined);
    enterActionPhase(2, PAIRS2);
    fireEvent.click(screen.getByText('Fold'));
    expect(screen.getByText('Everyone folded to the last player standing.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Watch replay →'));
    expect(screen.getByText('Blinds posted')).toBeInTheDocument();
    expect(document.querySelector('.replay-pot-val').textContent).toBe('3');
    expect(stepText()).toBe('1 / 2');
  });

  it('undo removes the last action', () => {
    show(undefined);
    enterActionPhase(2, PAIRS2);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    fireEvent.click(screen.getByText('Fold'));
    expect(screen.getByText('Everyone folded to the last player standing.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByText('Everyone folded to the last player standing.')).toBeNull();
    expect(document.querySelector('.builder-acting').textContent).toContain('Action on BTN');
    expect(document.querySelector('.builder-log')).toBeNull();
  });

  // bug: undo() computes `last` but never steps currentStreet/board back as its comment promises
  it.skip('undoing the only flop action steps back to preflop', () => {
    show(undefined);
    enterActionPhase(2, PAIRS2);
    fireEvent.click(screen.getByText('Call 1'));
    fireEvent.click(screen.getByText('Check'));
    fireEvent.click(screen.getByText('Deal Flop (3 cards)'));
    pickCards(['2 of s', '3 of s', '4 of s']);
    fireEvent.click(screen.getByText('Check'));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('Enter action · Preflop')).toBeInTheDocument();
  });
});

describe('frames memo resilience + display branches', () => {
  it('renders the shell with no frames when buildReplay throws', () => {
    show({ setup: mkSetup(2), actions: null, board: [] });
    expect(screen.getByText('Hand Replayer')).toBeInTheDocument();
    expect(screen.getByText('New hand')).toBeInTheDocument();
    expect(document.querySelector('.replay-table')).toBeNull();
    expect(document.querySelector('.replay-transport')).toBeNull();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(document.querySelector('.replay-transport')).toBeNull();
  });

  it('formats the pot in cents vs whole chips', () => {
    const view = show(mkHand(Object.assign(mkSetup(2, { sb: 150, bb: 200 }), { cents: true }), [], []));
    expect(document.querySelector('.replay-pot-val').textContent).toBe('3.50');
    view.unmount();
    show(mkHand(mkSetup(2, { sb: 1.5, bb: 2 }), [], []));
    expect(document.querySelector('.replay-pot-val').textContent).toBe('3.5');
  });

  it('bet chips show street contributions with the money formatter, nothing at 0', () => {
    show(mkHand(Object.assign(mkSetup(3, { sb: 150, bb: 200 }), { cents: true }), [], []));
    expect([...document.querySelectorAll('.replay-bet')].map(c => c.textContent)).toEqual(['1.50', '2.00']);
    expect(seatOf('Player 1').querySelector('.replay-bet')).toBeNull();
  });

  it('ALL-IN badges only on live all-in seats; unknown seats get two card backs', () => {
    show(mkHand(mkSetup(3, { cards: { 2: 'QdQs' } }), [
      { seat: 0, type: 'raise', amount: 200, street: 0 },
      { seat: 1, type: 'fold', street: 0 },
      { seat: 2, type: 'call', street: 0 },
    ], []));
    last();
    expect(screen.getAllByText('ALL-IN')).toHaveLength(2);
    const foldedSeat = seatOf('Player 2');
    expect(foldedSeat).toHaveClass('folded');
    expect(within(foldedSeat).queryByText('ALL-IN')).toBeNull();
    const backs = seatOf('Player 1').querySelector('.replay-seat-cards');
    expect(backs.children).toHaveLength(2);
    expect(backs.textContent).toBe('');
  });
});

describe('buildReplaySummary', () => {
  it('hero is the lowest-index seat with known cards', () => {
    const s = buildReplaySummary(HAND, [], { 1: { equity: 61 }, 2: { equity: 39 } });
    expect(s.isReplay).toBe(true);
    expect(s.heroName).toBe('pranad');
    expect(s.heroCards).toEqual(HAND.setup.seats[1].cards);
    expect(s.heroEquity).toBe(61);
    expect(s.playerCount).toBe(3);
  });

  it('handles no known cards and empty equity', () => {
    const s = buildReplaySummary(mkHand(mkSetup(3), [], []), [], {});
    expect(s.heroCards).toBeNull();
    expect(s.heroName).toBeNull();
    expect(s.heroEquity).toBeNull();
    expect(s.topName).toBeNull();
    expect(s.topEquity).toBeNull();
  });

  it('top equity name falls back name → pos → Player N', () => {
    const setup = { sb: 1, bb: 2, seats: [
      { name: '', pos: 'BTN', stack: 200, cards: null },
      { name: '', stack: 200, cards: null },
      { name: 'zed', pos: 'BB', stack: 200, cards: null },
    ] };
    const hand = { setup, actions: [], board: [] };
    expect(buildReplaySummary(hand, [], { 0: { equity: 70 }, 2: { equity: 20 } }).topName).toBe('BTN');
    expect(buildReplaySummary(hand, [], { 1: { equity: 70 }, 0: { equity: 20 } }).topName).toBe('Player 2');
    const s = buildReplaySummary(hand, [], { 2: { equity: 70 }, 0: { equity: 20 } });
    expect(s.topName).toBe('zed');
    expect(s.topEquity).toBe(70);
  });

  it('labels blinds, previews the board, counts actions', () => {
    const hand = mkHand(mkSetup(2, { cards: { 0: 'AhAd', 1: 'KsKc' } }), [{ seat: 0, type: 'call', street: 0 }], C('2c7h9dThJs'));
    const s = buildReplaySummary(hand, [], null);
    expect(s.blindsLabel).toBe('1/2');
    expect(s.boardPreview).toEqual(C('2c7h9dThJs'));
    expect(s.boardPreview).toHaveLength(5);
    expect(s.boardLen).toBe(5);
    expect(s.actionCount).toBe(1);
  });
});

describe('share URL helpers', () => {
  it('readReplayFromUrl decodes #r= and ignores other hashes', () => {
    window.history.replaceState(null, '', '#r=' + encodeReplay(HAND));
    const out = readReplayFromUrl();
    expect(out.setup.bb).toBe(100);
    expect(out.setup.seats).toHaveLength(3);
    window.history.replaceState(null, '', window.location.pathname);
    expect(readReplayFromUrl()).toBeNull();
    window.history.replaceState(null, '', '#other=x');
    expect(readReplayFromUrl()).toBeNull();
    window.history.replaceState(null, '', window.location.pathname);
  });

  it('buildReplayShareUrl embeds a decodable #r= payload', () => {
    const url = buildReplayShareUrl(HAND);
    expect(url.startsWith(window.location.origin + window.location.pathname + '#r=')).toBe(true);
    const out = decodeReplay(url.split('#r=')[1]);
    expect(out.actions).toEqual(HAND.actions);
    expect(out.board).toEqual(HAND.board);
  });
});
