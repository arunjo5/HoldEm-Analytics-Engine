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
});
