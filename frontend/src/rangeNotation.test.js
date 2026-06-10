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

  it('expands offsuit-plus (ATo+) without any suited keys', () => {
    expect(expand('ATo+').sort()).toEqual(['AJo', 'AKo', 'AQo', 'ATo']);
  });

  it('stops K9s+ below the high card (no AKs/KAs)', () => {
    const keys = expand('K9s+');
    expect(keys.sort()).toEqual(['K9s', 'KJs', 'KQs', 'KTs']);
    expect(keys).not.toContain('AKs');
    expect(keys).not.toContain('KAs');
  });

  it('expands a pair dash range (55-99)', () => {
    expect(expand('55-99').sort()).toEqual(['55', '66', '77', '88', '99']);
  });

  it('treats reversed dash bounds the same', () => {
    expect(expand('99-55').sort()).toEqual(expand('55-99').sort());
    expect(expand('A5s-A4s').sort()).toEqual(expand('A4s-A5s').sort());
  });

  it('expands AA+ to just AA', () => {
    expect(expand('AA+')).toEqual(['AA']);
  });

  it('expands 22+ to all 13 pairs', () => {
    const keys = expand('22+');
    expect(keys).toHaveLength(13);
    expect(keys).toContain('22');
    expect(keys).toContain('AA');
  });

  it('returns [] for empty and blank-token input', () => {
    expect(expand('')).toEqual([]);
    expect(expand(' , ,')).toEqual([]);
  });

  it('tolerates spaces around the dash', () => {
    expect(expand('55 - 99').sort()).toEqual(expand('55-99').sort());
  });

  it('dedupes repeated tokens', () => {
    const keys = expand('AA, AA, KK+');
    expect(keys.filter((k) => k === 'AA')).toHaveLength(1);
    expect(keys.sort()).toEqual(['AA', 'KK']);
  });
});

describe('expandNotation malformed tokens', () => {
  it('passes a suitless non-pair through as garbage (documented quirk)', () => {
    // 'AK' has no suit char, so the missing third char concatenates as undefined
    expect(expand('AK')).toEqual(['AKundefined']);
  });
});
