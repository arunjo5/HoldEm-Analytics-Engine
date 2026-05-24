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
    setTimeout(runNextBatch, 0);
  }

  runNextBatch();
};
