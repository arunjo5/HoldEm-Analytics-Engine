// Solver — full-screen view (setup → solving → results). Drives the real CFR
// solve in a Web Worker and streams its progress into the solving screen.
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import './solver.css';
import { PlayingCard } from './Cards.jsx';
import { sideToRangeKeys, combosFromKeys } from './solverEngine.js';
import { SetupView } from './SolverSetup.jsx';
import { ResultsView } from './SolverResults.jsx';

const DEFAULT_BOARD = [null, null, null, null, null];
const DEFAULT_SPOT = { pot: 20, stack: 80, betSizes: [{ id: 'b33', pct: 33, on: true }, { id: 'b75', pct: 75, on: true }, { id: 'b125', pct: 125, on: true }], allIn: true };

function restrictFor(side) {
  if (side && side.kind === 'hand' && (side.cards || []).filter(Boolean).length === 2) {
    const [a, b] = side.cards;
    return new Set([a.v + a.s + b.v + b.s, b.v + b.s + a.v + a.s]);
  }
  return null;
}

function Header({ onExit, theme, onToggleTheme }) {
  return (
    <div className="sv-header">
      <button className="btn btn-ghost sv-back" onClick={onExit}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        Back
      </button>
      <span className="sv-header-sep" />
      <div className="brand-mark"><span className="accent">Poker</span>Lab</div>
      <span className="sv-mode-badge">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M7 14l3-4 3 2 4-6" /></svg>
        Solver
      </span>
      <div className="sv-header-right">
        <button className="icon-btn" onClick={onToggleTheme} aria-label="Toggle theme" title="Toggle theme">{theme === 'dark' ? '☀' : '☾'}</button>
      </div>
    </div>
  );
}

function SolvingView({ spot, board, oopKeys, ipKeys, progress }) {
  const pct = Math.round((progress.pct || 0) * 100);
  const sizeCount = spot.betSizes.length + (spot.allIn ? 1 : 0);
  return (
    <div className="sv-solving">
      <div className="sv-solving-card">
        <div className="sv-solving-top">
          <div className="sv-solving-cards">{board.map((c, i) => c && <PlayingCard key={i} card={c} size="sm" />)}</div>
          <div className="sv-solving-title">Solving heads-up river</div>
          <div className="sv-solving-sub">{combosFromKeys(oopKeys)} × {combosFromKeys(ipKeys)} combos · {sizeCount}-size tree · pot {spot.pot} bb</div>
        </div>
        <div className="sv-solving-bar-wrap">
          <div className="sv-solving-bar-head"><span className="dot-pulse" /> Running CFR iterations<span className="sv-solving-pct">{pct}%</span></div>
          <div className="sv-progress"><div className="sv-progress-fill" style={{ width: pct + '%' }} /></div>
        </div>
        <div className="sv-solving-stats">
          <div className="sv-solving-stat"><div className="sv-solving-stat-label">Iterations</div><div className="sv-solving-stat-val">{(progress.iter || 0).toLocaleString()}</div></div>
          <div className="sv-solving-stat"><div className="sv-solving-stat-label">Exploitability</div><div className="sv-solving-stat-val accent">{(progress.exploit ?? 0).toFixed(2)}<span className="sv-stat-unit">% pot</span></div></div>
          <div className="sv-solving-stat"><div className="sv-solving-stat-label">Target iters</div><div className="sv-solving-stat-val">{(progress.total || 256).toLocaleString()}</div></div>
        </div>
        <div className="sv-solving-note">The solution is for this <strong>fixed bet tree</strong>; convergence only applies to those bet sizes, not the full continuous game.</div>
      </div>
    </div>
  );
}

export function SolverView({ onExit, theme, onToggleTheme }) {
  const [stage, setStage] = useState('setup'); // setup | solving | results
  const [spot, setSpot] = useState(() => JSON.parse(JSON.stringify(DEFAULT_SPOT)));
  const [board, setBoard] = useState(() => DEFAULT_BOARD.slice());
  const [oopSide, setOopSide] = useState(() => ({ kind: 'unset' }));
  const [ipSide, setIpSide] = useState(() => ({ kind: 'unset' }));
  const [progress, setProgress] = useState({ iter: 0, total: 256, exploit: 0, pct: 0 });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const oopKeys = useMemo(() => sideToRangeKeys(oopSide), [oopSide]);
  const ipKeys = useMemo(() => sideToRangeKeys(ipSide), [ipSide]);

  const workerRef = useRef(null);
  const jobRef = useRef(0);
  useEffect(() => {
    const w = new Worker(new URL('./solverWorker.js', import.meta.url), { type: 'module' });
    workerRef.current = w;
    w.onmessage = (e) => {
      const m = e.data;
      if (m.jobId !== jobRef.current) return;
      if (m.type === 'progress') setProgress({ iter: m.iter, total: m.total, exploit: m.exploit, pct: m.pct });
      else if (m.type === 'done') {
        if (m.result && m.result.empty) { setError('No live combos to solve — check the board and ranges.'); setStage('setup'); }
        else { setResult(m.result); setStage('results'); }
      }
      else if (m.type === 'error') { setError(m.message || 'Solve failed'); setStage('setup'); }
    };
    return () => { w.terminate(); workerRef.current = null; };
  }, []);

  const runSolve = useCallback(() => {
    if (!workerRef.current) return;
    setError(null);
    setProgress({ iter: 0, total: 256, exploit: 0, pct: 0 });
    setResult(null);
    setStage('solving');
    const jobId = ++jobRef.current;
    workerRef.current.postMessage({
      jobId, board, oopKeys, ipKeys, spot,
      opts: { oopRestrict: restrictFor(oopSide), ipRestrict: restrictFor(ipSide) },
    });
  }, [board, oopKeys, ipKeys, spot, oopSide, ipSide]);

  return (
    <div className="sv-app">
      <Header onExit={onExit} theme={theme} onToggleTheme={onToggleTheme} />
      <div className="sv-body">
        {error && <div className="sv-error-banner">{error}</div>}
        {stage === 'setup' && (
          <SetupView spot={spot} setSpot={setSpot} board={board} setBoard={setBoard}
            oopSide={oopSide} setOopSide={setOopSide} ipSide={ipSide} setIpSide={setIpSide}
            onSolve={runSolve} />
        )}
        {stage === 'solving' && (
          <SolvingView spot={spot} board={board} oopKeys={oopKeys} ipKeys={ipKeys} progress={progress} />
        )}
        {stage === 'results' && result && (
          <ResultsView spot={spot} board={board} oopSide={oopSide} ipSide={ipSide} oopKeys={oopKeys} ipKeys={ipKeys}
            result={result} onResolve={runSolve} onBackToSetup={() => setStage('setup')} />
        )}
      </div>
    </div>
  );
}
