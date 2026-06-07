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
});
