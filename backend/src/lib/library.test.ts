import { describe, it, expect } from 'vitest'

import {
  MAX_NAME,
  RANGE_KEYS,
  normalizeName,
  normalizeRangeKeys,
  validSolveConfig,
  validSummary,
} from '@/lib/library'

const RANKS = 'AKQJT98765432'
const ALL_KEYS = Array.from(RANGE_KEYS)
const ZW = String.fromCharCode(0x200b)

const card = (v: string, s: string) => ({ v, s })

// a config that passes every check; each test bends exactly one field
const config = (patch: Record<string, unknown> = {}) => ({
  board: [card('A', 's'), card('K', 'h'), card('2', 'd')],
  oopSide: { kind: 'range', keys: ['AA', 'AKs'] },
  ipSide: { kind: 'hand', cards: [card('Q', 'c'), card('J', 'd')] },
  spot: { pot: 10, stack: 100, allIn: false, betSizes: [{ id: 'b1', pct: 33, on: true }] },
  ...patch,
})

const spot = (patch: Record<string, unknown>) =>
  config({ spot: { pot: 10, stack: 100, allIn: false, betSizes: [{ id: 'b1', pct: 33, on: true }], ...patch } })

const bet = (patch: Record<string, unknown>) => spot({ betSizes: [{ id: 'b1', pct: 33, on: true, ...patch }] })

describe('RANGE_KEYS', () => {
  it('holds all 169 hand classes', () => {
    expect(RANGE_KEYS.size).toBe(169)
  })

  it('splits into 13 pairs, 78 suited and 78 offsuit', () => {
    expect(ALL_KEYS.filter((k) => k.length === 2)).toHaveLength(13)
    expect(ALL_KEYS.filter((k) => k.endsWith('s'))).toHaveLength(78)
    expect(ALL_KEYS.filter((k) => k.endsWith('o')).length).toBe(78)
  })

  it('names every pair', () => {
    for (const r of RANKS) expect(RANGE_KEYS.has(r + r)).toBe(true)
  })

  it('always puts the high rank first', () => {
    for (const k of ALL_KEYS.filter((x) => x.length === 3)) {
      expect(RANKS.indexOf(k[0])).toBeLessThan(RANKS.indexOf(k[1]))
    }
    expect(RANGE_KEYS.has('AKs')).toBe(true)
    expect(RANGE_KEYS.has('KAs')).toBe(false)
    expect(RANGE_KEYS.has('KAo')).toBe(false)
    expect(RANGE_KEYS.has('9To')).toBe(false)
  })

  it('rejects junk that looks close', () => {
    for (const k of ['', 'A', 'AKx', 'AKS', 'aks', 'AK', 'AAs', 'AAo', '1Ks', 'AKso']) {
      expect(RANGE_KEYS.has(k)).toBe(false)
    }
  })
})

describe('normalizeRangeKeys', () => {
  it('null for anything that is not an array', () => {
    for (const k of [undefined, null, 'AA', 42, {}, new Set(['AA'])]) expect(normalizeRangeKeys(k)).toBeNull()
  })

  it('null for an empty selection', () => {
    expect(normalizeRangeKeys([])).toBeNull()
  })

  it('takes the full 169 but not 170', () => {
    expect(normalizeRangeKeys(ALL_KEYS)).toHaveLength(169)
    // length is checked before contents, so padding with a valid key still fails
    expect(normalizeRangeKeys([...ALL_KEYS, 'AA'])).toBeNull()
    expect(normalizeRangeKeys(new Array(170).fill('AA'))).toBeNull()
  })

  it('null when any entry is not a string', () => {
    for (const bad of [42, null, undefined, {}, ['AA'], true]) {
      expect(normalizeRangeKeys(['AA', bad])).toBeNull()
    }
  })

  it('null when any entry is not a known key', () => {
    for (const bad of ['', 'XX', 'KAs', 'AKS', 'aa', 'AK']) expect(normalizeRangeKeys(['AA', bad])).toBeNull()
  })

  it('dedupes, keeping first-seen order', () => {
    expect(normalizeRangeKeys(['AKs', 'AA', 'AKs', 'T9o', 'AA'])).toEqual(['AKs', 'AA', 'T9o'])
  })

  it('passes a clean selection straight through', () => {
    expect(normalizeRangeKeys(['22'])).toEqual(['22'])
    expect(normalizeRangeKeys(['AA', 'KK', 'AKs', 'AKo'])).toEqual(['AA', 'KK', 'AKs', 'AKo'])
  })
})

describe('normalizeName', () => {
  it('null for anything that is not a string', () => {
    for (const n of [undefined, null, 42, {}, ['x'], true]) expect(normalizeName(n)).toBeNull()
  })

  it('takes 60 characters but not 61', () => {
    expect(MAX_NAME).toBe(60)
    expect(normalizeName('x'.repeat(60))).toBe('x'.repeat(60))
    expect(normalizeName('x'.repeat(61))).toBeNull()
    // the cap is measured before cleaning, so an invisible 61st character still fails
    expect(normalizeName('x'.repeat(60) + ZW)).toBeNull()
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeName('  Button open  ')).toBe('Button open')
    expect(normalizeName('\tBB defend\n')).toBe('BB defend')
  })

  it('strips zero-width and bidi control characters', () => {
    expect(normalizeName('BB' + ZW + ' defend')).toBe('BB defend')
    // nul, C1, arabic letter mark, LRM, RLO, word joiner, LRI, BOM
    const hidden = [0x00, 0x7f, 0x061c, 0x200e, 0x202e, 0x2060, 0x2066, 0xfeff]
    for (const c of hidden) expect(normalizeName('a' + String.fromCharCode(c) + 'b')).toBe('ab')
  })

  it('null once cleaning leaves nothing', () => {
    for (const n of ['', '   ', ZW, ZW + '  ' + ZW, String.fromCharCode(0xfeff)]) expect(normalizeName(n)).toBeNull()
  })

  it('keeps ordinary unicode and normalizes to NFC', () => {
    expect(normalizeName('Café ♠')).toBe('Café ♠')
    expect(normalizeName('Cafe' + String.fromCharCode(0x301))).toBe('Caf' + String.fromCharCode(0xe9))
  })
})

describe('validSolveConfig board', () => {
  it('accepts up to five slots, filled or empty', () => {
    expect(validSolveConfig(config({ board: [] }))).toBe(true)
    expect(validSolveConfig(config({ board: [null, null, null] }))).toBe(true)
    expect(validSolveConfig(config({ board: new Array(5).fill(card('A', 's')) }))).toBe(true)
  })

  it('rejects a sixth slot', () => {
    expect(validSolveConfig(config({ board: new Array(6).fill(null) }))).toBe(false)
  })

  it('rejects a board that is not an array', () => {
    for (const board of [undefined, null, 'AsKh', {}, 5]) expect(validSolveConfig(config({ board }))).toBe(false)
  })

  it('rejects a bad rank or suit', () => {
    for (const c of [card('1', 's'), card('a', 's'), card('A', 'x'), card('A', 'S'), card('', ''), { v: 'A' }, { s: 's' }]) {
      expect(validSolveConfig(config({ board: [c] }))).toBe(false)
    }
  })

  it('rejects a slot that is not a card object', () => {
    for (const c of ['As', 42, true, undefined]) expect(validSolveConfig(config({ board: [c] }))).toBe(false)
  })
})

describe('validSolveConfig sides', () => {
  it('accepts a range side', () => {
    expect(validSolveConfig(config({ oopSide: { kind: 'range', keys: ALL_KEYS } }))).toBe(true)
  })

  it('accepts a hand side', () => {
    expect(validSolveConfig(config({ ipSide: { kind: 'hand', cards: [card('A', 's'), card('A', 'h')] } }))).toBe(true)
  })

  it('rejects a missing or non-object side', () => {
    for (const side of [undefined, null, 'range', 42]) {
      expect(validSolveConfig(config({ oopSide: side }))).toBe(false)
      expect(validSolveConfig(config({ ipSide: side }))).toBe(false)
    }
  })

  it('rejects an unknown kind', () => {
    for (const kind of [undefined, null, 'hands', 'Range', 'weights']) {
      expect(validSolveConfig(config({ oopSide: { kind, keys: ['AA'] } }))).toBe(false)
    }
  })

  it('rejects a range side whose keys do not validate', () => {
    for (const keys of [undefined, [], ['XX'], 'AA', new Array(170).fill('AA')]) {
      expect(validSolveConfig(config({ oopSide: { kind: 'range', keys } }))).toBe(false)
    }
  })

  it('rejects a hand side that is not exactly two cards', () => {
    const c = card('A', 's')
    for (const cards of [undefined, [], [c], [c, c, c], 'AsKh', [c, 'Kh']]) {
      expect(validSolveConfig(config({ ipSide: { kind: 'hand', cards } }))).toBe(false)
    }
  })

  it('checks both sides, not just one', () => {
    expect(validSolveConfig(config({ oopSide: { kind: 'range', keys: [] } }))).toBe(false)
    expect(validSolveConfig(config({ ipSide: { kind: 'range', keys: [] } }))).toBe(false)
  })
})

describe('validSolveConfig spot', () => {
  it('rejects a missing or non-object spot', () => {
    for (const s of [undefined, null, 'spot', 42]) expect(validSolveConfig(config({ spot: s }))).toBe(false)
  })

  it('takes pot and stack across the whole 0..1e6 range', () => {
    for (const n of [0, 1, 1e6]) {
      expect(validSolveConfig(spot({ pot: n }))).toBe(true)
      expect(validSolveConfig(spot({ stack: n }))).toBe(true)
    }
  })

  it('rejects a pot outside the range or not a finite number', () => {
    for (const pot of [-1, 1e6 + 1, NaN, Infinity, -Infinity, '10', null, undefined, true]) {
      expect(validSolveConfig(spot({ pot }))).toBe(false)
    }
  })

  it('rejects a stack outside the range or not a finite number', () => {
    for (const stack of [-1, 1e6 + 1, NaN, Infinity, '100', null, undefined]) {
      expect(validSolveConfig(spot({ stack }))).toBe(false)
    }
  })

  it('rejects a non-boolean allIn', () => {
    for (const allIn of [undefined, null, 'true', 0, 1]) expect(validSolveConfig(spot({ allIn }))).toBe(false)
    expect(validSolveConfig(spot({ allIn: true }))).toBe(true)
  })
})

describe('validSolveConfig bet tree', () => {
  it('takes up to eight sizes, or none', () => {
    const b = { id: 'b', pct: 50, on: true }
    expect(validSolveConfig(spot({ betSizes: [] }))).toBe(true)
    expect(validSolveConfig(spot({ betSizes: new Array(8).fill(b) }))).toBe(true)
    expect(validSolveConfig(spot({ betSizes: new Array(9).fill(b) }))).toBe(false)
  })

  it('rejects betSizes that is not an array', () => {
    for (const betSizes of [undefined, null, {}, 'half']) expect(validSolveConfig(spot({ betSizes }))).toBe(false)
  })

  it('rejects a size that is not an object', () => {
    for (const b of [null, undefined, 'half', 50]) expect(validSolveConfig(spot({ betSizes: [b] }))).toBe(false)
  })

  it('caps the id at 12 characters and requires a string', () => {
    expect(validSolveConfig(bet({ id: 'x'.repeat(12) }))).toBe(true)
    expect(validSolveConfig(bet({ id: '' }))).toBe(true)
    expect(validSolveConfig(bet({ id: 'x'.repeat(13) }))).toBe(false)
    for (const id of [undefined, null, 42, {}]) expect(validSolveConfig(bet({ id }))).toBe(false)
  })

  it('holds pct inside 1..1000', () => {
    for (const pct of [1, 33, 1000]) expect(validSolveConfig(bet({ pct }))).toBe(true)
    for (const pct of [0, -1, 1001, NaN, Infinity, '33', null, undefined]) {
      expect(validSolveConfig(bet({ pct }))).toBe(false)
    }
  })

  it('rejects a non-boolean on', () => {
    for (const on of [undefined, null, 'yes', 1, 0]) expect(validSolveConfig(bet({ on }))).toBe(false)
    expect(validSolveConfig(bet({ on: false }))).toBe(true)
  })
})

describe('validSolveConfig shape', () => {
  it('accepts the whole config', () => {
    expect(validSolveConfig(config())).toBe(true)
  })

  it('rejects a config that is not an object', () => {
    for (const c of [undefined, null, 'config', 42, true]) expect(validSolveConfig(c)).toBe(false)
  })
})

describe('validSummary', () => {
  // JSON.stringify({ a: '' }) is 8 characters, so the value carries the rest
  const ofLength = (n: number) => ({ a: 'x'.repeat(n - 8) })

  it('rejects anything that is not a plain object', () => {
    for (const s of [undefined, null, 42, 'ev', true, [], ['ev']]) expect(validSummary(s)).toBe(false)
  })

  it('accepts an empty summary', () => {
    expect(validSummary({})).toBe(true)
  })

  it('accepts flat numbers and strings', () => {
    expect(validSummary({ ev: 1.5, oopEv: -0.25, line: 'bet 33', iters: 500 })).toBe(true)
  })

  it('rejects a nested object value', () => {
    expect(validSummary({ ev: 1, detail: { street: 'flop' } })).toBe(false)
  })

  it('rejects an array, boolean, null or undefined value', () => {
    for (const v of [[1, 2], true, false, null, undefined]) expect(validSummary({ ev: v })).toBe(false)
  })

  it('takes 1024 characters of JSON but not 1025', () => {
    expect(JSON.stringify(ofLength(1024))).toHaveLength(1024)
    expect(validSummary(ofLength(1024))).toBe(true)
    expect(JSON.stringify(ofLength(1025))).toHaveLength(1025)
    expect(validSummary(ofLength(1025))).toBe(false)
  })
})
