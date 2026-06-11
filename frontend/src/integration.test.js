// Cross-subsystem round trips: PokerNow import -> replay engine -> share codec -> equity engine.
import { describe, it, expect } from 'vitest';
import { parsePokerNowLog, convertHandsFor } from './pokernowImport.js';
import { ReplayEngine } from './replayerEngine.js';
import { encodeReplay, decodeReplay } from './replayShare.js';
import { calculate } from './pokerEngine.js';

// EV codes: CHECK 0, POST_BB 2, POST_SB 3, CALL 7, BET_RAISE 8, DEAL 9, WIN 10, FOLD 11, UNCALLED 16
const WIN = 200;
const UNCALLED = 150;
const LOG = {
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
        { payload: { type: 16, seat: 1, value: UNCALLED } },
        { payload: { type: 10, seat: 1, value: WIN } },
      ],
    },
  ],
};

const importedHand = () => {
  const { rawHands } = parsePokerNowLog(JSON.stringify(LOG));
  return convertHandsFor(rawHands, 'p_alice')[0];
};

describe('PokerNow log -> import -> replay engine', () => {
  it('replays the imported hand to a final pot that reconciles with the WIN payout', () => {
    const hand = importedHand();
    expect(hand.valid).toBe(true);
    const { setup, actions, board } = hand.replay;
    const frames = ReplayEngine.buildReplay(setup, actions, board);
    const last = frames[frames.length - 1];
    expect(last.handOver).toBe(true);
    // the engine returns uncalled bets, so the final pot is exactly the payout
    expect(last.pot).toBe(WIN);
    // chips into the pot equal chips out of the stacks
    expect(last.committed.reduce((a, b) => a + b, 0)).toBe(last.pot);
    expect(hand.replay.won).toEqual({ 1: WIN });
  });
});

describe('imported replay -> share codec round trip', () => {
  it('encode/decode preserves setup, actions, board and payouts', () => {
    const { replay } = importedHand();
    const decoded = decodeReplay(encodeReplay(replay));
    expect(decoded.setup).toEqual(replay.setup);
    expect(decoded.actions).toEqual(replay.actions);
    expect(decoded.board).toEqual(replay.board);
    expect(decoded.won).toEqual({ 1: WIN });
    expect(decoded.board2).toBe(null);
    expect(decoded.runResults).toBe(null);
  });

  it('the decoded replay rebuilds the same frames as the original', () => {
    const { replay } = importedHand();
    const decoded = decodeReplay(encodeReplay(replay));
    const original = ReplayEngine.buildReplay(replay.setup, replay.actions, replay.board);
    const rebuilt = ReplayEngine.buildReplay(decoded.setup, decoded.actions, decoded.board);
    expect(rebuilt).toHaveLength(original.length);
    expect(rebuilt[rebuilt.length - 1]).toEqual(original[original.length - 1]);
  });
});

describe('decoded share state -> equity engine', () => {
  it('feeds calculate() without throwing and equities sum to ~100', () => {
    const decoded = decodeReplay(encodeReplay(importedHand().replay));
    // same seat -> player-row mapping App.jsx uses when saving a replay
    const players = decoded.setup.seats.map((s) =>
      s.cards && s.cards.length === 2 ? { kind: 'hand', hand: s.cards } : null
    );
    const r = calculate(players, decoded.board, { sims: 3000 });
    expect(r.sims).toBe(3000); // disjoint cards: every iteration valid
    const equities = Object.values(r.perPlayer).map((p) => p.equity);
    expect(equities).toHaveLength(2);
    for (const e of equities) expect(e).toBeGreaterThan(0);
    expect(equities.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 3);
  });
});
