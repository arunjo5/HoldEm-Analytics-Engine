import { describe, it, expect } from 'vitest';
import { encodeReplay, decodeReplay } from './replayShare.js';
import { packV2 } from './shareCodec.js';

const card = (s) => ({ v: s[0], s: s[1] });

const HAND = {
  setup: {
    sb: 50, bb: 100, ante: 0, cents: true,
    seats: [
      { name: 'rex', stack: 10000, pos: 'BTN', cards: null },
      { name: 'Pranad', stack: 8000, pos: 'SB', cards: [card('2c'), card('2h')] },
      { name: 'luc', stack: 12000, pos: 'BB', cards: [card('As'), card('Js')] },
    ],
  },
  actions: [
    { seat: 0, type: 'call', amount: 100, street: 0 },
    { seat: 2, type: 'check', street: 0 },
    { seat: 1, type: 'bet', amount: 200, street: 1 },
    { seat: 0, type: 'fold', street: 1 },
  ],
  board: [card('Jd'), card('Kh'), card('2d')],
  board2: null,
  won: null,
  runResults: null,
};

describe('replay encode/decode round-trip', () => {
  it('preserves setup, seat cards, derived positions, actions, board', () => {
    const out = decodeReplay(encodeReplay(HAND));
    expect(out.setup.sb).toBe(50);
    expect(out.setup.bb).toBe(100);
    expect(out.setup.cents).toBe(true);
    expect(out.setup.seats.map((s) => s.pos)).toEqual(['BTN', 'SB', 'BB']);
    expect(out.setup.seats[0].cards).toBe(null);
    expect(out.setup.seats[1].cards).toEqual([card('2c'), card('2h')]);
    expect(out.setup.seats[2].name).toBe('luc');
    expect(out.actions).toEqual(HAND.actions);
    expect(out.board).toEqual(HAND.board);
  });

  it('preserves run-it-twice board, won and runResults', () => {
    const twice = {
      ...HAND,
      board2: [card('Jd'), card('Kh'), card('2d'), card('9c'), card('3s')],
      won: { 1: 13000, 2: 13000 },
      runResults: [{ run: 1, won: { 1: 13000 } }, { run: 2, won: { 2: 13000 } }],
    };
    const out = decodeReplay(encodeReplay(twice));
    expect(out.board2).toEqual(twice.board2);
    expect(out.won).toEqual(twice.won);
    expect(out.runResults).toEqual(twice.runResults);
  });

  it('still decodes legacy v1 links and re-encodes far shorter', () => {
    const V1 = 'eyJzIjp7InNiIjo1MCwiYmIiOjEwMCwiYW50ZSI6MCwiY2VudHMiOnRydWUsInNlYXRzIjpbeyJuYW1lIjoicmV4Iiwic3RhY2siOjEwMDAwLCJwb3MiOiJCVE4iLCJjYXJkcyI6bnVsbH0seyJuYW1lIjoiUHJhbmFkIiwic3RhY2siOjgwMDAsInBvcyI6IlNCIiwiY2FyZHMiOlt7InYiOiIyIiwicyI6ImMifSx7InYiOiIyIiwicyI6ImgifV19LHsibmFtZSI6Imx1YyIsInN0YWNrIjoxMjAwMCwicG9zIjoiQkIiLCJjYXJkcyI6W3sidiI6IkEiLCJzIjoicyJ9LHsidiI6IkoiLCJzIjoicyJ9XX1dfSwiYSI6W3sic2VhdCI6MCwidHlwZSI6ImNhbGwiLCJzdHJlZXQiOjB9LHsic2VhdCI6MSwidHlwZSI6ImNhbGwiLCJzdHJlZXQiOjB9LHsic2VhdCI6MiwidHlwZSI6ImNoZWNrIiwic3RyZWV0IjowfSx7InNlYXQiOjEsInR5cGUiOiJiZXQiLCJhbW91bnQiOjIwMCwic3RyZWV0IjoxfSx7InNlYXQiOjAsInR5cGUiOiJmb2xkIiwic3RyZWV0IjoxfV0sImIiOlt7InYiOiJKIiwicyI6ImQifSx7InYiOiJLIiwicyI6ImgifSx7InYiOiIyIiwicyI6ImQifV19';
    const out = decodeReplay(V1);
    expect(out.setup.seats[2].cards).toEqual([card('As'), card('Js')]);
    expect(out.board).toEqual([card('Jd'), card('Kh'), card('2d')]);
    const v2 = encodeReplay(out);
    expect(v2.length).toBeLessThan(V1.length * 0.6);
  });

  it('returns null on malformed input', () => {
    expect(decodeReplay('garbage !!')).toBeNull();
    expect(decodeReplay('')).toBeNull();
  });
});

describe('codec edge branches', () => {
  it('round-trips ante and defaults ante/cents when omitted', () => {
    const withAnte = { ...HAND, setup: { ...HAND.setup, ante: 3 } };
    expect(decodeReplay(encodeReplay(withAnte)).setup.ante).toBe(3);
    const plain = decodeReplay(encodeReplay({ ...HAND, setup: { ...HAND.setup, ante: 0, cents: false } }));
    expect(plain.setup.ante).toBe(0);
    expect(plain.setup.cents).toBe(false);
  });

  it('maps unknown action types to fold on both encode and decode', () => {
    const weird = { ...HAND, actions: [{ seat: 0, type: 'jam', street: 0 }] };
    expect(decodeReplay(encodeReplay(weird)).actions[0].type).toBe('fold');
    const crafted = packV2({ sb: 1, bb: 2, st: [['', 200], ['', 200]], ac: [[0, 9, 0]], bd: [] });
    expect(decodeReplay(crafted).actions[0].type).toBe('fold');
  });

  it('keeps amount 0 but drops a missing amount', () => {
    const h = { ...HAND, actions: [
      { seat: 0, type: 'bet', amount: 0, street: 1 },
      { seat: 1, type: 'call', street: 1 },
    ] };
    const out = decodeReplay(encodeReplay(h));
    expect(out.actions[0].amount).toBe(0);
    expect('amount' in out.actions[0]).toBe(true);
    expect('amount' in out.actions[1]).toBe(false);
  });

  it('returns null for a tilde payload that is not lz data', () => {
    expect(decodeReplay('~not-lz-garbage')).toBeNull();
  });

  it('rejects v2 payloads with empty or corrupt seat lists', () => {
    expect(decodeReplay(packV2({ sb: 1, bb: 2, st: [], ac: [], bd: [] }))).toBeNull();
    expect(decodeReplay(packV2({ sb: 1, bb: 2, st: [null], ac: [], bd: [] }))).toBeNull();
  });

  it('rejects a v1 object missing the board', () => {
    const v1 = btoa(JSON.stringify({ s: { seats: [] }, a: [] }));
    expect(decodeReplay(v1)).toBeNull();
  });

  it('derives positions for 9-max and heads-up tables', () => {
    const seats9 = Array.from({ length: 9 }, (_, i) => ({ name: 'p' + i, stack: 100, cards: null }));
    const out9 = decodeReplay(encodeReplay({ setup: { sb: 1, bb: 2, seats: seats9 }, actions: [], board: [] }));
    expect(out9.setup.seats.map((s) => s.pos)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO']);
    const out2 = decodeReplay(encodeReplay({ setup: { sb: 1, bb: 2, seats: seats9.slice(0, 2) }, actions: [], board: [] }));
    expect(out2.setup.seats.map((s) => s.pos)).toEqual(['BTN', 'BB']);
  });
});
