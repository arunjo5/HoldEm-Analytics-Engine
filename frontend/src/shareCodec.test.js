import { describe, it, expect } from 'vitest';
import { packV2, unpackV2, rangeToMask, maskToRange } from './shareCodec.js';
import { rangeKey } from './Pickers.jsx';

const roundTrip = (keys) => maskToRange(rangeToMask(keys));

describe('rangeToMask/maskToRange bitmask', () => {
  it('round-trips the first bit (AA, index 0)', () => {
    expect(roundTrip(['AA'])).toEqual(['AA']);
  });

  it('round-trips the last bit (22, index 168)', () => {
    expect(roundTrip(['22'])).toEqual(['22']);
  });

  it('keeps top-row boundary cells on their side of the diagonal', () => {
    expect(roundTrip(['A2s'])).toEqual(['A2s']);
    expect(roundTrip(['A2o'])).toEqual(['A2o']);
  });

  it('keeps bottom-corner boundary cells distinct', () => {
    expect(roundTrip(['32s'])).toEqual(['32s']);
    expect(roundTrip(['32o'])).toEqual(['32o']);
  });

  it('round-trips every one of the 169 grid cells (locks cellKey to Pickers.rangeKey)', () => {
    for (let r = 0; r < 13; r++) {
      for (let c = 0; c < 13; c++) {
        const k = rangeKey(r, c);
        expect(roundTrip([k])).toEqual([k]);
      }
    }
  });

  it('round-trips a 168-of-169 range with no neighboring-bit bleed', () => {
    const keys = [];
    for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) keys.push(rangeKey(r, c));
    const without22 = keys.filter((k) => k !== '22');
    const out = roundTrip(without22);
    expect([...out].sort()).toEqual([...without22].sort());
    expect(out).not.toContain('22');
  });

  it('silently drops invalid keys instead of throwing', () => {
    expect(() => rangeToMask(['ZZ', 'A2s'])).not.toThrow();
    expect(roundTrip(['ZZ', 'A2s'])).toEqual(['A2s']);
  });

  it('emits only URL-safe characters', () => {
    const all = [];
    for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) all.push(rangeKey(r, c));
    for (const range of [all, ['AA'], ['22'], ['A2o'], []]) {
      expect(rangeToMask(range)).toMatch(/^[A-Za-z0-9_-]*$/);
    }
  });
});

describe('malformed range-key hardening', () => {
  it('pins the quirk: non-pair 2-char key takes the pair branch and becomes AA', () => {
    expect(roundTrip(['AK'])).toEqual(['AA']);
  });

  it('pins the quirk: unknown third char maps via the offsuit branch', () => {
    expect(roundTrip(['A2x'])).toEqual(['A2o']);
  });

  it('maskToRange of an empty mask is an empty range', () => {
    expect(maskToRange('')).toEqual([]);
  });

  it('maskToRange tolerates a mask shorter than 22 bytes', () => {
    expect(() => maskToRange('AQ')).not.toThrow();
    expect(maskToRange('AQ')).toEqual(['AA']); // 1 byte, bit 0 set
  });
});

describe('packV2/unpackV2 envelope', () => {
  it('round-trips an object behind the ~ sigil', () => {
    const obj = { p: [[0, 1]], b: [2], n: ['x'] };
    const s = packV2(obj);
    expect(s[0]).toBe('~');
    expect(unpackV2(s)).toEqual(obj);
  });

  it('returns undefined for non-v2 strings and null for bad payloads', () => {
    expect(unpackV2('eyJhIjoxfQ')).toBeUndefined();
    expect(unpackV2('')).toBeUndefined();
    expect(unpackV2(null)).toBeUndefined();
    expect(unpackV2('~')).toBeNull();
    expect(unpackV2('~!!!garbage!!!')).toBeNull();
  });
});
