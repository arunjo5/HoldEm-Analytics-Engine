import { describe, it, expect } from 'vitest';
import { encodeScenario, decodeScenario } from './scenario.js';

const card = (s) => ({ v: s[0], s: s[1] });
const hand = (...cs) => ({ kind: 'hand', hand: cs.map(card) });

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
