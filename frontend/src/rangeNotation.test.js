import { describe, it, expect } from 'vitest';
import { expandNotation } from './Pickers.jsx';

const expand = (n) => [...expandNotation(n)];

describe('expandNotation', () => {
  it('expands a pair-plus (44+) to 44 and every higher pair', () => {
    const keys = expand('44+');
    expect(keys).toContain('44');
    expect(keys).toContain('TT');
    expect(keys).toContain('AA');
    expect(keys).not.toContain('33');
  });

  it('expands suited-plus (A2s+) to every suited ace', () => {
    const keys = expand('A2s+');
    expect(keys).toContain('A2s');
    expect(keys).toContain('AKs');
    expect(keys).not.toContain('A2o');
    expect(keys).not.toContain('AKo');
  });

  it('expands a bounded suited range (A4s-A5s)', () => {
    const keys = expand('A4s-A5s');
    expect(keys.sort()).toEqual(['A4s', 'A5s']);
  });

  it('unions multiple comma-separated tokens', () => {
    const keys = expand('AA, AKs, 72o');
    expect(keys).toContain('AA');
    expect(keys).toContain('AKs');
    expect(keys).toContain('72o');
  });

  it('expands an exact pair token', () => {
    expect(expand('QQ')).toEqual(['QQ']);
  });
});
