import { describe, it, expect } from 'vitest';
import { calculate, makeDeck, expandRangeKey, expandRange, cardToId, idToCard, RANK } from './pokerEngine.js';

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

describe('calculate — multiway tie splitting', () => {
  it('AA vs KK vs QQ equities sum to 100', () => {
    const r = calculate([hand('As', 'Ah'), hand('Ks', 'Kh'), hand('Qs', 'Qh')], [], { sims: 50000 });
    const sum = r.perPlayer[0].equity + r.perPlayer[1].equity + r.perPlayer[2].equity;
    expect(Math.abs(sum - 100)).toBeLessThan(0.5);
    expect(Math.abs(r.perPlayer[0].equity - 65)).toBeLessThanOrEqual(5);
  });

  it('2-way full-board chop is exactly 50/50 with equal ties', () => {
    const p = showdown(hand('2h', '3h'), hand('4d', '5d'), board('As', 'Ks', 'Qs', 'Js', 'Ts'));
    expect(p[0].tie).toBe(p[1].tie);
    expect(p[0].tie).toBe(100);
    expect(p[0].equity + p[1].equity).toBe(100);
  });
});

describe('simulate — range players', () => {
  it('deals only the one live combo when the rest are blocked', () => {
    // P1 holds Ks/Kh, so KdKc is the only dealable KK combo; P1 flushes
    const b = board('Qs', 'Js', '9s', '2s', '3h');
    const r = calculate([range('KK'), hand('Ks', 'Kh')], b, { sims: 500 });
    expect(r.sims).toBe(500);
    expect(r.perPlayer[1].equity).toBe(100);
    expect(r.perPlayer[0].equity).toBe(0);
  });

  it('fully blocked range terminates with zero valid sims', () => {
    // all four aces dead (two on board, two in P1's hand)
    const b = board('Ad', 'Ac', '7c', '8d', '2h');
    const r = calculate([range('AA'), hand('As', 'Ah')], b, { sims: 100 });
    expect(r.sims).toBe(0);
    expect(r.perPlayer[0].equity).toBe(0);
    expect(r.perPlayer[1].equity).toBe(0);
  });

  it('range AA vs KK hand ≈ 82/18 preflop', () => {
    const r = calculate([range('AA'), hand('Ks', 'Kh')], [], { sims: 40000 });
    expect(Math.abs(r.perPlayer[0].equity - 81.9)).toBeLessThanOrEqual(4);
  });

  it('range AA vs range KK ≈ 82/18 and sums to 100', () => {
    const r = calculate([range('AA'), range('KK')], [], { sims: 40000 });
    expect(Math.abs(r.perPlayer[0].equity - 81.5)).toBeLessThanOrEqual(4);
    expect(Math.abs(r.perPlayer[0].equity + r.perPlayer[1].equity - 100)).toBeLessThan(0.5);
  });

  it('empty range player is skipped', () => {
    const b = board('2h', '7d', '9c', '4s', '8h');
    const r = calculate([range(), hand('As', 'Ks'), hand('Qd', 'Qc')], b, { sims: 1 });
    expect(Object.keys(r.perPlayer).sort()).toEqual(['1', '2']);
  });
});

describe('evaluate7 — full house boundaries', () => {
  it('two trips: higher trip plays as trips, lower as the pair', () => {
    const p = showdown(hand('Ah', 'Kd'), hand('7h', '2c'), board('7d', '7c', '5h', '5d', '5s'));
    expect(p[1].equity).toBe(100); // 777-55 > 555-77
  });

  it('full houses compare trips before pair', () => {
    const p = showdown(hand('2s', '9h'), hand('Ad', 'Td'), board('2c', '2d', 'Ah', 'As', '5c'));
    expect(p[1].equity).toBe(100); // AAA-22 > 222-AA
  });

  it('trip without a pair is not a full house', () => {
    // P0 has trip aces AND an A-high flush; the flush must be what plays
    const p = showdown(hand('As', '2s'), hand('8d', '9c'), board('Ad', 'Ah', '7s', '6s', '5s'));
    expect(p[0].equity).toBe(100); // flush > P1's 9-high straight
  });

  it('trip on board + pocket pair makes a full house', () => {
    const p = showdown(hand('2c', '2d'), hand('Ad', 'Qc'), board('Kd', 'Kc', 'Kh', '4d', '9s'));
    expect(p[0].equity).toBe(100); // KKK-22 > trips with A,Q kickers
  });
});

describe('evaluate7 — straight/flush selection edges', () => {
  it('steel wheel beats quads', () => {
    const p = showdown(hand('As', '5s'), hand('Kh', 'Ks'), board('2s', '3s', '4s', 'Kd', 'Kc'));
    expect(p[0].equity).toBe(100);
  });

  it('steel wheel is the lowest straight flush', () => {
    const p = showdown(hand('As', 'Ah'), hand('6s', '7d'), board('2s', '3s', '4s', '5s', '9d'));
    expect(p[1].equity).toBe(100); // 6-high SF > 5-high SF
  });

  it('six-card straight run picks the highest top', () => {
    const p = showdown(hand('9d', '4h'), hand('4d', '3h'), board('5c', '6d', '7h', '8s', '2c'));
    expect(p[0].equity).toBe(100); // 9-high > 8-high
  });

  it('A-2-3-4-6 is not a straight', () => {
    const p = showdown(hand('2d', '9h'), hand('Kd', 'Qd'), board('Ah', '2c', '3d', '4s', '6h'));
    expect(p[0].equity).toBe(100); // pair of 2s > high card; a false straight would chop
  });

  it('flush 5th card decides', () => {
    const p = showdown(hand('9h', '3d'), hand('8h', '3s'), board('Ah', 'Kh', 'Qh', 'Jh', '2c'));
    expect(p[0].equity).toBe(100); // AKQJ9 > AKQJ8
  });

  it('six flush cards keep only the top five', () => {
    const p = showdown(hand('Ah', '3c'), hand('Kh', 'Qd'), board('2h', '4h', '7h', '9h', 'Jh'));
    expect(p[0].equity).toBe(100); // A-J-9-7-4 > K-J-9-7-4
  });
});

describe('evaluate7 — kicker ordering on paired boards', () => {
  it('quad on board, hole kicker decides', () => {
    const p = showdown(hand('Ah', '2c'), hand('Kd', '3c'), board('8h', '8d', '8s', '8c', 'Qd'));
    expect(p[0].equity).toBe(100);
  });

  it('quad on board with board ace kicker chops', () => {
    const p = showdown(hand('Kh', '2c'), hand('Qd', '3c'), board('8h', '8d', '8s', '8c', 'Ad'));
    expect(p[0].equity).toBe(50);
    expect(p[1].equity).toBe(50);
    expect(p[0].tie).toBe(100);
    expect(p[1].tie).toBe(100);
  });

  it('three pairs: third pair rank plays as the kicker', () => {
    const p = showdown(hand('9s', '9d'), hand('7d', '3c'), board('Kd', 'Kc', 'Qd', 'Qc', '8h'));
    expect(p[0].equity).toBe(100); // KKQQ-9 > KKQQ-8
  });

  it('three pairs lose to an ace kicker', () => {
    const p = showdown(hand('2s', '2d'), hand('Ah', '3c'), board('Kd', 'Kc', 'Qd', 'Qc', '8h'));
    expect(p[1].equity).toBe(100); // KKQQ-A > KKQQ-8 (deuces don't play)
  });

  it('one pair uses exactly three kickers', () => {
    const p = showdown(hand('As', '4c'), hand('Ah', '2d'), board('Ad', 'Kc', 'Qd', 'Jh', '9c'));
    expect(p[0].equity).toBe(50); // 4 vs 2 must not break the AKQJ tie
    expect(p[1].equity).toBe(50);
    expect(p[0].tie).toBe(100);
  });
});

describe('simulate — conflicts, safety cap, sparse players', () => {
  it('hand-vs-hand card conflict returns zeros', () => {
    const r = calculate([hand('As', 'Kd'), hand('As', 'Qd')], [], { sims: 100 });
    expect(r.sims).toBe(0);
    for (const idx of ['0', '1']) {
      expect(r.perPlayer[idx].win).toBe(0);
      expect(r.perPlayer[idx].tie).toBe(0);
      expect(r.perPlayer[idx].equity).toBe(0);
    }
  });

  it('board-hand conflict returns zeros', () => {
    const r = calculate([hand('As', 'Ad'), hand('Ks', 'Kh')], board('As', '7d', '2c'), { sims: 100 });
    expect(r.sims).toBe(0);
    expect(r.perPlayer[0].equity).toBe(0);
    expect(r.perPlayer[1].equity).toBe(0);
  });

  it('conflict-free run completes every requested sim', () => {
    const b = board('2h', '7d', '9c', '4s', '8h');
    const r = calculate([hand('As', 'Ah'), hand('Ks', 'Kh')], b, { sims: 1000 });
    expect(r.sims).toBe(1000);
  });

  it('all-null players yield an empty result', () => {
    const r = calculate([null, undefined], [], { sims: 10 });
    expect(r.perPlayer).toEqual({});
    expect(r.sims).toBe(0);
  });

  it('sparse arrays keep original player indices', () => {
    const b = board('2h', '7d', '9c', '4s', '8h');
    const r = calculate([null, hand('As', 'Ah'), null, hand('Ks', 'Kh')], b, { sims: 1 });
    expect(Object.keys(r.perPlayer).sort()).toEqual(['1', '3']);
  });

  it('skips a player with an incomplete hand', () => {
    const b = board('2h', '7d', '9c', '4s', '8h');
    const r = calculate([{ kind: 'hand', hand: [card('As')] }, hand('Ks', 'Kh')], b, { sims: 1 });
    expect(Object.keys(r.perPlayer)).toEqual(['1']);
  });

  it('caps a conflicting deal at sims*50 attempts quickly', () => {
    const t0 = performance.now();
    const r = calculate([hand('As', 'Kd'), hand('As', 'Qd')], [], { sims: 1000 });
    expect(r.sims).toBe(0);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('cardToId / idToCard encoding', () => {
  it('round-trips all 52 ids', () => {
    for (let id = 0; id < 52; id++) expect(cardToId(idToCard(id))).toBe(id);
  });

  it('pins the rank-major layout anchors', () => {
    expect(cardToId({ v: '2', s: 's' })).toBe(0);
    expect(cardToId({ v: 'A', s: 'c' })).toBe(51);
    expect(cardToId({ v: 'A', s: 's' })).toBe(48);
  });

  it('decodes rank as (id>>>2)+2 for every id', () => {
    for (let id = 0; id < 52; id++) expect(RANK[idToCard(id).v]).toBe((id >>> 2) + 2);
  });

  it('AKs combos are same-suit, AKo combos cross-suit', () => {
    const suited = expandRangeKey('AKs');
    expect(suited).toHaveLength(4);
    for (const [a, b] of suited) expect(a.s).toBe(b.s);
    const off = expandRangeKey('AKo');
    expect(off).toHaveLength(12);
    for (const [a, b] of off) expect(a.s).not.toBe(b.s);
  });

  it('QQ expands to 6 distinct unordered combos', () => {
    const combos = expandRangeKey('QQ');
    expect(combos).toHaveLength(6);
    const seen = new Set();
    for (const [a, b] of combos) {
      expect(a.s).not.toBe(b.s);
      seen.add([a.s, b.s].sort().join(''));
    }
    expect(seen.size).toBe(6);
  });

  it('non-pair key without s/o suffix expands to nothing', () => {
    expect(expandRangeKey('AK')).toEqual([]);
  });
});

describe('input hardening', () => {
  const fullBoard = board('2h', '7d', '9c', '4s', '8h');

  it('rejects more than 9 active players', () => {
    const ten = [
      hand('As', 'Ah'), hand('Ks', 'Kh'), hand('Qs', 'Qh'), hand('Js', 'Jh'), hand('Ts', 'Th'),
      hand('9s', '9h'), hand('8s', '8d'), hand('7s', '7h'), hand('6s', '6h'), hand('5s', '5h'),
    ];
    expect(() => calculate(ten, fullBoard, { sims: 5 })).toThrow();
  });

  it('sims:0 falls back to the 100000 default', () => {
    const r = calculate([hand('As', 'Ah'), hand('Ks', 'Kh')], fullBoard, { sims: 0 });
    expect(r.sims).toBe(100000);
  }, 15000);

  it('omitted opts default to 100000 sims', () => {
    const r = calculate([hand('As', 'Ah'), hand('Ks', 'Kh')], fullBoard);
    expect(r.sims).toBe(100000);
  }, 15000);
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
