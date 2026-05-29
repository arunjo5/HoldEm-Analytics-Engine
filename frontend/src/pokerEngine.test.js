import { describe, it, expect } from 'vitest';
import { calculate, makeDeck, expandRangeKey, expandRange } from './pokerEngine.js';

// ── helpers ──────────────────────────────────────────────
const card = (s) => ({ v: s[0], s: s[1] });
const hand = (...cs) => ({ kind: 'hand', hand: cs.map(card) });
const range = (...keys) => ({ kind: 'range', range: keys });
const board = (...cs) => cs.map(card);

// Two-hand showdown. With a full 5-card board there are zero unknown
// cards, so the result is exact (no Monte Carlo variance).
function showdown(h0, h1, b) {
  const r = calculate([h0, h1], b, { sims: 1 });
  return r.perPlayer;
}

describe('evaluate7 — deterministic showdowns (full board)', () => {
  it('higher pair wins', () => {
    const p = showdown(hand('Ah', 'Kc'), hand('Qd', 'Jc'), board('Ad', '7c', '2h', '9s', '4d'));
    expect(p[0].equity).toBe(100);
    expect(p[1].equity).toBe(0);
  });

  it('kicker decides when pairs tie', () => {
    // Both pair aces on the board; P0 has K kicker vs P1 Q kicker.
    const p = showdown(hand('Ah', 'Ks'), hand('Ac', 'Qd'), board('Ad', '7c', '2h', '9s', '4d'));
    expect(p[0].equity).toBe(100);
    expect(p[1].equity).toBe(0);
  });

  it('flush beats straight', () => {
    // Board has 3 spades; P0 makes a spade flush, P1 an 8-high straight.
    const p = showdown(hand('As', 'Ks'), hand('6h', '8d'), board('2s', '7s', '9s', '4h', '5d'));
    expect(p[0].equity).toBe(100);
  });

  it('full house beats flush', () => {
    const p = showdown(hand('Kh', 'Qc'), hand('As', '9s'), board('Ks', 'Kd', '5s', '5h', '2s'));
    expect(p[0].equity).toBe(100); // KKK55 > A-high flush
  });

  it('quads beat a full house', () => {
    const p = showdown(hand('8c', 'Qh'), hand('Ks', '2c'), board('8h', '8d', '8s', 'Kc', 'Kd'));
    expect(p[0].equity).toBe(100); // four 8s > KKK88
  });

  it('straight flush beats quads', () => {
    const p = showdown(hand('8s', '9s'), hand('As', 'Ah'), board('5s', '6s', '7s', 'Ad', 'Ac'));
    expect(p[0].equity).toBe(100); // 5-9 spade straight flush > quad aces
  });

  it('detects the wheel (A-2-3-4-5) as a straight', () => {
    const p = showdown(hand('5c', 'Kh'), hand('9c', '9d'), board('Ah', '2c', '3d', '4s', 'Qh'));
    expect(p[0].equity).toBe(100); // wheel straight > pair of nines
  });

  it('splits when both players play the board', () => {
    const p = showdown(hand('2c', '3d'), hand('7h', '8d'), board('As', 'Ks', 'Qs', 'Js', 'Ts'));
    expect(p[0].equity).toBe(50);
    expect(p[1].equity).toBe(50);
    expect(p[0].tie).toBe(100);
  });
});

describe('equity — preflop within tolerance', () => {
  const close = (got, want, tol = 4) => Math.abs(got - want) <= tol;

  it('AA vs KK ≈ 82/18', () => {
    const r = calculate([hand('As', 'Ah'), hand('Ks', 'Kh')], [], { sims: 50000 });
    expect(close(r.perPlayer[0].equity, 82)).toBe(true);
    expect(close(r.perPlayer[1].equity, 18)).toBe(true);
  });

  it('AA crushes 72o (>85%)', () => {
    const r = calculate([hand('As', 'Ah'), hand('7d', '2c')], [], { sims: 50000 });
    expect(r.perPlayer[0].equity).toBeGreaterThan(85);
  });

  it('equities sum to ~100 across players', () => {
    const r = calculate([hand('As', 'Ah'), hand('Ks', 'Kh')], [], { sims: 30000 });
    const sum = r.perPlayer[0].equity + r.perPlayer[1].equity;
    expect(Math.abs(sum - 100)).toBeLessThan(0.5);
  });
});

describe('deck + range expansion', () => {
  it('makeDeck returns 52 unique cards', () => {
    const d = makeDeck();
    expect(d).toHaveLength(52);
    expect(new Set(d.map((c) => c.v + c.s)).size).toBe(52);
  });

  it('pocket pair expands to 6 combos', () => {
    expect(expandRangeKey('AA')).toHaveLength(6);
  });

  it('suited expands to 4, offsuit to 12', () => {
    expect(expandRangeKey('AKs')).toHaveLength(4);
    expect(expandRangeKey('AKo')).toHaveLength(12);
  });

  it('expandRange concatenates multiple keys', () => {
    expect(expandRange(['AA', 'AKs'])).toHaveLength(10);
  });
});
