// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const card = (s) => ({ v: s[0], s: s[1] });
const hand = (a, b) => ({ kind: 'hand', hand: [card(a), card(b)] });

// full board → every sim is valid, so batch accounting is exact
const BOARD = ['2h', '7d', '9c', '4s', '8h'].map(card);
const PLAYERS = [hand('As', 'Ah'), hand('Ks', 'Kh')]; // P0 always wins

// the worker module wires itself to the `self` global at import time
globalThis.self = { postMessage: vi.fn() };
await import('./equityWorker.js');

const post = (data) => self.onmessage({ data });
const messages = () => self.postMessage.mock.calls.map(([m]) => m);

beforeEach(() => {
  vi.useFakeTimers();
  self.postMessage.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('equityWorker batching contract', () => {
  it('posts a single batch then done when maxSims fits one batch', async () => {
    post({ jobId: 'j1', players: PLAYERS, board: BOARD, maxSims: 50, batchSize: 100 });
    await vi.runAllTimersAsync();
    const msgs = messages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].type).toBe('batch');
    expect(msgs[0].deltaValid).toBe(50);
    expect(msgs[1].type).toBe('done');
    expect(msgs.every((m) => m.jobId === 'j1')).toBe(true);
  });

  it('splits maxSims into batchSize chunks with a remainder', async () => {
    post({ jobId: 'j2', players: PLAYERS, board: BOARD, maxSims: 100, batchSize: 40 });
    await vi.runAllTimersAsync();
    const msgs = messages();
    const batches = msgs.filter((m) => m.type === 'batch');
    expect(batches.map((m) => m.deltaValid)).toEqual([40, 40, 20]);
    expect(batches.reduce((s, m) => s + m.deltaValid, 0)).toBe(100);
    expect(msgs.at(-1).type).toBe('done');
  });

  it('deltas reconstruct exact totals', async () => {
    post({ jobId: 'j3', players: PLAYERS, board: BOARD, maxSims: 100, batchSize: 30 });
    await vi.runAllTimersAsync();
    const batches = messages().filter((m) => m.type === 'batch');
    const sum = (key, idx) => batches.reduce((s, m) => s + m[key][idx], 0);
    expect(sum('deltaWins', 0)).toBe(100);
    expect(sum('deltaWins', 1)).toBe(0);
    expect(sum('deltaTies', 0)).toBe(0);
    expect(sum('deltaTies', 1)).toBe(0);
    expect(sum('deltaTieShares', 0)).toBe(0);
  });

  it('tags every message with the originating jobId', async () => {
    post({ jobId: 'job-xyz', players: PLAYERS, board: BOARD, maxSims: 80, batchSize: 40 });
    await vi.runAllTimersAsync();
    const msgs = messages();
    expect(msgs.length).toBeGreaterThan(1);
    for (const m of msgs) expect(m.jobId).toBe('job-xyz');
  });

  it('overlapping jobs interleave with correct tagging', async () => {
    post({ jobId: 'a', players: PLAYERS, board: BOARD, maxSims: 80, batchSize: 40 });
    post({ jobId: 'b', players: PLAYERS, board: BOARD, maxSims: 80, batchSize: 40 });
    await vi.runAllTimersAsync();
    expect(messages().map((m) => [m.jobId, m.type])).toEqual([
      ['a', 'batch'], ['b', 'batch'],
      ['a', 'batch'], ['b', 'batch'],
      ['a', 'done'], ['b', 'done'],
    ]);
  });

  it('maxSims 0 posts an immediate done with no batches', async () => {
    post({ jobId: 'j0', players: PLAYERS, board: BOARD, maxSims: 0, batchSize: 50 });
    await vi.runAllTimersAsync();
    expect(messages()).toEqual([{ jobId: 'j0', type: 'done' }]);
  });

  it('terminates on impossible deals', async () => {
    post({ jobId: 'jx', players: [hand('As', 'Kd'), hand('As', 'Qd')], board: [], maxSims: 50, batchSize: 10 });
    for (let i = 0; i < 50 && !messages().some((m) => m.type === 'done'); i++) {
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(messages().some((m) => m.type === 'done')).toBe(true);
  });
});
