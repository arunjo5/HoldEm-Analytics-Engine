// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const card = (s) => ({ v: s[0], s: s[1] });
const board = (...cs) => cs.map(card);
const sizes = (...pcts) => pcts.map((p) => ({ id: 'b' + p, pct: p, on: true }));

const BOARD = board('Ks', '7d', '2c', '8h', '3s');
const SPOT = { pot: 20, stack: 80, betSizes: sizes(75), allIn: false };
const tinyJob = (over = {}) => ({
  jobId: 'j1', board: BOARD, oopKeys: ['AA'], ipKeys: ['QQ'],
  spot: SPOT, opts: { iterations: 32 }, ...over,
});

// the worker wires itself to the `self` global at import time
globalThis.self = { postMessage: vi.fn() };
await import('./solverWorker.js');

const post = (data) => self.onmessage({ data });
const messages = () => self.postMessage.mock.calls.map(([m]) => m);

beforeEach(() => self.postMessage.mockClear());

describe('solverWorker message protocol', () => {
  it('streams progress then exactly one done, all tagged with the jobId', () => {
    post(tinyJob());
    const msgs = messages();
    const progress = msgs.filter((m) => m.type === 'progress');
    const done = msgs.filter((m) => m.type === 'done');
    expect(progress.length).toBeGreaterThanOrEqual(1);
    expect(done).toHaveLength(1);
    expect(msgs.at(-1).type).toBe('done');
    for (const m of msgs) expect(m.jobId).toBe('j1');
  });

  it('progress messages carry iter/total/exploit/pct and end at pct 1', () => {
    post(tinyJob());
    const progress = messages().filter((m) => m.type === 'progress');
    for (const p of progress) {
      expect(p.total).toBe(32);
      expect(p.iter).toBeGreaterThanOrEqual(1);
      expect(p.iter).toBeLessThanOrEqual(32);
      expect(p.exploit).toBeGreaterThanOrEqual(0);
      expect(p.pct).toBe(p.iter / p.total);
    }
    const last = progress.at(-1);
    expect(last.iter).toBe(last.total);
    expect(last.pct).toBe(1);
  });

  it('done carries the full solve result', () => {
    post(tinyJob());
    const { result } = messages().find((m) => m.type === 'done');
    expect(result.nodes.map((n) => n.id)).toEqual(['oop_first', 'ip_vs_check', 'ip_vs_bet', 'oop_vs_bet']);
    expect(Object.keys(result.nodeSolves)).toEqual(['oop_first', 'ip_vs_check', 'ip_vs_bet', 'oop_vs_bet']);
    expect(result.nodeSolves.oop_first.combos.length).toBeGreaterThan(0);
    expect(result.meta).toMatchObject({ potBb: 20, iterations: 32 });
    expect(result.meta.evOOP + result.meta.evIP).toBeCloseTo(20, 6);
    expect(result.trace.length).toBeGreaterThan(0);
    expect(result.oopCount).toBe(6);
    expect(result.ipCount).toBe(6);
  });

  it('missing opts falls back to the 256-iteration default', () => {
    post(tinyJob({ jobId: 'j-def', opts: undefined }));
    const msgs = messages();
    const done = msgs.find((m) => m.type === 'done');
    expect(done.result.meta.iterations).toBe(256);
    expect(msgs.filter((m) => m.type === 'progress').at(-1).total).toBe(256);
  });

  it('undefined spot posts a single error with a string message and no done', () => {
    post(tinyJob({ jobId: 'j-err', spot: undefined }));
    const msgs = messages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('error');
    expect(msgs[0].jobId).toBe('j-err');
    expect(typeof msgs[0].message).toBe('string');
    expect(msgs[0].message.length).toBeGreaterThan(0);
  });

  it('garbage board posts an error, not done', () => {
    post(tinyJob({ jobId: 'j-bad', board: null }));
    const msgs = messages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ jobId: 'j-bad', type: 'error' });
    expect(typeof msgs[0].message).toBe('string');
  });

  it('echoes a falsy jobId verbatim on every message', () => {
    post(tinyJob({ jobId: 0 }));
    const msgs = messages();
    expect(msgs.length).toBeGreaterThan(1);
    for (const m of msgs) expect(m.jobId).toBe(0);
    post(tinyJob({ jobId: 0, spot: undefined }));
    expect(messages().at(-1)).toMatchObject({ jobId: 0, type: 'error' });
  });

  it('an all-blocked matchup posts a done with an empty result and no progress', () => {
    post(tinyJob({
      jobId: 'j-empty', oopKeys: ['AA'], ipKeys: ['AA'],
      opts: { iterations: 8, oopRestrict: new Set(['AsAh']), ipRestrict: new Set(['AsAh']) },
    }));
    const msgs = messages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ jobId: 'j-empty', type: 'done' });
    expect(msgs[0].result).toMatchObject({ empty: true });
    expect(msgs.some((m) => m.type === 'progress')).toBe(false);
  });

  it('forwards opts.oopRestrict into the solve, thinning the range to one combo', () => {
    post(tinyJob({ jobId: 'j-restrict', oopKeys: ['AA'], opts: { iterations: 16, oopRestrict: new Set(['AsAh']) } }));
    const done = messages().find((m) => m.type === 'done');
    expect(done.result.oopCount).toBe(1);
    expect(done.result.nodeSolves.oop_first.combos.map((c) => c.id)).toEqual(['AsAh']);
  });

  it('handles sequential jobs independently, tagging each batch with its own id', () => {
    post(tinyJob({ jobId: 'a' }));
    expect(messages().at(-1)).toMatchObject({ jobId: 'a', type: 'done' });
    self.postMessage.mockClear();
    post(tinyJob({ jobId: 'b' }));
    const msgs = messages();
    expect(msgs.length).toBeGreaterThan(1);
    for (const m of msgs) expect(m.jobId).toBe('b');
    expect(msgs.at(-1).type).toBe('done');
  });
});
