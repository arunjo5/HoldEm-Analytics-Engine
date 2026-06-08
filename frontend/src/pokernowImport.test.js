import { describe, it, expect } from 'vitest';
import { parsePokerNowLog, convertHandsFor, convertAllHands } from './pokernowImport.js';

const card = (s) => ({ v: s[0], s: s[1] });

// hands for one player: parse, then convert+filter around that player's id
const handsFor = (sample, id) =>
  convertHandsFor(parsePokerNowLog(JSON.stringify(sample)).rawHands, id);

// EV codes: CHECK 0, POST_BB 2, POST_SB 3, CALL 7, BET_RAISE 8, DEAL 9, WIN 10, FOLD 11, UNCALLED 16
const SAMPLE = {
  playerId: 'p_alice',
  hands: [
    {
      number: '1',
      gameType: 'th',
      dealerSeat: 0,
      smallBlind: 50,
      bigBlind: 100,
      players: [
        { seat: 0, id: 'p_alice', name: 'alice', stack: 10000, hand: ['As', 'Kd'] },
        { seat: 1, id: 'p_bob', name: 'bob', stack: 10000, hand: ['7c', '2d'] },
      ],
      events: [
        { payload: { type: 3, seat: 0, value: 50 } },
        { payload: { type: 2, seat: 1, value: 100 } },
        { payload: { type: 7, seat: 0, value: 100 } },
        { payload: { type: 0, seat: 1 } },
        { payload: { type: 9, cards: ['Jh', 'Td', '2s'], turn: 1 } },
        { payload: { type: 8, seat: 1, value: 150 } },
        { payload: { type: 11, seat: 0 } },
        { payload: { type: 16, seat: 1, value: 150 } },
        { payload: { type: 10, seat: 1, value: 200 } },
      ],
    },
  ],
};

// three players across two hands: alice+bob, then bob+carol
const SAMPLE2 = {
  playerId: 'p_bob',
  hands: [
    {
      number: '10', gameType: 'th', dealerSeat: 0, smallBlind: 50, bigBlind: 100,
      players: [
        { seat: 0, id: 'p_alice', name: 'alice', stack: 10000, hand: ['Ac', 'Ad'] },
        { seat: 1, id: 'p_bob', name: 'bob', stack: 10000 },
      ],
      events: [
        { payload: { type: 3, seat: 0, value: 50 } },
        { payload: { type: 2, seat: 1, value: 100 } },
        { payload: { type: 11, seat: 0 } },
        { payload: { type: 16, seat: 1, value: 50 } },
        { payload: { type: 10, seat: 1, value: 150 } },
      ],
    },
    {
      number: '11', gameType: 'th', dealerSeat: 1, smallBlind: 50, bigBlind: 100,
      players: [
        { seat: 0, id: 'p_bob', name: 'bob', stack: 10000 },
        { seat: 1, id: 'p_carol', name: 'carol', stack: 10000, hand: ['Kc', 'Kd'] },
      ],
      events: [
        { payload: { type: 3, seat: 1, value: 50 } },
        { payload: { type: 2, seat: 0, value: 100 } },
        { payload: { type: 11, seat: 1 } },
        { payload: { type: 16, seat: 0, value: 50 } },
        { payload: { type: 10, seat: 0, value: 150 } },
      ],
    },
  ],
};

describe('parsePokerNowLog', () => {
  it('throws on non-JSON input', () => {
    expect(() => parsePokerNowLog('not json')).toThrow();
  });

  it('throws on JSON that is not a PokerNow export', () => {
    expect(() => parsePokerNowLog('{"foo":1}')).toThrow();
  });

  it('exposes the export hero id and a player roster with hand counts', () => {
    const out = parsePokerNowLog(JSON.stringify(SAMPLE2));
    expect(out.exportHeroId).toBe('p_bob');
    // most hands first, then by name; counted once per hand dealt into
    expect(out.players.map((p) => [p.id, p.name, p.count])).toEqual([
      ['p_bob', 'bob', 2],
      ['p_alice', 'alice', 1],
      ['p_carol', 'carol', 1],
    ]);
  });

  it('converts only the hands the chosen player was dealt into', () => {
    const { rawHands } = parsePokerNowLog(JSON.stringify(SAMPLE2));
    expect(convertHandsFor(rawHands, 'p_alice').map((h) => h.number)).toEqual([10]);
    expect(convertHandsFor(rawHands, 'p_bob').map((h) => h.number)).toEqual([10, 11]);
    expect(convertHandsFor(rawHands, 'p_carol').map((h) => h.number)).toEqual([11]);
  });

  it('converts every hand when no single player is chosen', () => {
    const { rawHands } = parsePokerNowLog(JSON.stringify(SAMPLE2));
    expect(convertAllHands(rawHands, 'p_alice').map((h) => h.number)).toEqual([10, 11]);
  });

  it('pivots hero cards around the chosen player', () => {
    const { rawHands } = parsePokerNowLog(JSON.stringify(SAMPLE));
    expect(convertHandsFor(rawHands, 'p_alice')[0].summary.heroCards).toEqual([card('As'), card('Kd')]);
    expect(convertHandsFor(rawHands, 'p_bob')[0].summary.heroCards).toEqual([card('7c'), card('2d')]);
  });

  it('converts blinds to cents and orders seats from the button', () => {
    const { setup } = handsFor(SAMPLE, 'p_alice')[0].replay;
    expect(setup.cents).toBe(true);
    expect(setup.sb).toBe(50);
    expect(setup.bb).toBe(100);
    expect(setup.seats.map((s) => s.name)).toEqual(['alice', 'bob']);
    expect(setup.seats[0].pos).toBe('BTN');
    expect(setup.seats[0].cards).toEqual([card('As'), card('Kd')]);
  });

  it('reconstructs the board and the betting action', () => {
    const { replay } = handsFor(SAMPLE, 'p_alice')[0];
    expect(replay.board).toEqual([card('Jh'), card('Td'), card('2s')]);
    expect(replay.actions).toEqual([
      { seat: 0, type: 'call', amount: 100, street: 0 },
      { seat: 1, type: 'check', street: 0 },
      { seat: 1, type: 'bet', amount: 150, street: 1 },
      { seat: 0, type: 'fold', street: 1 },
    ]);
  });

  it('reconciles the pot and records the winner', () => {
    const hand = handsFor(SAMPLE, 'p_alice')[0];
    expect(hand.valid).toBe(true);
    expect(hand.replay.won).toEqual({ 1: 200 });
    expect(hand.summary.runTwice).toBe(false);
  });

  it('skips non-hold\'em hands (no roster, no hands)', () => {
    const plo = { ...SAMPLE, hands: [{ ...SAMPLE.hands[0], gameType: 'plo' }] };
    expect(parsePokerNowLog(JSON.stringify(plo)).players).toHaveLength(0);
    expect(handsFor(plo, 'p_alice')).toHaveLength(0);
  });
});
