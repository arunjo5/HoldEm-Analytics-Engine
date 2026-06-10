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

const clone = (o) => JSON.parse(JSON.stringify(o));
const one = (h, pivot = 'p_none') => convertAllHands([h], pivot)[0];

const seatHand = (seats, dealerSeat) => ({
  number: '1', gameType: 'th', dealerSeat, smallBlind: 50, bigBlind: 100,
  players: seats.map((s) => ({ seat: s, id: 'p' + s, name: 's' + s, stack: 10000 })),
  events: [],
});

describe('seatOrder dead button', () => {
  it('uses the occupied seat just below a dead button', () => {
    const { seats } = one(seatHand([0, 2, 5], 1)).replay.setup;
    expect(seats.map((s) => s.name)).toEqual(['s0', 's2', 's5']);
    expect(seats.map((s) => s.pos)).toEqual(['BTN', 'SB', 'BB']);
  });

  it('picks the largest occupied seat below the dead button', () => {
    const { seats } = one(seatHand([0, 2, 5], 4)).replay.setup;
    expect(seats.map((s) => s.name)).toEqual(['s2', 's5', 's0']);
  });

  it('wraps to the highest seat when the dead button is below all occupied seats', () => {
    const { seats } = one(seatHand([2, 5], 0)).replay.setup;
    expect(seats.map((s) => s.name)).toEqual(['s5', 's2']);
    expect(seats.map((s) => s.pos)).toEqual(['BTN', 'BB']);
  });

  it('starts at the button when it sits on an occupied non-zero seat', () => {
    const { seats } = one(seatHand([0, 1, 2], 2)).replay.setup;
    expect(seats.map((s) => s.name)).toEqual(['s2', 's0', 's1']);
    expect(seats.map((s) => s.pos)).toEqual(['BTN', 'SB', 'BB']);
  });
});

describe('pot reconciliation (valid flag)', () => {
  const withWin = (value) => {
    const s = clone(SAMPLE);
    s.hands[0].events.find((e) => e.payload.type === 10).payload.value = value;
    return s;
  };

  it('keeps the hand but flags valid:false when WIN disagrees with the rebuilt pot', () => {
    const out = handsFor(withWin(300), 'p_alice');
    expect(out).toHaveLength(1);
    expect(out[0].valid).toBe(false);
  });

  it('tolerates a 1-cent mismatch but not 2', () => {
    expect(handsFor(withWin(199), 'p_alice')[0].valid).toBe(true);
    expect(handsFor(withWin(198), 'p_alice')[0].valid).toBe(false);
  });

  it('fails reconciliation when the UNCALLED event is missing', () => {
    const s = clone(SAMPLE);
    s.hands[0].events = s.hands[0].events.filter((e) => e.payload.type !== 16);
    expect(handsFor(s, 'p_alice')[0].valid).toBe(false);
  });

  it('contains a replay blow-up from an action on an unseated seat as valid:false', () => {
    const s = clone(SAMPLE);
    s.hands[0].events.splice(2, 0, { payload: { type: 8, seat: 9, value: 500 } });
    const out = handsFor(s, 'p_alice');
    expect(out).toHaveLength(1);
    expect(out[0].valid).toBe(false);
  });

  it('counts a WIN on an unknown seat toward the total but not replay.won', () => {
    const s = clone(SAMPLE);
    s.hands[0].events.find((e) => e.payload.type === 10).payload.seat = 99;
    const h = handsFor(s, 'p_alice')[0];
    expect(h.valid).toBe(true);
    expect(h.replay.won).toEqual({});
    expect(h.summary.potLabel).toBe('$2 pot');
  });
});

// heads-up all-in preflop, then board deals; deals = [cards, turn, run?][]
const ritHand = ({ p0 = ['As', 'Ah'], p1 = ['Kd', 'Kc'], deals, wins }) => ({
  number: '5', gameType: 'th', dealerSeat: 0, smallBlind: 50, bigBlind: 100,
  players: [
    { seat: 0, id: 'p_alice', name: 'alice', stack: 10000, ...(p0 ? { hand: p0 } : {}) },
    { seat: 1, id: 'p_bob', name: 'bob', stack: 10000, ...(p1 ? { hand: p1 } : {}) },
  ],
  events: [
    { payload: { type: 3, seat: 0, value: 50 } },
    { payload: { type: 2, seat: 1, value: 100 } },
    { payload: { type: 8, seat: 0, value: 10000 } },
    { payload: { type: 7, seat: 1, value: 10000 } },
    ...deals.map(([cards, turn, run]) => ({ payload: { type: 9, cards, turn, ...(run ? { run } : {}) } })),
    ...wins.map(([seat, value]) => ({ payload: { type: 10, seat, value } })),
  ],
});

// run 1: aces hold; run 2 river Kh: kings spike a set
const RIT_DEALS = [[['2c', '7d', '9h'], 1], [['3s'], 2], [['5d'], 3], [['Kh'], 3, 2]];

describe('run it twice', () => {
  it('builds board2 from shared run-1 streets plus the run-2 re-deal', () => {
    const h = one(ritHand({ deals: RIT_DEALS, wins: [[0, 10000], [1, 10000]] }));
    expect(h.replay.board).toEqual(['2c', '7d', '9h', '3s', '5d'].map(card));
    expect(h.replay.board2).toEqual(['2c', '7d', '9h', '3s', 'Kh'].map(card));
    expect(h.summary.runTwice).toBe(true);
  });

  it('accepts runResults when each board winner got half the pot', () => {
    const h = one(ritHand({ deals: RIT_DEALS, wins: [[0, 10000], [1, 10000]] }));
    expect(h.valid).toBe(true);
    expect(h.replay.runResults).toEqual([
      { run: 1, won: { 0: 10000 } },
      { run: 2, won: { 1: 10000 } },
    ]);
  });

  it('accepts a single full-pot WIN when the same seat takes both boards', () => {
    const deals = [[['2c', '7d', '9h'], 1], [['3s'], 2], [['5d'], 3], [['6h'], 3, 2]];
    const h = one(ritHand({ deals, wins: [[0, 20000]] }));
    expect(h.replay.runResults).toEqual([
      { run: 1, won: { 0: 10000 } },
      { run: 2, won: { 0: 10000 } },
    ]);
  });

  it('rejects runResults when payouts credit the wrong player', () => {
    const h = one(ritHand({ deals: RIT_DEALS, wins: [[0, 20000]] }));
    expect(h.replay.runResults).toBe(null);
    expect(h.replay.board2).toHaveLength(5);
    expect(h.summary.runTwice).toBe(true);
  });

  it('splits a chopped run between the contenders', () => {
    // run 1 chops (same high cards); run 2 river gives alice a flush
    const deals = [[['2h', '6h', '9s'], 1], [['Jc'], 2], [['3d'], 3], [['4h'], 3, 2]];
    const h = one(ritHand({
      p0: ['Ah', 'Th'], p1: ['Ad', 'Td'], deals,
      wins: [[0, 15000], [1, 5000]],
    }));
    expect(h.replay.runResults).toEqual([
      { run: 1, won: { 0: 5000, 1: 5000 } },
      { run: 2, won: { 0: 10000 } },
    ]);
  });

  it('keeps runResults null when an all-in player\'s cards are unknown', () => {
    const h = one(ritHand({ p1: null, deals: RIT_DEALS, wins: [[1, 20000]] }));
    expect(h.valid).toBe(true);
    expect(h.replay.runResults).toBe(null);
    expect(h.summary.runTwice).toBe(true);
  });

  it('keeps runResults null when the boards never reach the river', () => {
    const deals = [[['2c', '7d', '9h'], 1], [['3s'], 2], [['6d'], 2, 2]];
    const h = one(ritHand({ deals, wins: [[0, 10000], [1, 10000]] }));
    expect(h.replay.board2).toEqual(['2c', '7d', '9h', '6d'].map(card));
    expect(h.replay.runResults).toBe(null);
  });

  it('excludes a folded player with known cards from both run results', () => {
    const h = one({
      number: '6', gameType: 'th', dealerSeat: 0, smallBlind: 50, bigBlind: 100,
      players: [
        { seat: 0, id: 'p_carol', name: 'carol', stack: 10000, hand: ['Qs', 'Qd'] },
        { seat: 1, id: 'p_alice', name: 'alice', stack: 10000, hand: ['As', 'Ac'] },
        { seat: 2, id: 'p_bob', name: 'bob', stack: 10000, hand: ['Ks', 'Kc'] },
      ],
      events: [
        { payload: { type: 3, seat: 1, value: 50 } },
        { payload: { type: 2, seat: 2, value: 100 } },
        { payload: { type: 11, seat: 0 } },
        { payload: { type: 8, seat: 1, value: 10000 } },
        { payload: { type: 7, seat: 2, value: 10000 } },
        { payload: { type: 9, cards: ['2h', '7d', '9c'], turn: 1 } },
        { payload: { type: 9, cards: ['3s'], turn: 2 } },
        { payload: { type: 9, cards: ['5h'], turn: 3 } },
        { payload: { type: 9, cards: ['Kh'], turn: 3, run: 2 } },
        { payload: { type: 10, seat: 1, value: 10000 } },
        { payload: { type: 10, seat: 2, value: 10000 } },
      ],
    });
    expect(h.replay.runResults).toEqual([
      { run: 1, won: { 1: 10000 } },
      { run: 2, won: { 2: 10000 } },
    ]);
  });
});

describe('SHOW reveals', () => {
  const showSample = () => {
    const s = clone(SAMPLE);
    delete s.hands[0].players[1].hand;
    s.hands[0].events.splice(8, 0, { payload: { type: 12, seat: 1, cards: ['Qh', 'Qs'] } });
    return s;
  };

  it('fills hole cards from a SHOW event when players[].hand is missing', () => {
    const h = handsFor(showSample(), 'p_alice')[0];
    expect(h.replay.setup.seats[1].cards).toEqual([card('Qh'), card('Qs')]);
  });

  it('does not let SHOW overwrite players[].hand', () => {
    const s = clone(SAMPLE);
    s.hands[0].events.splice(8, 0, { payload: { type: 12, seat: 0, cards: ['2c', '3c'] } });
    const h = handsFor(s, 'p_alice')[0];
    expect(h.replay.setup.seats[0].cards).toEqual([card('As'), card('Kd')]);
  });

  it('ignores SHOW events with partial or non-array cards', () => {
    const s = clone(SAMPLE);
    delete s.hands[0].players[1].hand;
    s.hands[0].events.splice(8, 0,
      { payload: { type: 12, seat: 1, cards: [null, 'Qs'] } },
      { payload: { type: 12, seat: 1, cards: 'QhQs' } });
    const h = handsFor(s, 'p_alice')[0];
    expect(h.replay.setup.seats[1].cards).toBe(null);
  });

  it('populates heroCards from a SHOW-only reveal', () => {
    const h = handsFor(showSample(), 'p_bob')[0];
    expect(h.summary.heroCards).toEqual([card('Qh'), card('Qs')]);
  });
});

describe('roster rename and dedupe', () => {
  const pair = (a, b, over = {}) => ({
    number: '1', gameType: 'th', dealerSeat: 0, smallBlind: 50, bigBlind: 100,
    players: [{ seat: 0, stack: 1000, ...a }, { seat: 1, stack: 1000, ...b }],
    events: [],
    ...over,
  });
  const roster = (hands) => parsePokerNowLog(JSON.stringify({ hands })).players;

  it('keeps the most-used name across renames', () => {
    const filler = { id: 'p_f', name: 'filler' };
    const out = roster([
      pair({ id: 'p_x', name: 'bob' }, filler),
      pair({ id: 'p_x', name: 'bob' }, filler),
      pair({ id: 'p_x', name: 'bobby' }, filler),
    ]);
    expect(out.find((p) => p.id === 'p_x')).toEqual({ id: 'p_x', name: 'bob', count: 3 });
  });

  it('falls back to Unknown for always-blank names', () => {
    const out = roster([pair({ id: 'p_w', name: '   ' }, { id: 'p_f', name: 'filler' })]);
    expect(out.find((p) => p.id === 'p_w').name).toBe('Unknown');
  });

  it('counts a duplicated id once per hand', () => {
    const out = roster([pair({ id: 'p_x', name: 'bob' }, { id: 'p_x', name: 'bob' })]);
    expect(out).toEqual([{ id: 'p_x', name: 'bob', count: 1 }]);
  });

  it('ignores short-handed and non-hold\'em hands entirely', () => {
    const out = roster([
      { number: '1', gameType: 'th', players: [{ seat: 0, id: 'p_x', name: 'bob' }], events: [] },
      pair({ id: 'p_x', name: 'bob' }, { id: 'p_y', name: 'amy' }, { gameType: 'plo' }),
    ]);
    expect(out).toEqual([]);
  });

  it('breaks count ties by name', () => {
    const out = roster([pair({ id: 'p_z', name: 'zed' }, { id: 'p_a', name: 'amy' })]);
    expect(out.map((p) => p.name)).toEqual(['amy', 'zed']);
  });
});

describe('action classification', () => {
  const CLASSIFY = {
    number: '7', gameType: 'th', dealerSeat: 0, smallBlind: 50, bigBlind: 100,
    players: [
      { seat: 0, id: 'p_alice', name: 'alice', stack: 100000, hand: ['As', 'Kd'] },
      { seat: 1, id: 'p_bob', name: 'bob', stack: 100000, hand: ['7c', '2d'] },
    ],
    events: [
      { payload: { type: 3, seat: 0, value: 50 } },
      { payload: { type: 2, seat: 1, value: 100 } },
      { payload: { type: 8, seat: 0, value: 300 } },
      { payload: { type: 7, seat: 1, value: 300 } },
      { payload: { type: 9, cards: ['Jh', 'Td', '2s'], turn: 1 } },
      { payload: { type: 7, seat: 1, value: 150 } },
      { payload: { type: 7, seat: 0, value: 450 } },
      { payload: { type: 7, seat: 1, value: 450 } },
      { payload: { type: 9, cards: ['3c'], turn: 2 } },
      { payload: { type: 0, seat: 1 } },
      { payload: { type: 0, seat: 0 } },
      { payload: { type: 9, cards: ['9s'], turn: 3 } },
      { payload: { type: 0, seat: 1 } },
      { payload: { type: 0, seat: 0 } },
      { payload: { type: 10, seat: 1, value: 1500 } },
    ],
  };

  it('classifies by committed value vs street bet, not by event code', () => {
    const h = one(CLASSIFY, 'p_alice');
    // type-7 events become bet/raise when over the street bet, type-8 a call when matching
    expect(h.replay.actions).toEqual([
      { seat: 0, type: 'raise', amount: 300, street: 0 },
      { seat: 1, type: 'call', amount: 300, street: 0 },
      { seat: 1, type: 'bet', amount: 150, street: 1 },
      { seat: 0, type: 'raise', amount: 450, street: 1 },
      { seat: 1, type: 'call', amount: 450, street: 1 },
      { seat: 1, type: 'check', street: 2 },
      { seat: 0, type: 'check', street: 2 },
      { seat: 1, type: 'check', street: 3 },
      { seat: 0, type: 'check', street: 3 },
    ]);
    expect(h.valid).toBe(true);
  });

  it('resets the street bet on each run-1 deal', () => {
    // flop wager of 150 < preflop's 300 still opens as a bet
    const h = one(CLASSIFY, 'p_alice');
    expect(h.replay.actions[2]).toEqual({ seat: 1, type: 'bet', amount: 150, street: 1 });
  });

  it('treats a type-8 limp of exactly the bb as a call', () => {
    const s = clone(CLASSIFY);
    s.events.splice(2, 2,
      { payload: { type: 8, seat: 0, value: 100 } },
      { payload: { type: 0, seat: 1 } });
    s.events[s.events.length - 1].payload.value = 1100;
    const h = one(s, 'p_alice');
    expect(h.replay.actions[0]).toEqual({ seat: 0, type: 'call', amount: 100, street: 0 });
    expect(h.valid).toBe(true);
  });

  it('emits no action entries for blind posts', () => {
    const h = one(CLASSIFY, 'p_alice');
    expect(h.replay.actions.filter((a) => a.street === 0)).toHaveLength(2);
  });
});

describe('malformed input resilience', () => {
  it('skips a hand without events and keeps the rest', () => {
    const s = clone(SAMPLE);
    s.hands.push({ ...clone(SAMPLE.hands[0]), number: '2', events: undefined });
    const out = handsFor(s, 'p_alice');
    expect(out.map((h) => h.number)).toEqual([1]);
  });

  it('drops 1-player and non-hold\'em hands from convertAllHands without erroring', () => {
    const oneP = {
      number: '3', gameType: 'th', dealerSeat: 0, smallBlind: 50, bigBlind: 100,
      players: [{ seat: 0, id: 'p_alice', name: 'alice', stack: 1000 }], events: [],
    };
    const plo = { ...clone(SAMPLE.hands[0]), number: '4', gameType: 'plo' };
    const out = convertAllHands([oneP, plo, clone(SAMPLE.hands[0])], 'p_alice');
    expect(out.map((h) => h.number)).toEqual([1]);
  });

  it('treats a hand with no gameType as hold\'em', () => {
    const h = clone(SAMPLE.hands[0]);
    delete h.gameType;
    const parsed = parsePokerNowLog(JSON.stringify({ playerId: 'p_alice', hands: [h] }));
    expect(parsed.players.find((p) => p.id === 'p_alice').count).toBe(1);
    expect(convertHandsFor(parsed.rawHands, 'p_alice')).toHaveLength(1);
  });

  it('ignores DEAL events with missing or non-array cards', () => {
    const s = clone(SAMPLE);
    delete s.hands[0].events.find((e) => e.payload.type === 9).payload.cards;
    s.hands[0].events.splice(5, 0, { payload: { type: 9, cards: 'JhTd2s', turn: 1 } });
    expect(handsFor(s, 'p_alice')[0].replay.board).toEqual([]);
  });

  it('lets unknown event types fall through with no effect', () => {
    const s = clone(SAMPLE);
    s.hands[0].events.splice(3, 0, { payload: { type: 99, seat: 0, value: 777 } });
    const base = handsFor(SAMPLE, 'p_alice')[0];
    const h = handsFor(s, 'p_alice')[0];
    expect(h.replay.actions).toEqual(base.replay.actions);
    expect(h.replay.board).toEqual(base.replay.board);
    expect(h.valid).toBe(true);
  });

  it('rejects a half-known players[].hand', () => {
    const s = clone(SAMPLE);
    s.hands[0].players[1].hand = ['7c', null];
    expect(handsFor(s, 'p_alice')[0].replay.setup.seats[1].cards).toBe(null);
  });

  it('parses numeric-string hand numbers and formats stakes in dollars', () => {
    const s = clone(SAMPLE);
    s.hands[0].number = '042';
    const h = handsFor(s, 'p_alice')[0];
    expect(h.number).toBe(42);
    expect(h.summary.stakes).toBe('$0.5/$1');
  });
});

describe('parser hardening', () => {
  it('returns exportHeroId null when the log has no playerId', () => {
    expect(parsePokerNowLog(JSON.stringify({ hands: SAMPLE2.hands })).exportHeroId).toBe(null);
  });

  it('pivots cleanly around an unseated player', () => {
    const h = convertAllHands([clone(SAMPLE2.hands[1])], 'p_alice')[0];
    expect(h.summary.heroCards).toBe(null);
    expect(h.summary.players).toEqual(['carol', 'bob']); // pure button order
  });

  it('labels the pot only when something was won', () => {
    const base = handsFor(SAMPLE, 'p_alice')[0];
    expect(base.summary.potLabel).toBe('$2 pot');
    expect(base.summary.runTwice).toBe(false);
    const s = clone(SAMPLE);
    s.hands[0].events = s.hands[0].events.filter((e) => e.payload.type !== 10);
    expect(handsFor(s, 'p_alice')[0].summary.potLabel).toBe(null);
  });

  it('rounds odd-cent chops per winner (shares need not sum to the pot)', () => {
    // 3-way all-in for 2998; both boards chop 3 ways: round(2997/2/3) = 500 each
    const h = one({
      number: '8', gameType: 'th', dealerSeat: 0, smallBlind: 10, bigBlind: 20,
      players: [
        { seat: 0, id: 'p_d', name: 'dora', stack: 1000, hand: ['Ah', '3s'] },
        { seat: 1, id: 'p_e', name: 'eve', stack: 999, hand: ['Ac', '3d'] },
        { seat: 2, id: 'p_f', name: 'fay', stack: 999, hand: ['As', '2h'] },
      ],
      events: [
        { payload: { type: 3, seat: 1, value: 10 } },
        { payload: { type: 2, seat: 2, value: 20 } },
        { payload: { type: 8, seat: 0, value: 1000 } },
        { payload: { type: 7, seat: 1, value: 999 } },
        { payload: { type: 7, seat: 2, value: 999 } },
        { payload: { type: 9, cards: ['5h', '6s', '7d'], turn: 1 } },
        { payload: { type: 9, cards: ['8c'], turn: 2 } },
        { payload: { type: 9, cards: ['9h'], turn: 3 } },
        { payload: { type: 9, cards: ['4d'], turn: 3, run: 2 } },
        { payload: { type: 16, seat: 0, value: 1 } },
        { payload: { type: 10, seat: 0, value: 999 } },
        { payload: { type: 10, seat: 1, value: 999 } },
        { payload: { type: 10, seat: 2, value: 999 } },
      ],
    });
    expect(h.valid).toBe(true);
    expect(h.replay.runResults).toEqual([
      { run: 1, won: { 0: 500, 1: 500, 2: 500 } },
      { run: 2, won: { 0: 500, 1: 500, 2: 500 } },
    ]);
  });

  it('passes antes into the setup and still reconciles', () => {
    const h = one({
      number: '9', gameType: 'th', dealerSeat: 0, smallBlind: 50, bigBlind: 100, ante: 25,
      players: [
        { seat: 0, id: 'p_alice', name: 'alice', stack: 10000 },
        { seat: 1, id: 'p_bob', name: 'bob', stack: 10000 },
      ],
      events: [
        { payload: { type: 3, seat: 0, value: 50 } },
        { payload: { type: 2, seat: 1, value: 100 } },
        { payload: { type: 11, seat: 0 } },
        { payload: { type: 16, seat: 1, value: 50 } },
        { payload: { type: 10, seat: 1, value: 150 } },
      ],
    });
    expect(h.replay.setup.ante).toBe(25);
    expect(h.valid).toBe(true);
  });
});
