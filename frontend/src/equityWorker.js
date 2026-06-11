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
      deltaTieShares: r.tieShares,
      deltaValid: r.valid,
    });
    if (r.valid === 0) {
      // impossible deal — no batch will ever make progress
      self.postMessage({ jobId, type: 'done' });
      return;
    }
    setTimeout(runNextBatch, 0);
  }

  runNextBatch();
};
