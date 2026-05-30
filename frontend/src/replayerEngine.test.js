import { describe, it, expect } from 'vitest';
import { ReplayEngine as E } from './replayerEngine.js';
import { calculate } from './pokerEngine.js';

const C = (str) => { const o = []; for (let i = 0; i < str.length; i += 2) o.push({ v: str[i], s: str[i + 1] }); return o; };
function mkSetup(n, opts = {}) {
  const labels = E.positionsForCount(n);
  const seats = [];
  for (let i = 0; i < n; i++) seats.push({ name: '', stack: opts.stack || 200, pos: labels[i], cards: null });
  if (opts.cards) Object.keys(opts.cards).forEach(k => { seats[k].cards = C(opts.cards[k]); });
  return { sb: opts.sb || 1, bb: opts.bb || 2, ante: opts.ante || 0, seats };
}
const near = (actual, expected, tol) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);

describe('positions & blinds', () => {
  it('position labels', () => {
    expect(E.positionsForCount(2)).toEqual(['BTN', 'BB']);
    expect(E.positionsForCount(3)).toEqual(['BTN', 'SB', 'BB']);
    expect(E.positionsForCount(6)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']);
    expect(E.positionsForCount(9)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO']);
    expect(E.positionsForCount(5)[0]).toBe('BTN');
  });
  it('blind seats', () => {
    expect(E.blindSeats(2)).toEqual({ sb: 0, bb: 1 });
    expect(E.blindSeats(6)).toEqual({ sb: 1, bb: 2 });
  });
});

describe('initial state / blinds posted', () => {
  it('6-max posts blinds correctly', () => {
    const st = E.initState(mkSetup(6));
    expect(st.pot).toBe(3);
    expect(st.stacks[1]).toBe(199);
    expect(st.stacks[2]).toBe(198);
    expect(st.toCall).toBe(2);
    expect(st.streetContrib[1]).toBe(1);
    expect(st.streetContrib[2]).toBe(2);
    expect(st.nextSeat).toBe(3); // UTG first preflop
    expect(st.folded.every(f => !f)).toBe(true);
  });
  it('3-handed preflop first = BTN', () => {
    expect(E.initState(mkSetup(3)).nextSeat).toBe(0);
  });
  it('heads-up: BTN posts SB, acts first', () => {
    const st = E.initState(mkSetup(2));
    expect(st.streetContrib[0]).toBe(1);
    expect(st.streetContrib[1]).toBe(2);
    expect(st.nextSeat).toBe(0);
  });
  it('antes add to pot', () => {
    const st = E.initState(mkSetup(6, { ante: 1 }));
    expect(st.pot).toBe(9); // 6×1 ante + 3 blinds
    expect(st.stacks[3]).toBe(199);
  });
});

describe('legal options', () => {
  it('UTG facing the big blind', () => {
    const setup = mkSetup(6);
    const o = E.legalOptions(E.initState(setup), setup);
    expect(o.seat).toBe(3);
    expect(o.callAmt).toBe(2);
    expect(o.canCheck).toBe(false);
    expect(o.canCall).toBe(true);
    expect(o.canBet).toBe(false);
    expect(o.canRaise).toBe(true);
    expect(o.minRaiseTo).toBe(4);
  });
  it('postflop first actor can check/bet, not raise', () => {
    const setup = mkSetup(3);
    const st = E.initState(setup);
    E.applyAction(st, { seat: 0, type: 'call' });
    E.applyAction(st, { seat: 1, type: 'call' });
    E.applyAction(st, { seat: 2, type: 'check' });
    expect(E.streetComplete(st)).toBe(true);
    E.advanceStreet(st, C('Ah7c2d'));
    const o = E.legalOptions(st, setup);
    expect(o.seat).toBe(1);
    expect(o.canCheck).toBe(true);
    expect(o.canBet).toBe(true);
    expect(o.canRaise).toBe(false);
    expect(o.toCall).toBe(0);
  });
});

describe('action mechanics', () => {
  it('a raise updates pot/toCall/lastRaiseSize and reopens action', () => {
    const setup = mkSetup(6);
    const st = E.initState(setup);
    E.applyAction(st, { seat: 3, type: 'raise', amount: 6 });
    expect(st.stacks[3]).toBe(194);
    expect(st.toCall).toBe(6);
    expect(st.lastRaiseSize).toBe(4);
    expect(st.pot).toBe(9);
    expect(st.aggressor).toBe(3);
    expect(st.nextSeat).toBe(4);
    E.applyAction(st, { seat: 4, type: 'call' });
    expect(st.streetContrib[4]).toBe(6);
    expect(st.nextSeat).toBe(5);
  });
  it('3-bet reopens action for the original raiser', () => {
    const setup = mkSetup(6);
    const st = E.initState(setup);
    E.applyAction(st, { seat: 3, type: 'raise', amount: 6 });
    E.applyAction(st, { seat: 4, type: 'raise', amount: 18 });
    expect(st.toCall).toBe(18);
    expect(st.lastRaiseSize).toBe(12);
    expect(E.needsAction(st, 3)).toBe(true);
  });
});

describe('hand termination', () => {
  it('folds out to one player', () => {
    const setup = mkSetup(6);
    const st = E.initState(setup);
    [3, 4, 5, 0, 1].forEach(seat => E.applyAction(st, { seat, type: 'fold' }));
    expect(st.handOver).toBe(true);
    expect(E.activeCount(st)).toBe(1);
    expect(st.folded.findIndex(f => !f)).toBe(2);
  });
  it('BB option closes preflop', () => {
    const setup = mkSetup(6);
    const st = E.initState(setup);
    [3, 4, 5, 0].forEach(seat => E.applyAction(st, { seat, type: 'fold' }));
    E.applyAction(st, { seat: 1, type: 'call' });
    expect(st.nextSeat).toBe(2);
    E.applyAction(st, { seat: 2, type: 'check' });
    expect(E.streetComplete(st)).toBe(true);
  });
  it('heads-up street order flips postflop', () => {
    const setup = mkSetup(2);
    const st = E.initState(setup);
    expect(st.nextSeat).toBe(0);
    E.applyAction(st, { seat: 0, type: 'call' });
    E.applyAction(st, { seat: 1, type: 'check' });
    expect(E.streetComplete(st)).toBe(true);
    E.advanceStreet(st, C('Ah7c2d'));
    expect(st.nextSeat).toBe(1);
  });
});

describe('buildReplay — full hand frames', () => {
  it('produces correct frame sequence + pot/stack math', () => {
    const setup = mkSetup(6, { cards: { 0: 'AsKs', 2: 'QhQd' } });
    setup.seats[0].name = 'Hero'; setup.seats[2].name = 'Villain';
    const board = C('Ah7c2dKh3s');
    const actions = [
      { seat: 3, type: 'fold', street: 0 }, { seat: 4, type: 'fold', street: 0 }, { seat: 5, type: 'fold', street: 0 },
      { seat: 0, type: 'raise', amount: 6, street: 0 }, { seat: 1, type: 'fold', street: 0 }, { seat: 2, type: 'call', street: 0 },
      { seat: 2, type: 'check', street: 1 }, { seat: 0, type: 'bet', amount: 8, street: 1 }, { seat: 2, type: 'call', street: 1 },
      { seat: 2, type: 'check', street: 2 }, { seat: 0, type: 'bet', amount: 20, street: 2 }, { seat: 2, type: 'call', street: 2 },
      { seat: 2, type: 'check', street: 3 }, { seat: 0, type: 'bet', amount: 50, street: 3 }, { seat: 2, type: 'call', street: 3 },
    ];
    const f = E.buildReplay(setup, actions, board);
    expect(f.length).toBe(19);
    expect(f[0].kind).toBe('init');
    expect(f[0].pot).toBe(3);
    expect(f[7].kind).toBe('deal');
    expect(f[7].boardDealt).toBe(3);
    expect(f[11].boardDealt).toBe(4);
    expect(f[15].boardDealt).toBe(5);
    expect(f[f.length - 1].pot).toBe(169);
    expect(f[4].label.indexOf('Hero raises to 6')).toBe(0);
    expect(f[6].label.indexOf('Villain calls 4')).toBe(0);
    expect(f[f.length - 1].stacks[0]).toBe(116);
    expect(f[f.length - 1].stacks[2]).toBe(116);
    expect(f[6].boardDealt).toBe(0);
  });
});

describe('all-in runout', () => {
  it('runs the board out when players are all-in', () => {
    const setup = mkSetup(2, { stack: 50, cards: { 0: 'AhAd', 1: 'KsKc' } });
    const board = C('2c7h9dThJs');
    const actions = [
      { seat: 0, type: 'raise', amount: 50, street: 0 },
      { seat: 1, type: 'call', street: 0 },
    ];
    const f = E.buildReplay(setup, actions, board);
    const last = f[f.length - 1];
    expect(last.pot).toBe(100);
    expect(last.boardDealt).toBe(5);
    expect([last.allin[0], last.allin[1]]).toEqual([true, true]);
    expect(f.filter(x => x.kind === 'deal').length).toBe(3);
  });
  it('caps an overbet raise to the stack (short all-in)', () => {
    const setup = mkSetup(3, { stack: 200 });
    setup.seats[0].stack = 5;
    const st = E.initState(setup);
    E.applyAction(st, { seat: 0, type: 'raise', amount: 999 });
    expect(st.stacks[0]).toBe(0);
    expect(st.allin[0]).toBe(true);
  });
});

describe('liveState (builder helper)', () => {
  it('reflects actions taken so far', () => {
    const setup = mkSetup(6);
    const st = E.liveState(setup, [
      { seat: 3, type: 'fold', street: 0 }, { seat: 4, type: 'raise', amount: 6, street: 0 },
    ], []);
    expect(st.nextSeat).toBe(5);
    expect(st.pot).toBe(9);
  });
});

describe('equity sanity (engine used by replayer)', () => {
  it('AA vs KK ≈ 82/18', () => {
    const r = calculate([{ kind: 'hand', hand: C('AsAd') }, { kind: 'hand', hand: C('KsKc') }], [], { sims: 40000 });
    near(r.perPlayer[0].equity, 82, 3);
    near(r.perPlayer[1].equity, 18, 3);
  });
  it('AKs two pair ≈ 90% vs QQ on AK2', () => {
    const r = calculate([{ kind: 'hand', hand: C('AsKs') }, { kind: 'hand', hand: C('QhQd') }], C('AhKd2c'), { sims: 30000 });
    near(r.perPlayer[0].equity, 90, 3);
  });
  it('equity swings once the ace flops', () => {
    const heroVsQQ = (board) =>
      calculate([{ kind: 'hand', hand: C('AsKs') }, { kind: 'hand', hand: C('QhQd') }], board, { sims: 20000 }).perPlayer[0].equity;
    const pre = heroVsQQ([]);
    const flopHit = heroVsQQ(C('Ah7c2d'));
    near(pre, 46, 4);
    expect(flopHit).toBeGreaterThan(pre + 20);
  });
});
