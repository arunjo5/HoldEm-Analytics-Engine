// Web Worker: runs Monte Carlo sims in small batches, yielding between
// batches so it can be preempted. Posts per-batch deltas to the main thread,
// which aggregates globally and terminates workers when SE drops below the
// convergence threshold.

import { simulate } from './pokerEngine.js';

self.onmessage = (e) => {
  const { jobId, players, board, maxSims, batchSize } = e.data;
  let totalRun = 0;

  function runNextBatch() {
    if (totalRun >= maxSims) {
      self.postMessage({ jobId, type: 'done' });
      return;
    }
    const target = Math.min(batchSize, maxSims - totalRun);
    const r = simulate(players, board, target);
    totalRun += r.valid;
    self.postMessage({
      jobId,
      type: 'batch',
      deltaWins: r.wins,
      deltaTies: r.ties,
      deltaValid: r.valid,
    });
    // Yield to the event loop so a `terminate()` from main can take effect.
    setTimeout(runNextBatch, 0);
  }

  runNextBatch();
};
