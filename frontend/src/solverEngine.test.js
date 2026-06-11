import { describe, it, expect } from 'vitest';
import {
  solve, equityMatchup, rangeKey, comboCardsFor, cardsToKey, sideToRangeKeys,
  comboCount, combosFromKeys, actionColor, CAT_NAME,
} from './solverEngine.js';
import { cardToId, evaluate7 } from './pokerEngine.js';

// ── helpers ──────────────────────────────────────────────
const card = (s) => ({ v: s[0], s: s[1] });
const board = (...cs) => cs.map(card);
const sizes = (...pcts) => pcts.map((p) => ({ id: 'b' + p, pct: p, on: true }));
const spotOf = (over = {}) => ({ pot: 20, stack: 80, betSizes: sizes(33, 75, 125), allIn: true, ...over });

const DRY = board('Ks', '7d', '2c', '8h', '3s');
const LOW = board('2h', '7d', '9c', '4s', '8d');
const ROYAL = board('As', 'Ks', 'Qs', 'Js', 'Ts');

// shared solves (deterministic, reused across tests)
const MAIN = solve(DRY, ['AA', 'KK', 'QQ'], ['JJ', 'TT', '99'], spotOf(), { iterations: 256 });
const NUTS = solve(board('Qh', 'Jh', 'Th', '2c', '3d'), ['AKs'], ['54o'], spotOf(),
  { iterations: 512, oopRestrict: new Set(['AhKh']), ipRestrict: new Set(['5s4c']) });

describe('solve — zero-sum and equilibrium invariants', () => {
  it('OOP and IP EVs sum to the pot', () => {
    expect(MAIN.meta.evOOP + MAIN.meta.evIP).toBeCloseTo(20, 6);
    expect(MAIN.oopCount).toBe(15); // Ks kills 3 KK combos
    expect(MAIN.ipCount).toBe(18);
  });

  it('exploitability and every trace point are non-negative', () => {
    expect(MAIN.meta.exploitPctPot).toBeGreaterThanOrEqual(0);
    expect(MAIN.trace.length).toBe(32);
    for (const e of MAIN.trace) expect(e).toBeGreaterThanOrEqual(0);
  });

  it('final trace point equals meta.exploitPctPot exactly', () => {
    expect(MAIN.trace[MAIN.trace.length - 1]).toBe(MAIN.meta.exploitPctPot);
  });

  it('exploitability shrinks with iterations and converges below 1% pot', () => {
    const r = solve(DRY, ['AA', 'KK', 'QQ'], ['JJ', 'TT', '99'],
      spotOf({ betSizes: sizes(75), allIn: false }), { iterations: 512 });
    expect(r.trace[r.trace.length - 1]).toBeLessThan(r.trace[0]);
    expect(r.meta.exploitPctPot).toBeLessThan(1);
  });

  it('back-to-back solves are byte-identical', () => {
    const args = [LOW, ['AA', 'KK'], ['QQ', 'JJ'], spotOf(), { iterations: 64 }];
    const a = solve(...args), b = solve(...args);
    expect(b.meta.evOOP).toBe(a.meta.evOOP);
    expect(b.meta.exploitPctPot).toBe(a.meta.exploitPctPot);
    expect(JSON.stringify(b.nodeSolves)).toBe(JSON.stringify(a.nodeSolves));
  });

  it('every combo\'s weights sum to 1 at every node', () => {
    let maxDev = 0;
    for (const id in MAIN.nodeSolves) {
      for (const cm of MAIN.nodeSolves[id].combos) {
        const s = Object.values(cm.weights).reduce((x, y) => x + y, 0);
        maxDev = Math.max(maxDev, Math.abs(s - 1));
      }
    }
    expect(maxDev).toBeLessThan(1e-9);
  });

  it('best response weakly dominates the average strategy', () => {
    // pot 20 / stack 15 / single 75% size → the only bet is all-in and there
    // are no raises, so the four display nodes are the entire tree and EV/BR
    // can be recomputed from nodeSolves alone.
    const r = solve(LOW, ['AA', 'KK'], ['QQ', 'JJ'],
      spotOf({ stack: 15, betSizes: sizes(75), allIn: false }), { iterations: 200 });
    const bIds = LOW.map(cardToId);
    const view = (rootId, vsBetId) => {
      const vs = new Map(r.nodeSolves[vsBetId].combos.map((cm) => [cm.id, cm.weights]));
      return r.nodeSolves[rootId].combos.map((cm) => {
        const ids = cm.cards.map(cardToId);
        return { ids, score: evaluate7(ids[0], ids[1], ...bIds), open: cm.weights, vsBet: vs.get(cm.id) };
      });
    };
    const oop = view('oop_first', 'oop_vs_bet'), ip = view('ip_vs_check', 'ip_vs_bet');
    const live = (x, y) => !x.ids.some((id) => y.ids.includes(id));
    // payoffs vs the initial stacks: check-check sd(20,0); folding 0;
    // winning villain's fold +20; any call/called bet sd(50,15)
    const sd = (me, opp, pot, inv) => (me.score > opp.score ? pot - inv : me.score === opp.score ? pot / 2 - inv : -inv);

    let Z = 0;
    for (const i of oop) for (const j of ip) if (live(i, j)) Z++;
    let evO = 0, evI = 0, brO = 0, brI = 0;
    for (const i of oop) {
      let betV = 0, checkSd = 0, checkCallV = 0;
      for (const j of ip) {
        if (!live(i, j)) continue;
        betV += j.vsBet.fold * 20 + j.vsBet.call * sd(i, j, 50, 15);
        checkSd += j.open.check * sd(i, j, 20, 0);
        checkCallV += j.open.b75 * sd(i, j, 50, 15);
      }
      evO += i.open.check * (checkSd + i.vsBet.call * checkCallV) + i.open.b75 * betV;
      brO += Math.max(betV, checkSd + Math.max(0, checkCallV));
    }
    for (const j of ip) {
      let checkV = 0, betV = 0, vsBetCallV = 0;
      for (const i of oop) {
        if (!live(i, j)) continue;
        checkV += i.open.check * sd(j, i, 20, 0);
        betV += i.open.check * (i.vsBet.fold * 20 + i.vsBet.call * sd(j, i, 50, 15));
        vsBetCallV += i.open.b75 * sd(j, i, 50, 15);
      }
      evI += j.open.check * checkV + j.open.b75 * betV + j.vsBet.call * vsBetCallV;
      brI += Math.max(checkV, betV) + Math.max(0, vsBetCallV);
    }
    evO /= Z; evI /= Z; brO /= Z; brI /= Z;
    expect(Z).toBe(144);
    expect(evO).toBeCloseTo(r.meta.evOOP, 9);
    expect(evI).toBeCloseTo(r.meta.evIP, 9);
    expect(brO).toBeGreaterThanOrEqual(r.meta.evOOP - 1e-9);
    expect(brI).toBeGreaterThanOrEqual(r.meta.evIP - 1e-9);
    expect(Math.max(0, (brO - evO + brI - evI) / 2) / 20 * 100).toBeCloseTo(r.meta.exploitPctPot, 9);
  });
});

describe('solve — closed-form spots', () => {
  it('nuts vs air: the nuts capture the whole pot', () => {
    expect(Math.abs(NUTS.meta.evOOP - 20)).toBeLessThan(1);
    expect(Math.abs(NUTS.meta.evIP)).toBeLessThan(1);
    expect(NUTS.meta.exploitPctPot).toBeLessThan(1);
  });

  it('air facing the rep bet folds almost always', () => {
    const cm = NUTS.nodeSolves.ip_vs_bet.combos[0];
    expect(NUTS.nodeSolves.ip_vs_bet.count).toBe(1);
    expect(cm.weights.fold).toBeGreaterThan(0.95);
  });

  it('reversed: air first to act checks, the nuts never fold to a bet', () => {
    const r = solve(board('Qh', 'Jh', 'Th', '2c', '3d'), ['54o'], ['AKs'], spotOf(),
      { iterations: 512, oopRestrict: new Set(['5s4c']), ipRestrict: new Set(['AhKh']) });
    const air = r.nodeSolves.oop_first.combos[0];
    expect(air.weights.check).toBeGreaterThan(0.9);
    const nuts = r.nodeSolves.ip_vs_bet.combos[0];
    expect(nuts.weights.fold).toBeLessThan(0.01);
    expect(nuts.weights.call + nuts.weights.raise).toBeGreaterThan(0.99);
  });

  it('board plays: both sides get ~pot/2 on a betting tree', () => {
    // linear averaging keeps ~1e-4 weight on early-iteration folds, so the
    // betting tree is near-exact; the check-only tree below is exact
    const r = solve(ROYAL, ['22'], ['33'], spotOf(), { iterations: 512 });
    expect(r.meta.evOOP).toBeCloseTo(10, 3);
    expect(r.meta.evIP).toBeCloseTo(10, 3);
    expect(r.meta.evOOP + r.meta.evIP).toBeCloseTo(20, 6);
    expect(r.meta.exploitPctPot).toBeLessThan(0.01);
  });

  it('board plays: exactly pot/2 each on a check-only tree', () => {
    const r = solve(ROYAL, ['22'], ['33'],
      spotOf({ betSizes: [{ id: 'b75', pct: 75, on: false }], allIn: false }), { iterations: 64 });
    expect(r.meta.evOOP).toBeCloseTo(10, 9);
    expect(r.meta.evIP).toBeCloseTo(10, 9);
    expect(r.meta.exploitPctPot).toBe(0);
  });

  it('dominated showdown: the winner converges to the whole pot', () => {
    const r = solve(LOW, ['KK'], ['QQ'], spotOf(),
      { iterations: 512, oopRestrict: new Set(['KhKd']), ipRestrict: new Set(['QhQd']) });
    expect(r.meta.evOOP).toBeGreaterThan(19);
    expect(r.meta.evIP).toBeLessThan(1);
  });

  it('mirror ranges: AA vs AA splits the pot exactly (Z/showdown blocker consistency)', () => {
    const r = solve(LOW, ['AA'], ['AA'], spotOf({ betSizes: [], allIn: false }), { iterations: 32 });
    expect(r.oopCount).toBe(6);
    expect(r.ipCount).toBe(6);
    expect(r.meta.evOOP).toBeCloseTo(10, 9);
    expect(r.meta.evIP).toBeCloseTo(10, 9);
    expect(r.meta.exploitPctPot).toBe(0);
  });
});

describe('solve — card removal and the empty path', () => {
  it('returns {empty:true} when every cross-range pair shares a card', () => {
    const r = solve(board('2h', '7d', '9c', '4c', '8d'), ['AKs'], ['AQo'], spotOf(),
      { iterations: 8, oopRestrict: new Set(['AsKs']), ipRestrict: new Set(['AsQd']) });
    expect(r).toEqual({ empty: true, oopCount: 1, ipCount: 1 });
  });

  it('returns {empty:true} when the restricted combo is dead on the board', () => {
    const r = solve(DRY, ['KQs'], ['22'], spotOf(), { iterations: 8, oopRestrict: new Set(['KsQs']) });
    expect(r).toEqual({ empty: true, oopCount: 0, ipCount: 3 });
  });

  it('board cards remove conflicting combos from the range', () => {
    const ace = solve(board('As', '7d', '2c', '8h', '3s'), ['AA'], ['KK'], spotOf(), { iterations: 8 });
    expect(ace.oopCount).toBe(3);
    const clean = solve(LOW, ['AA'], ['KK'], spotOf(), { iterations: 8 });
    expect(clean.oopCount).toBe(6);
  });

  it('restrict ids match in either card order', () => {
    const r = solve(board('Qd', '7d', '2c', '8h', '3s'), ['AKs'], ['22'], spotOf(),
      { iterations: 8, oopRestrict: new Set(['KsAs']) });
    expect(r.oopCount).toBe(1);
    expect(r.nodeSolves.oop_first.combos).toHaveLength(1);
    expect(r.nodeSolves.oop_first.combos[0].id).toBe('AsKs');
  });
});

describe('buildTree — action sets observed through solve()', () => {
  it('clamps bet sizes to the stack and dedups equal amounts', () => {
    const r = solve(LOW, ['AA'], ['KK'], spotOf({ pot: 100, stack: 30 }), { iterations: 8 });
    const root = r.nodes.find((n) => n.id === 'oop_first');
    // all three sizes clamp to 30 and the all-in dedups away; the survivor
    // keeps the b33 id/label even though it is economically an all-in
    expect(root.actions).toEqual([
      { id: 'check', kind: 'check', label: 'Check' },
      { id: 'b33', kind: 'bet', sizePct: 33, label: 'Bet 33%' },
    ]);
  });

  it('drops zero-chip bets and the rep facing nodes with them', () => {
    const r = solve(LOW, ['AA'], ['KK'], spotOf({ pot: 1, stack: 10, betSizes: sizes(33), allIn: false }), { iterations: 8 });
    expect(r.nodes.map((n) => n.id)).toEqual(['oop_first', 'ip_vs_check']);
    for (const n of r.nodes) expect(n.actions.map((a) => a.id)).toEqual(['check']);
    expect(Object.keys(r.nodeSolves).sort()).toEqual(['ip_vs_check', 'oop_first']);
    expect(r.meta.evOOP + r.meta.evIP).toBeCloseTo(1, 6);
  });

  it('appends a distinct all-in action on deep stacks', () => {
    const root = MAIN.nodes.find((n) => n.id === 'oop_first');
    expect(root.actions.map((a) => a.id)).toEqual(['check', 'b33', 'b75', 'b125', 'allin']);
    expect(root.actions[4]).toEqual({ id: 'allin', kind: 'bet', sizePct: 999, label: 'All-in' });
  });

  it('rep node picks the size nearest 75%, first on ties', () => {
    const a = solve(LOW, ['AA'], ['KK'], spotOf({ betSizes: sizes(33, 125), allIn: false }), { iterations: 8 });
    expect(a.meta.repBetPct).toBe(33);
    expect(a.nodes.find((n) => n.id === 'ip_vs_bet').label).toBe('IP — facing OOP bet 33%');
    const b = solve(LOW, ['AA'], ['KK'], spotOf({ betSizes: sizes(50, 100), allIn: false }), { iterations: 8 });
    expect(b.meta.repBetPct).toBe(50);
  });

  it('suppresses the raise when the bet is already all-in', () => {
    const shortS = solve(LOW, ['AA'], ['KK'], spotOf({ stack: 15, betSizes: sizes(75), allIn: false }), { iterations: 8 });
    expect(shortS.nodes.find((n) => n.id === 'ip_vs_bet').actions.map((a) => a.id)).toEqual(['fold', 'call']);
    const deep = MAIN.nodes.find((n) => n.id === 'ip_vs_bet');
    expect(deep.actions.map((a) => a.id)).toEqual(['fold', 'call', 'raise']);
    expect(deep.actions[2]).toEqual({ id: 'raise', kind: 'raise', label: 'Raise' });
  });

  // depth-1/2 raise nodes are not display nodes and buildTree is not exported
  it.skip('caps raise depth at all-in then fold/call only', () => {});

  it('stack 0 yields a check-only tree', () => {
    const r = solve(LOW, ['AA'], ['KK'], spotOf({ stack: 0, betSizes: sizes(75), allIn: false }), { iterations: 8 });
    expect(r.nodes.find((n) => n.id === 'oop_first').actions.map((a) => a.id)).toEqual(['check']);
  });
});

describe('buildNodeSolve — UI contract', () => {
  it('weights keys match the node action ids at every display node', () => {
    for (const n of MAIN.nodes) {
      const aids = n.actions.map((a) => a.id).sort();
      for (const cm of MAIN.nodeSolves[n.id].combos) {
        expect(Object.keys(cm.weights).sort()).toEqual(aids);
      }
    }
  });

  it('nodeSolves carries exactly one entry per display node', () => {
    expect(Object.keys(MAIN.nodeSolves).sort()).toEqual(MAIN.nodes.map((n) => n.id).sort());
    expect(MAIN.nodes.map((n) => n.id)).toEqual(['oop_first', 'ip_vs_check', 'ip_vs_bet', 'oop_vs_bet']);
  });

  it('byKey aggregates the mean of member combos and the dominant action', () => {
    const r = solve(LOW, ['KK'], ['QQ'], spotOf({ betSizes: sizes(75) }), { iterations: 64 });
    const g = r.nodeSolves.oop_first.byKey['KK'];
    expect(g.count).toBe(6);
    expect(g.combos).toHaveLength(6);
    const aids = Object.keys(g.agg);
    for (const aid of aids) {
      const mean = g.combos.reduce((s, cm) => s + cm.weights[aid], 0) / g.combos.length;
      expect(g.agg[aid]).toBeCloseTo(mean, 12);
    }
    expect(g.dominant).toBe(aids.reduce((a, b) => (g.agg[a] >= g.agg[b] ? a : b)));
  });

  it('group combos sort by category descending', () => {
    // A2s on a 3-heart board: Ah2h flushes, the other three play high card
    const r = solve(board('Kh', '7h', '4h', '8c', '3d'), ['A2s'], ['QQ'],
      spotOf({ betSizes: sizes(75), allIn: false }), { iterations: 16 });
    const g = r.nodeSolves.oop_first.byKey['A2s'];
    expect(g.combos).toHaveLength(4);
    expect(g.combos[0].id).toBe('Ah2h');
    expect(CAT_NAME[g.combos[0].cat]).toBe('Flush');
    for (let k = 1; k < g.combos.length; k++) expect(g.combos[k - 1].cat).toBeGreaterThanOrEqual(g.combos[k].cat);
  });

  it('strength percentile spans 0..1 over distinct scores', () => {
    const r = solve(LOW, ['AA', 'KK', 'QQ'], ['JJ'], spotOf({ betSizes: sizes(75), allIn: false }),
      { iterations: 16, oopRestrict: new Set(['AsAh', 'KsKh', 'QsQh']) });
    const str = Object.fromEntries(r.nodeSolves.oop_first.combos.map((cm) => [cm.id, cm.str]));
    expect(str).toEqual({ AsAh: 1, KsKh: 0.5, QsQh: 0 });
  });

  it('a hand restrict collapses the side to its single combo', () => {
    const ns = NUTS.nodeSolves.oop_first;
    expect(ns.count).toBe(1);
    const cm = ns.combos[0];
    expect(cm.id).toBe('AhKh');
    expect(cm.hkey).toBe('AKs');
    expect(cm.cards).toEqual([card('Ah'), card('Kh')]);
    expect(CAT_NAME[cm.cat]).toBe('Straight flush');
    expect(cm.str).toBe(0.5); // single live combo
  });
});

describe('equityMatchup — exact full-board path', () => {
  const FULL = board('2c', '7d', '9h', '4s', '8c');
  const hand = (a, b) => ({ kind: 'hand', cards: [card(a), card(b)] });

  it('hand vs hand, hero always wins', () => {
    const q = equityMatchup(hand('As', 'Ah'), hand('Ks', 'Kh'), FULL);
    expect(q.hero.equity).toBe(100);
    expect(q.hero.win).toBe(100);
    expect(q.villain.equity).toBe(0);
    expect(q.method).toBe('exact');
    expect(q.samples).toBe(1);
    expect(q.heroCount).toBe(1);
    expect(q.villCount).toBe(1);
  });

  it('board-plays chop is 100% tie, 50% equity', () => {
    const q = equityMatchup(hand('2c', '2d'), hand('3c', '3d'), ROYAL);
    expect(q.hero.tie).toBe(100);
    expect(q.hero.equity).toBe(50);
    expect(q.villain.equity).toBe(50);
  });

  it('hero blockers thin a villain range to the live combos', () => {
    const q = equityMatchup(hand('Ah', 'Ad'), { kind: 'range', keys: ['AA'] }, FULL);
    expect(q.villCount).toBe(6);
    expect(q.heroCount).toBe(1);
    expect(q.samples).toBe(1); // only AsAc survives the Ah/Ad blockers
    expect(q.hero.tie).toBe(100);
  });

  it('hero dead on the board returns the null shape', () => {
    const q = equityMatchup(hand('2c', 'Ah'), hand('Ks', 'Kh'), FULL);
    expect(q).toEqual({ hero: null, villain: null, heroCount: 0, villCount: 1, method: 'exact', samples: 0 });
  });

  it('card-blocked single pair returns the null shape', () => {
    const q = equityMatchup(hand('As', 'Ks'), hand('As', 'Qd'), FULL);
    expect(q.hero).toBeNull();
    expect(q.villain).toBeNull();
  });

  it('falls back to capped sampling beyond 200k pairs', () => {
    const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
    const offs = [];
    for (let i = 0; i < 13; i++) for (let j = i + 1; j < 13; j++) offs.push(RANKS[i] + RANKS[j] + 'o');
    const q = equityMatchup({ kind: 'range', keys: offs }, { kind: 'range', keys: offs }, FULL);
    expect(q.heroCount).toBe(q.villCount);
    expect(q.heroCount * q.villCount).toBeGreaterThan(200000);
    expect(q.samples).toBeLessThanOrEqual(200000);
    expect(q.samples).toBeGreaterThan(150000);
    expect(Math.abs(q.hero.equity - 50)).toBeLessThan(1); // identical ranges
    expect(q.method).toBe('exact'); // misleading: this path samples, see plan
  });
});

describe('equityMatchup — Monte Carlo partial-board path', () => {
  const hand = (a, b) => ({ kind: 'hand', cards: [card(a), card(b)] });

  it('preflop AA vs KK lands near 82%', () => {
    const q = equityMatchup({ kind: 'range', keys: ['AA'] }, { kind: 'range', keys: ['KK'] }, []);
    expect(q.method).toBe('simulated');
    expect(q.samples).toBe(20000); // no cross-range blockers, every trial valid
    expect(Math.abs(q.hero.equity - 81.9)).toBeLessThanOrEqual(2);
  });

  it('is deterministic (fixed seed)', () => {
    const a = equityMatchup(hand('As', 'Ah'), hand('Kh', 'Qs'), board('Ad', '7c', '2h'));
    const b = equityMatchup(hand('As', 'Ah'), hand('Kh', 'Qs'), board('Ad', '7c', '2h'));
    expect(b).toEqual(a);
  });

  it('flop set vs overcards: hero is a huge favorite and shares sum to 100', () => {
    const q = equityMatchup(hand('As', 'Ah'), hand('Kh', 'Qs'), board('Ad', '7c', '2h'));
    expect(q.hero.equity).toBeGreaterThan(90);
    expect(q.hero.win + q.hero.tie + q.villain.win).toBeCloseTo(100, 9);
  });

  it('null board slots route to the simulated path', () => {
    const turn = equityMatchup(hand('As', 'Ah'), hand('Kh', 'Qs'), [card('Ad'), card('7c'), card('2h'), card('9d'), null]);
    expect(turn.method).toBe('simulated');
    expect(turn.samples).toBeGreaterThan(0);
    const flop = equityMatchup(hand('As', 'Ah'), hand('Kh', 'Qs'), [card('Ad'), card('7c'), card('2h'), null, null]);
    expect(flop.method).toBe('simulated');
    expect(flop.samples).toBeGreaterThan(0);
  });
});

describe('solve — trace, progress, meta plumbing', () => {
  const ONE = spotOf({ betSizes: sizes(75), allIn: false });

  it('traceEvery arithmetic: 10 iters → 10 points, 320 → 32', () => {
    expect(solve(LOW, ['AA'], ['KK'], ONE, { iterations: 10 }).trace).toHaveLength(10);
    expect(solve(LOW, ['AA'], ['KK'], ONE, { iterations: 320 }).trace).toHaveLength(32);
  });

  it('onProgress reports increasing iters with exact pct and a final full tick', () => {
    const calls = [];
    solve(LOW, ['AA'], ['KK'], ONE, { iterations: 10 }, (p) => calls.push(p));
    expect(calls).toHaveLength(10);
    calls.forEach((p, k) => {
      expect(p.iter).toBe(k + 1);
      expect(p.total).toBe(10);
      expect(p.pct).toBe(p.iter / 10);
      expect(p.exploit).toBeGreaterThanOrEqual(0);
    });
    expect(calls[calls.length - 1].pct).toBe(1);
  });

  it('meta echoes the spot configuration', () => {
    expect(MAIN.meta.potBb).toBe(20);
    expect(MAIN.meta.iterations).toBe(256);
    expect(MAIN.meta.sizeCount).toBe(4); // 3 on sizes + all-in
    expect(MAIN.meta.repBetPct).toBe(75);
  });

  it('pot 0 keeps exploitability finite', () => {
    const r = solve(LOW, ['AA'], ['KK'], spotOf({ pot: 0, betSizes: sizes(75), allIn: false }), { iterations: 8 });
    expect(Number.isFinite(r.meta.exploitPctPot)).toBe(true);
  });
});

describe('pure helpers', () => {
  it('rangeKey maps grid coordinates to notation', () => {
    expect(rangeKey(0, 0)).toBe('AA');
    expect(rangeKey(0, 1)).toBe('AKs');
    expect(rangeKey(1, 0)).toBe('AKo');
  });

  it('comboCardsFor expands pairs/suited/offsuit without duplicates', () => {
    const cid = (c) => c.v + c.s;
    const aa = comboCardsFor('AA');
    expect(aa).toHaveLength(6);
    expect(new Set(aa.map((cc) => cc.map(cid).sort().join(''))).size).toBe(6);
    for (const [a, b] of aa) expect(cid(a)).not.toBe(cid(b));
    const aks = comboCardsFor('AKs');
    expect(aks).toHaveLength(4);
    for (const [a, b] of aks) expect(a.s).toBe(b.s);
    const ako = comboCardsFor('AKo');
    expect(ako).toHaveLength(12);
    for (const [a, b] of ako) expect(a.s).not.toBe(b.s);
  });

  it('cardsToKey is order-insensitive and suit-aware', () => {
    expect(cardsToKey(card('Kh'), card('Ah'))).toBe('AKs');
    expect(cardsToKey(card('Ah'), card('Kd'))).toBe('AKo');
    expect(cardsToKey(card('Qs'), card('Qd'))).toBe('QQ');
    expect(cardsToKey(card('Qs'), null)).toBeNull();
    expect(cardsToKey(null, card('Qs'))).toBeNull();
  });

  it('sideToRangeKeys handles hand/range/null sides', () => {
    expect(sideToRangeKeys({ kind: 'hand', cards: [card('Ah')] })).toEqual([]);
    expect(sideToRangeKeys({ kind: 'hand' })).toEqual([]);
    expect(sideToRangeKeys({ kind: 'hand', cards: [card('Ah'), card('Kh')] })).toEqual(['AKs']);
    expect(sideToRangeKeys({ kind: 'range', keys: ['AA', 'KQs'] })).toEqual(['AA', 'KQs']);
    expect(sideToRangeKeys(null)).toEqual([]);
  });

  it('comboCount / combosFromKeys', () => {
    expect(comboCount('AA')).toBe(6);
    expect(comboCount('AKs')).toBe(4);
    expect(comboCount('AKo')).toBe(12);
    expect(combosFromKeys(['AA', 'AKs', 'AKo'])).toBe(22);
    expect(combosFromKeys(null)).toBe(0);
  });

  it('actionColor thresholds and fixed kind colors', () => {
    expect(actionColor({ kind: 'check' })).toBe('#57b98c');
    expect(actionColor({ kind: 'call' })).toBe('#3f9e96');
    expect(actionColor({ kind: 'fold' })).toBe('#6b9cdf');
    expect(actionColor({ kind: 'raise' })).toBe('#b3322b');
    expect(actionColor({ kind: 'bet', sizePct: 999 })).toBe('#7c1d18');
    expect(actionColor({ kind: 'bet', sizePct: 40 })).toBe('#e69a8f');
    expect(actionColor({ kind: 'bet', sizePct: 80 })).toBe('#d8463e');
    expect(actionColor({ kind: 'bet', sizePct: 150 })).toBe('#bb352c');
    expect(actionColor({ kind: 'bet', sizePct: 151 })).toBe('#9a2922');
  });
});
