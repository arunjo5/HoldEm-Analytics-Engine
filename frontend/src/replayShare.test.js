import { describe, it, expect } from 'vitest';
import { encodeReplay, decodeReplay } from './replayShare.js';

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
