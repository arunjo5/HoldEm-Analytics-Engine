// Runs the heads-up river CFR solve off the main thread, streaming progress
// (iteration + exploitability) back to the UI's solving screen.
import { solve } from './solverEngine.js';

self.onmessage = (e) => {
  const { jobId, board, oopKeys, ipKeys, spot, opts } = e.data;
  try {
    const result = solve(board, oopKeys, ipKeys, spot, opts || {}, (p) => {
      self.postMessage({ jobId, type: 'progress', ...p });
    });
    self.postMessage({ jobId, type: 'done', result });
  } catch (err) {
    self.postMessage({ jobId, type: 'error', message: String((err && err.message) || err) });
  }
};
