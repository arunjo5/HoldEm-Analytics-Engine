import { describe, it, expect } from 'vitest';
import { calculate } from './pokerEngine.js';

const card = (s) => ({ v: s[0], s: s[1] });
const hand = (a, b) => ({ kind: 'hand', hand: [card(a), card(b)] });

describe('calculate() equity', () => {
  it('makes AA a ~80% favorite over KK preflop', () => {
    const r = calculate([hand('As', 'Ad'), hand('Ks', 'Kd')], [], { sims: 40000 });
    expect(r.perPlayer[0].equity).toBeGreaterThan(78);
    expect(r.perPlayer[0].equity).toBeLessThan(86);
    expect(r.perPlayer[0].equity + r.perPlayer[1].equity).toBeGreaterThan(99);
    expect(r.perPlayer[0].equity + r.perPlayer[1].equity).toBeLessThan(101);
  });

  it('makes AKs vs 22 roughly a coin flip preflop', () => {
    const r = calculate([hand('As', 'Ks'), hand('2c', '2d')], [], { sims: 40000 });
    expect(r.perPlayer[0].equity).toBeGreaterThan(42);
    expect(r.perPlayer[0].equity).toBeLessThan(54);
  });

  it('resolves a completed board deterministically (flush beats trips)', () => {
    const board = [card('Ah'), card('7h'), card('2h'), card('Td'), card('3c')];
    const r = calculate([hand('Kh', 'Qh'), hand('Ac', 'As')], board, { sims: 2000 });
    expect(r.perPlayer[0].equity).toBeGreaterThan(99);
  });

  // royal flush on board: every player plays the board, guaranteed chop
  const royalBoard = [card('As'), card('Ks'), card('Qs'), card('Js'), card('Ts')];

  it('splits a 2-way chop 50/50', () => {
    const r = calculate([hand('2h', '3h'), hand('4d', '5d')], royalBoard, { sims: 2000 });
    expect(r.perPlayer[0].equity).toBeCloseTo(50, 5);
    expect(r.perPlayer[1].equity).toBeCloseTo(50, 5);
    expect(r.perPlayer[0].tie).toBeCloseTo(100, 5);
    expect(r.perPlayer[0].equity + r.perPlayer[1].equity).toBeCloseTo(100, 5);
  });

  it('splits a 3-way chop into thirds summing to 100', () => {
    const r = calculate([hand('2h', '3h'), hand('4d', '5d'), hand('6c', '7c')], royalBoard, { sims: 2000 });
    let sum = 0;
    for (const idx of [0, 1, 2]) {
      expect(r.perPlayer[idx].equity).toBeCloseTo(100 / 3, 4);
      expect(r.perPlayer[idx].tie).toBeCloseTo(100, 5);
      sum += r.perPlayer[idx].equity;
    }
    expect(sum).toBeCloseTo(100, 4);
  });

  it('splits a 4-way chop into quarters summing to 100', () => {
    const r = calculate(
      [hand('2h', '3h'), hand('4d', '5d'), hand('6c', '7c'), hand('8h', '9h')],
      royalBoard,
      { sims: 2000 }
    );
    let sum = 0;
    for (const idx of [0, 1, 2, 3]) {
      expect(r.perPlayer[idx].equity).toBeCloseTo(25, 4);
      sum += r.perPlayer[idx].equity;
    }
    expect(sum).toBeCloseTo(100, 4);
  });
});
