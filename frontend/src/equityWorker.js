// Web Worker: runs a chunk of Monte Carlo sims off the main thread.
// One worker per CPU core (capped at 8). Main thread aggregates counts.

import { simulate } from './pokerEngine.js';

self.onmessage = (e) => {
  const { players, board, sims, jobId } = e.data;
  const { wins, ties, valid } = simulate(players, board, sims);
  self.postMessage({ jobId, wins, ties, valid });
};
