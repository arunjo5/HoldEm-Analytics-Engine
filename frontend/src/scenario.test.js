import { describe, it, expect, afterEach } from 'vitest';
import { compressToEncodedURIComponent } from 'lz-string';
import { encodeScenario, decodeScenario, buildShareUrl, readScenarioFromUrl } from './scenario.js';
import { packV2 } from './shareCodec.js';

const card = (s) => ({ v: s[0], s: s[1] });
const hand = (...cs) => ({ kind: 'hand', hand: cs.map(card) });

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const ALL_KEYS = (() => {
  const out = [];
  for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) {
    const a = RANKS[r], b = RANKS[c];
    out.push(r === c ? a + a : r < c ? a + b + 's' : b + a + 'o');
  }
  return out;
})();

const mulberry32 = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('scenario encode/decode round-trip', () => {
  it('preserves hands, board, pot and call', () => {
    const input = {
      players: [hand('As', 'Ah'), hand('Kd', 'Qc')],
      board: [card('2s'), card('7h'), card('Td')],
      playerNames: ['Hero', 'Villain'],
      pot: '100',
      callAmt: '25',
    };
    const out = decodeScenario(encodeScenario(input));
    expect(out.players[0]).toEqual(input.players[0]);
    expect(out.players[1]).toEqual(input.players[1]);
    expect(out.board).toEqual(input.board);
    expect(out.playerNames[0]).toBe('Hero');
    expect(out.playerNames[1]).toBe('Villain');
    expect(out.pot).toBe('100');
    expect(out.callAmt).toBe('25');
  });

  it('preserves range players', () => {
    const input = {
      players: [{ kind: 'range', range: ['AA', 'AKs', 'KK'] }, hand('7c', '7d')],
      board: [],
      playerNames: [null, null],
      pot: '',
      callAmt: '',
    };
    const out = decodeScenario(encodeScenario(input));
    expect(out.players[0]).toEqual({ kind: 'range', range: ['AA', 'AKs', 'KK'] });
    expect(out.players[1]).toEqual(hand('7c', '7d'));
  });

  it('pads players and names to 9 seats', () => {
    const out = decodeScenario(encodeScenario({
      players: [hand('As', 'Ah')],
      board: [],
      playerNames: ['Solo'],
      pot: '',
      callAmt: '',
    }));
    expect(out.players).toHaveLength(9);
    expect(out.playerNames).toHaveLength(9);
    expect(out.players.slice(1).every((p) => p === null)).toBe(true);
  });

  it('returns null on malformed input', () => {
    expect(decodeScenario('not valid !!!')).toBeNull();
    expect(decodeScenario('')).toBeNull();
  });

  it('handles an all-empty table', () => {
    const out = decodeScenario(encodeScenario({
      players: [], board: [], playerNames: [], pot: '', callAmt: '',
    }));
    expect(out.players.every((p) => p === null)).toBe(true);
    expect(out.board).toEqual([]);
  });

  it('still decodes legacy v1 links', () => {
    const V1 = 'eyJwIjpbWyJoIiwiQXNBaCJdLFsiciIsWyJLSyIsIlFRIl1dXSwiYiI6IjJzN2hUZCIsIm4iOlsiSGVybyIsIlZpbGxhaW4iXSwicG8iOiIxMjAiLCJjYSI6IjQwIn0';
    const out = decodeScenario(V1);
    expect(out.players[0]).toEqual(hand('As', 'Ah'));
    expect(out.players[1]).toEqual({ kind: 'range', range: ['KK', 'QQ'] });
    expect(out.board).toEqual([card('2s'), card('7h'), card('Td')]);
    expect(out.playerNames[0]).toBe('Hero');
    expect(out.pot).toBe('120');
    expect(out.callAmt).toBe('40');
  });

  it('encodes even the full 169-hand range compactly', () => {
    const R = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
    const all = [];
    for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) {
      const a = R[r], b = R[c];
      all.push(r === c ? a + a : r < c ? a + b + 's' : b + a + 'o');
    }
    const enc = encodeScenario({ players: [{ kind: 'range', range: all }], board: [], playerNames: [], pot: '', callAmt: '' });
    expect(enc.length).toBeLessThan(120);
    const out = decodeScenario(enc);
    expect(out.players[0].range.sort()).toEqual([...all].sort());
  });
});

describe('decodeScenario hostile input never throws', () => {
  const FULL = {
    players: [
      hand('As', 'Ah'),
      { kind: 'range', range: ALL_KEYS },
      null,
      { kind: 'range', range: ['AA', 'KK'] },
      null, null, null, null,
      hand('2c', '7d'),
    ],
    board: [card('2s'), card('7h'), card('Td'), card('Jc'), card('Qs')],
    playerNames: ['Pierré', '龍さん', '🃏joker🃏', null, 'Bob', null, null, null, 'x'],
    pot: '100',
    callAmt: '25',
  };

  it('decodes every truncation of a valid v2 string to null or a 9-seat scenario', () => {
    const enc = encodeScenario(FULL);
    for (let k = 1; k < enc.length; k++) {
      let out;
      expect(() => { out = decodeScenario(enc.slice(0, k)); }).not.toThrow();
      if (out !== null) {
        expect(out.players).toHaveLength(9);
      }
    }
  });

  it('returns null for a bare ~ sigil', () => {
    expect(decodeScenario('~')).toBeNull();
  });

  it('returns null for ~ followed by non-lz garbage', () => {
    expect(() => decodeScenario('~!!!not-lz!!!')).not.toThrow();
    expect(decodeScenario('~!!!not-lz!!!')).toBeNull();
  });

  it('returns null for a valid lz envelope wrapping invalid JSON', () => {
    const env = '~' + compressToEncodedURIComponent('{nope');
    expect(() => decodeScenario(env)).not.toThrow();
    expect(decodeScenario(env)).toBeNull();
  });

  it('pins non-object v2 payloads decoding to an empty 9-seat scenario', () => {
    for (const payload of ['just a string', 42]) {
      let out;
      expect(() => { out = decodeScenario(packV2(payload)); }).not.toThrow();
      expect(out.players).toHaveLength(9);
      expect(out.players.every((p) => p === null)).toBe(true);
      expect(out.board).toEqual([]);
      expect(out.pot).toBe('');
    }
  });

  it('returns null for packV2(null)', () => {
    expect(decodeScenario(packV2(null))).toBeNull();
  });

  it('returns null when a range mask is invalid base64 (atob throw swallowed)', () => {
    const enc = packV2({ p: ['***invalid base64***'], b: [] });
    expect(() => decodeScenario(enc)).not.toThrow();
    expect(decodeScenario(enc)).toBeNull();
  });

  it('returns null when p is not an array', () => {
    const enc = packV2({ p: { a: 1 }, b: 'x', n: 5 });
    expect(() => decodeScenario(enc)).not.toThrow();
    expect(decodeScenario(enc)).toBeNull();
  });

  it('pins lenient decode of out-of-range card ids (undefined v/s, no throw)', () => {
    const enc = packV2({ p: [[999, -3]], b: [700] });
    let out;
    expect(() => { out = decodeScenario(enc); }).not.toThrow();
    expect(out.players[0].kind).toBe('hand');
    expect(out.players[0].hand).toHaveLength(2);
    expect(out.players[0].hand[0].v).toBeUndefined();
    expect(out.board[0].v).toBeUndefined();
  });

  it('returns null for v1 fall-through with non-array p', () => {
    const enc = btoa(JSON.stringify({ p: 5, b: 9 }));
    expect(() => decodeScenario(enc)).not.toThrow();
    expect(decodeScenario(enc)).toBeNull();
  });

  it('returns null for an unknown version sigil', () => {
    expect(decodeScenario('!AAAA')).toBeNull();
  });

  it('survives random unicode fuzz', () => {
    const rng = mulberry32(0xBADC0DE);
    const randomString = (len) => {
      let s = '';
      for (let i = 0; i < len; i++) s += String.fromCharCode(1 + Math.floor(rng() * 0xFFFE));
      return s;
    };
    expect(() => decodeScenario(randomString(10000))).not.toThrow();
    for (let i = 0; i < 30; i++) {
      const s = (rng() < 0.5 ? '~' : '') + randomString(300);
      expect(() => decodeScenario(s)).not.toThrow();
    }
  });
});

describe('round-trip completeness', () => {
  it('round-trips 9 full seats with distinct names', () => {
    const players = [
      hand('As', 'Ah'), hand('Kd', 'Kc'), hand('Qs', 'Qh'), hand('Js', 'Jh'), hand('Ts', 'Th'),
      { kind: 'range', range: ['AA'] },
      { kind: 'range', range: ['AKs', 'AKo'] },
      { kind: 'range', range: ALL_KEYS },
      { kind: 'range', range: ['22', '32s', '32o'] },
    ];
    const playerNames = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'];
    const out = decodeScenario(encodeScenario({ players, board: [], playerNames, pot: '7', callAmt: '3' }));
    expect(out.players).toHaveLength(9);
    for (let i = 0; i < 5; i++) expect(out.players[i]).toEqual(players[i]);
    for (let i = 5; i < 9; i++) {
      expect(out.players[i].kind).toBe('range');
      expect([...out.players[i].range].sort()).toEqual([...players[i].range].sort());
    }
    expect(out.playerNames).toEqual(playerNames);
  });

  it('preserves mid-table empty seats', () => {
    const players = [null, hand('As', 'Ah'), null, { kind: 'range', range: ['AA'] }, null, null, null, null, null];
    const out = decodeScenario(encodeScenario({ players, board: [], playerNames: [], pot: '', callAmt: '' }));
    expect(out.players[0]).toBeNull();
    expect(out.players[1]).toEqual(hand('As', 'Ah'));
    expect(out.players[2]).toBeNull();
    expect(out.players[3]).toEqual({ kind: 'range', range: ['AA'] });
    expect(out.players.slice(4).every((p) => p === null)).toBe(true);
  });

  it('trims trailing empty seats so [hand, null, null] encodes identically to [hand]', () => {
    const base = { board: [], playerNames: [], pot: '', callAmt: '' };
    const a = encodeScenario({ ...base, players: [hand('As', 'Ah'), null, null] });
    const b = encodeScenario({ ...base, players: [hand('As', 'Ah')] });
    expect(a).toBe(b);
    expect(decodeScenario(a)).toEqual(decodeScenario(b));
  });

  it('round-trips unicode names byte-identically', () => {
    const playerNames = ['Pierré', '龍さん', '🃏joker🃏'];
    const out = decodeScenario(encodeScenario({
      players: [hand('As', 'Ah')], board: [], playerNames, pot: '', callAmt: '',
    }));
    expect(out.playerNames.slice(0, 3)).toEqual(playerNames);
  });

  it('preserves a leading empty name as null', () => {
    const out = decodeScenario(encodeScenario({
      players: [hand('As', 'Ah')], board: [], playerNames: [null, 'Bob'], pot: '', callAmt: '',
    }));
    expect(out.playerNames[0]).toBeNull();
    expect(out.playerNames[1]).toBe('Bob');
    expect(out.playerNames.slice(2).every((n) => n === null)).toBe(true);
  });

  it('keeps an empty-range player as a range seat, not an empty seat', () => {
    const out = decodeScenario(encodeScenario({
      players: [{ kind: 'range', range: [] }], board: [], playerNames: [], pot: '', callAmt: '',
    }));
    expect(out.players[0]).toEqual({ kind: 'range', range: [] });
  });

  it('round-trips a full 5-card board in order', () => {
    const board = [card('2s'), card('7h'), card('Td'), card('Jc'), card('Qs')];
    const out = decodeScenario(encodeScenario({
      players: [hand('As', 'Ah')], board, playerNames: [], pot: '', callAmt: '',
    }));
    expect(out.board).toEqual(board);
  });

  it('property: 200 random scenarios round-trip every field', () => {
    const rng = mulberry32(0xC0FFEE);
    const int = (n) => Math.floor(rng() * n);
    const SUITS = ['s', 'h', 'd', 'c'];
    const NAME_POOL = ['a', 'Z', '9', 'é', '龍', 'Ж', '🃏', 'ñ', 'さ', 'ع'];
    const MONEY_POOL = ['', '1', '100', '0.5', '999999'];

    for (let iter = 0; iter < 200; iter++) {
      const deck = [];
      for (const v of RANKS) for (const s of SUITS) deck.push({ v, s });
      for (let i = deck.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      const players = Array.from({ length: int(10) }, () => {
        const t = rng();
        if (t < 0.34) return null;
        if (t < 0.67) return { kind: 'hand', hand: [deck.pop(), deck.pop()] };
        const density = rng();
        return { kind: 'range', range: ALL_KEYS.filter(() => rng() < density) };
      });
      const board = Array.from({ length: [0, 3, 4, 5][int(4)] }, () => deck.pop());
      const playerNames = Array.from({ length: int(10) }, () => {
        if (rng() < 0.3) return null;
        let n = '';
        for (let i = int(7); i > 0; i--) n += NAME_POOL[int(NAME_POOL.length)];
        return n;
      });
      const pot = MONEY_POOL[int(MONEY_POOL.length)];
      const callAmt = MONEY_POOL[int(MONEY_POOL.length)];

      const out = decodeScenario(encodeScenario({ players, board, playerNames, pot, callAmt }));
      expect(out.players).toHaveLength(9);
      for (let i = 0; i < 9; i++) {
        const exp = players[i] || null;
        if (!exp) expect(out.players[i]).toBeNull();
        else if (exp.kind === 'hand') expect(out.players[i]).toEqual(exp);
        else {
          expect(out.players[i].kind).toBe('range');
          expect([...out.players[i].range].sort()).toEqual([...exp.range].sort());
        }
      }
      expect(out.board).toEqual(board);
      expect(out.playerNames).toHaveLength(9);
      for (let i = 0; i < 9; i++) expect(out.playerNames[i]).toBe(playerNames[i] || null);
      expect(out.pot).toBe(pot);
      expect(out.callAmt).toBe(callAmt);
    }
  });

  it('pins the pot/callAmt falsy coercion: numeric 0 becomes "", string "0" survives', () => {
    const base = { players: [hand('As', 'Ah')], board: [], playerNames: [] };
    expect(decodeScenario(encodeScenario({ ...base, pot: 0, callAmt: 0 })).pot).toBe('');
    const out = decodeScenario(encodeScenario({ ...base, pot: '0', callAmt: '0' }));
    expect(out.pot).toBe('0');
    expect(out.callAmt).toBe('0');
  });
});

describe('legacy v1 decode breadth', () => {
  const v1 = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))));

  it('decodes a numeric-0 empty seat', () => {
    const out = decodeScenario(v1({ p: [0, ['h', 'AsAh']], b: '', n: [], po: '', ca: '' }));
    expect(out.players[0]).toBeNull();
    expect(out.players[1]).toEqual(hand('As', 'Ah'));
  });

  it('decodes unicode names via the escape/decodeURIComponent path', () => {
    const out = decodeScenario(v1({ p: [['h', 'AsAh']], n: ['Pierré', '龍'] }));
    expect(out.playerNames[0]).toBe('Pierré');
    expect(out.playerNames[1]).toBe('龍');
  });

  it('defaults missing optional fields', () => {
    const out = decodeScenario(v1({ p: [['h', 'AsAh']] }));
    expect(out.players[0]).toEqual(hand('As', 'Ah'));
    expect(out.board).toEqual([]);
    expect(out.playerNames.every((n) => n === null)).toBe(true);
    expect(out.pot).toBe('');
    expect(out.callAmt).toBe('');
  });

  it('decodes URL-safe base64 with stripped padding', () => {
    const obj = { p: [['h', 'AsAh']], b: '2s7hTd', n: ['o龍o龍?'], po: '10', ca: '5' };
    const std = v1(obj);
    // fixture sanity: must actually exercise the +, / and = handling
    expect(std).toContain('+');
    expect(std).toContain('/');
    expect(std).toMatch(/=$/);
    const urlSafe = std.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const out = decodeScenario(urlSafe);
    expect(out.players[0]).toEqual(hand('As', 'Ah'));
    expect(out.board).toEqual([card('2s'), card('7h'), card('Td')]);
    expect(out.playerNames[0]).toBe('o龍o龍?');
    expect(out.pot).toBe('10');
  });

  it('pins odd-length v1 hand strings decoding without throwing', () => {
    let out;
    expect(() => { out = decodeScenario(v1({ p: [['h', 'AsA']] })); }).not.toThrow();
    expect(out.players[0].hand).toHaveLength(2);
    expect(out.players[0].hand[1].v).toBe('A');
    expect(out.players[0].hand[1].s).toBeUndefined();
  });

  it('migrates: decoded v1 re-encodes to a ~v2 string that decodes identically', () => {
    const V1 = 'eyJwIjpbWyJoIiwiQXNBaCJdLFsiciIsWyJLSyIsIlFRIl1dXSwiYiI6IjJzN2hUZCIsIm4iOlsiSGVybyIsIlZpbGxhaW4iXSwicG8iOiIxMjAiLCJjYSI6IjQwIn0';
    const first = decodeScenario(V1);
    const v2 = encodeScenario(first);
    expect(v2[0]).toBe('~');
    const again = decodeScenario(v2);
    expect(again.players[0]).toEqual(first.players[0]);
    expect(again.players[1].kind).toBe('range');
    expect([...again.players[1].range].sort()).toEqual([...first.players[1].range].sort());
    expect(again.board).toEqual(first.board);
    expect(again.playerNames).toEqual(first.playerNames);
    expect(again.pot).toBe(first.pot);
    expect(again.callAmt).toBe(first.callAmt);
  });
});

describe('share URL building/reading', () => {
  afterEach(() => { window.location.hash = ''; });

  const SCEN = {
    players: [hand('As', 'Ah'), { kind: 'range', range: ['AA', 'KK'] }],
    board: [card('2s'), card('7h'), card('Td')],
    playerNames: ['Hero', 'Villain'],
    pot: '100',
    callAmt: '25',
  };

  it('keeps a worst-case share URL comfortably under limits', () => {
    const name = '🃏Ж龍éあ漢字!xyz12345'; // 17 UTF-16 code units
    expect(name.length).toBe(17);
    const url = buildShareUrl({
      players: Array.from({ length: 9 }, () => ({ kind: 'range', range: ALL_KEYS })),
      board: [card('2s'), card('7h'), card('Td'), card('Jc'), card('Qs')],
      playerNames: Array.from({ length: 9 }, () => name),
      pot: '123456',
      callAmt: '6543',
    });
    expect(url.length).toBeLessThan(2000);
    expect(url.length).toBeLessThan(600);
  });

  it('buildShareUrl is origin + pathname + #s= + encodeScenario, and round-trips', () => {
    const url = buildShareUrl(SCEN);
    expect(url).toBe(window.location.origin + window.location.pathname + '#s=' + encodeScenario(SCEN));
    const out = decodeScenario(url.split('#s=')[1]);
    expect(out.players[0]).toEqual(SCEN.players[0]);
    expect(out.pot).toBe('100');
  });

  it('readScenarioFromUrl decodes the #s= hash', () => {
    window.location.hash = '#s=' + encodeScenario(SCEN);
    const out = readScenarioFromUrl();
    expect(out.players[0]).toEqual(hand('As', 'Ah'));
    expect(out.players[1]).toEqual({ kind: 'range', range: ['AA', 'KK'] });
    expect(out.callAmt).toBe('25');
  });

  it('returns null for empty and unrelated hashes', () => {
    window.location.hash = '';
    expect(readScenarioFromUrl()).toBeNull();
    window.location.hash = '#r=abc';
    expect(readScenarioFromUrl()).toBeNull();
    window.location.hash = '#share';
    expect(readScenarioFromUrl()).toBeNull();
  });

  it('returns null for #s=garbage without throwing', () => {
    window.location.hash = '#s=garbage';
    expect(() => readScenarioFromUrl()).not.toThrow();
    expect(readScenarioFromUrl()).toBeNull();
  });
});
