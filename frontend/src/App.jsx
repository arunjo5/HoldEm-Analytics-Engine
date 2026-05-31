import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import * as PokerEngine from './pokerEngine.js';
import { PlayingCard, EmptyCardSlot, SuitGlyph, SUIT_GLYPH, SUIT_RED } from './Cards.jsx';
import { CardPicker, RangePicker, SUIT_ORDER, VALUE_ORDER } from './Pickers.jsx';
import { PlayerSeat } from './Seat.jsx';
import { useAuth } from './AuthContext.jsx';
import { HistoryDrawer } from './HistoryDrawer.jsx';
import { ShareModal } from './ShareModal.jsx';
import { UploadModal } from './UploadModal.jsx';
import { ReplayerView, readReplayFromUrl } from './Replayer.jsx';
import {
  encodeScenario,
  decodeScenario,
  readScenarioFromUrl,
  buildShareUrl,
} from './scenario.js';

const NAMES_KEY = 'holdem_player_names_v1';
const THEME_KEY = 'holdem_theme_v1';

// 9 seats arranged around the felt with EQUAL ARC LENGTH between neighbours
// (not equal angle) — keeps them evenly spaced even on an elongated felt.
// Player 1 sits at the top.
const SEAT_POSITIONS = (() => {
  const N = 9;
  const cx_pct = 50, cy_pct = 50;
  const rx_pct = 44, ry_pct = 35; // ry pulled in slightly so apex seats clear the toolbar / results panel
  const STAGE_W = 1080, STAGE_H = 600;
  const rxPx = (rx_pct / 100) * STAGE_W;
  const ryPx = (ry_pct / 100) * STAGE_H;

  const SAMPLES = 4000;
  const dtheta = (2 * Math.PI) / SAMPLES;
  const startAngle = -Math.PI / 2;
  const cumLen = [0];
  let total = 0;
  for (let i = 1; i <= SAMPLES; i++) {
    const theta = startAngle + i * dtheta;
    const dx = -rxPx * Math.sin(theta);
    const dy = ryPx * Math.cos(theta);
    total += Math.sqrt(dx * dx + dy * dy) * dtheta;
    cumLen.push(total);
  }
  function thetaAtArc(targetS) {
    let lo = 0, hi = SAMPLES;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumLen[mid] < targetS) lo = mid + 1;
      else hi = mid;
    }
    return startAngle + lo * dtheta;
  }
  const positions = [];
  for (let k = 0; k < N; k++) {
    const theta = thetaAtArc((k / N) * total);
    positions.push({
      x: cx_pct + rx_pct * Math.cos(theta),
      y: cy_pct + ry_pct * Math.sin(theta),
    });
  }
  return positions;
})();

export default function App() {
  const [players, setPlayers] = useState(() => Array(9).fill(null));
  const [board, setBoard] = useState([]);
  const [playerNames, setPlayerNames] = useState(() => {
    try { return JSON.parse(localStorage.getItem(NAMES_KEY) || 'null') || Array(9).fill(null); }
    catch { return Array(9).fill(null); }
  });
  const [picker, setPicker] = useState(null);
  const [boardPicker, setBoardPicker] = useState(null);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) || 'light'; } catch { return 'light'; }
  });
  const [pot, setPot] = useState('');
  const [callAmt, setCallAmt] = useState('');
  const [oddsMode, setOddsMode] = useState('potOdds');
  const [results, setResults] = useState({ perPlayer: {}, sims: 0 });
  const [calculating, setCalculating] = useState(false);
  const calcVersion = useRef(0);
  const inFlightWorkersRef = useRef([]);
  const { user, signIn, signOut } = useAuth();
  const [saving, setSaving] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const lastSavedScenarioRef = useRef(null);
  // Latest committable hand state, kept fresh without saving. Auto-save
  // commits this ONCE at a hand boundary (clear, new deal, load, page exit)
  // — not on every intermediate edit — so building one 5-way spot is 1 row.
  const currentSnapshotRef = useRef(null);

  // ── History / share / shared-link state ──
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  // ── Replayer: calculator vs. hand replayer view ──
  const [view, setView] = useState('calc'); // 'calc' | 'replayer'
  const [replayHand, setReplayHand] = useState(null);
  const [showShare, setShowShare] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [sharedToast, setSharedToast] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [importToast, setImportToast] = useState(null);

  // ── Auto-load a scenario (or shared replay) from the URL hash on first mount ──
  useEffect(() => {
    const rep = readReplayFromUrl();
    if (rep) {
      setReplayHand(rep);
      setView('replayer');
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      return;
    }
    const sc = readScenarioFromUrl();
    if (!sc) return;
    setPlayers(sc.players);
    setBoard(sc.board);
    setPlayerNames(sc.playerNames);
    setPot(sc.pot);
    setCallAmt(sc.callAmt);
    // Treat the shared spot as already-saved; only persist if the user edits it.
    lastSavedScenarioRef.current = encodeScenario({
      players: sc.players, board: sc.board, playerNames: sc.playerNames,
      pot: sc.pot, callAmt: sc.callAmt,
    });
    // strip hash so refreshes don't re-load
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setSharedToast(true);
    const t = setTimeout(() => setSharedToast(false), 3600);
    return () => clearTimeout(t);
  }, []);

  // ── Persist custom player names locally ──
  useEffect(() => {
    try { localStorage.setItem(NAMES_KEY, JSON.stringify(playerNames)); } catch {}
  }, [playerNames]);

  // ── History API ──
  const refreshHistory = useCallback(async () => {
    if (!user) { setHistory([]); return; }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const r = await fetch('/api/searches', { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setHistory((data.searches || []).map(toHistoryItem));
    } catch (e) {
      setHistoryError(e.message || 'Network error');
    } finally {
      setHistoryLoading(false);
    }
  }, [user]);

  function openHistory() {
    setShowHistory(true);
    refreshHistory();
  }

  async function toggleFavorite(id, favorite) {
    setHistory(prev => prev.map(h => h.id === id ? { ...h, starred: favorite } : h));
    try {
      const r = await fetch(`/api/searches/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorite }),
      });
      if (!r.ok) throw new Error('save failed');
    } catch {
      setHistory(prev => prev.map(h => h.id === id ? { ...h, starred: !favorite } : h));
    }
  }

  async function deleteHistoryItem(id) {
    const prev = history;
    setHistory(h => h.filter(x => x.id !== id));
    try {
      const r = await fetch(`/api/searches/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) throw new Error('delete failed');
    } catch {
      setHistory(prev);
    }
  }

  async function clearAllUnfavorited() {
    const toDelete = history.filter(h => !h.starred);
    setHistory(h => h.filter(x => x.starred));
    for (const h of toDelete) {
      fetch(`/api/searches/${h.id}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
    }
  }

  function loadHistoryItem(item) {
    // Replays reopen in the replayer instead of loading into the calculator.
    if (item.isReplay && item.replay) {
      commitToHistory();
      setReplayHand({ ...item.replay, savedId: item.id });
      setView('replayer');
      setShowHistory(false);
      return;
    }
    const sc = decodeScenario(item.scenario);
    if (!sc) return;
    commitToHistory(); // save whatever hand was in progress before replacing it
    setView('calc'); // a calculator scenario opens in the calculator, even from the replayer
    setPlayers(sc.players);
    setBoard(sc.board);
    setPlayerNames(sc.playerNames);
    setPot(sc.pot);
    setCallAmt(sc.callAmt);
    // Don't re-save the item we just loaded unless the user changes it.
    lastSavedScenarioRef.current = encodeScenario({
      players: sc.players, board: sc.board, playerNames: sc.playerNames,
      pot: sc.pot, callAmt: sc.callAmt,
    });
    setShowHistory(false);
  }

  function openShare() {
    setShareUrl(buildShareUrl({ players, board, playerNames, pot, callAmt }));
    setShowShare(true);
  }

  function openReplayer() {
    commitToHistory();
    setReplayHand(null);
    setView('replayer');
    setShowHistory(false);
  }

  // Persist a replay to history (DB-backed, like a normal saved hand but with
  // isReplay + the full replay payload). hand = { setup, actions, board }.
  async function saveReplayToHistory(hand, summary) {
    if (!user) { signIn(); return; }
    const seats = (hand.setup && hand.setup.seats) || [];
    const playersForRow = seats.map(s =>
      s.cards && s.cards.length === 2 ? { kind: 'hand', hand: s.cards } : null
    );
    try {
      const r = await fetch('/api/searches', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: summary && summary.blindsLabel ? `Replay · ${summary.blindsLabel}` : 'Replay',
          players: playersForRow,
          board: hand.board || [],
          odds: {},
          isReplay: true,
          replay: hand,
          favorite: true,
        }),
      });
      if (r.ok && showHistory) refreshHistory();
    } catch {
      /* swallow — replayer shows its own optimistic "Saved" toast */
    }
  }

  function openUpload() {
    if (!user) { signIn(); return; }
    setUploadOpen(true);
  }

  // save each imported hand as a favorited replay, then open history
  async function onImportConfirm(chosen) {
    setUploadOpen(false);
    let saved = 0;
    for (const h of chosen) {
      const seats = (h.replay && h.replay.setup && h.replay.setup.seats) || [];
      const playersForRow = seats.map(s =>
        s.cards && s.cards.length === 2 ? { kind: 'hand', hand: s.cards } : null
      );
      try {
        const r = await fetch('/api/searches', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `PokerNow #${h.number}`,
            players: playersForRow,
            board: (h.replay && h.replay.board) || [],
            odds: {},
            isReplay: true,
            replay: h.replay,
            favorite: true,
          }),
        });
        if (r.ok) saved++;
      } catch { /* skip a failed hand, keep importing the rest */ }
    }
    await refreshHistory();
    setShowHistory(true);
    setImportToast(`${saved} hand${saved === 1 ? '' : 's'} added to history`);
    setTimeout(() => setImportToast(null), 3200);
  }

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }, [theme]);

  const usedCards = useMemo(() => {
    const out = [];
    players.forEach(p => { if (p && p.kind === 'hand') out.push(...p.hand); });
    out.push(...board);
    return out;
  }, [players, board]);

  // Only preflop (0), flop (3), turn (4), river (5) are valid streets.
  const validBoard = board.length === 0 || board.length === 3 || board.length === 4 || board.length === 5;

  useEffect(() => {
    const myVer = ++calcVersion.current;
    const active = players.some(p => p && ((p.kind === 'hand' && p.hand.length === 2) || (p.kind === 'range' && p.range.length > 0)));
    if (!active || !validBoard) { setResults({ perPlayer: {}, sims: 0 }); setCalculating(false); return; }
    setCalculating(true);

    inFlightWorkersRef.current.forEach(w => w.terminate());
    inFlightWorkersRef.current = [];

    const t = setTimeout(() => {
      if (myVer !== calcVersion.current) return;

      const N = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8));
      const MAX_SIMS_TOTAL = 1_000_000;
      const BATCH_SIZE = 5000;
      const SE_THRESHOLD = 0.0005;
      const MIN_SIMS_FOR_CHECK = 10_000;
      const maxPerWorker = Math.ceil(MAX_SIMS_TOTAL / N);

      const workers = [];
      const aggWins = {}, aggTies = {};
      let aggValid = 0;
      let stopped = false;
      let doneCount = 0;

      function buildPerPlayer() {
        const perPlayer = {};
        for (const idx of Object.keys(aggWins)) {
          perPlayer[idx] = {
            win: aggValid ? (aggWins[idx] / aggValid) * 100 : 0,
            tie: aggValid ? (aggTies[idx] / aggValid) * 100 : 0,
            equity: aggValid ? ((aggWins[idx] + aggTies[idx] * 0.5) / aggValid) * 100 : 0,
          };
        }
        return perPlayer;
      }

      function finalize() {
        if (myVer !== calcVersion.current) return;
        workers.forEach(w => w.terminate());
        setResults({ perPlayer: buildPerPlayer(), sims: aggValid });
        setCalculating(false);
      }

      function checkConvergence() {
        if (stopped || aggValid < MIN_SIMS_FOR_CHECK) return;
        let maxSE = 0;
        for (const idx of Object.keys(aggWins)) {
          const p = (aggWins[idx] + 0.5 * aggTies[idx]) / aggValid;
          const se = Math.sqrt(p * (1 - p) / aggValid);
          if (se > maxSE) maxSE = se;
        }
        if (maxSE < SE_THRESHOLD) {
          stopped = true;
          finalize();
        }
      }

      for (let i = 0; i < N; i++) {
        const worker = new Worker(new URL('./equityWorker.js', import.meta.url), { type: 'module' });
        workers.push(worker);
        worker.onmessage = (e) => {
          if (e.data.jobId !== myVer || stopped) return;
          if (e.data.type === 'batch') {
            aggValid += e.data.deltaValid;
            for (const idx of Object.keys(e.data.deltaWins)) {
              aggWins[idx] = (aggWins[idx] || 0) + e.data.deltaWins[idx];
              aggTies[idx] = (aggTies[idx] || 0) + e.data.deltaTies[idx];
            }
            setResults({ perPlayer: buildPerPlayer(), sims: aggValid });
            checkConvergence();
          } else if (e.data.type === 'done') {
            doneCount++;
            if (doneCount === N) finalize();
          }
        };
        worker.postMessage({
          jobId: myVer,
          players,
          board,
          maxSims: maxPerWorker,
          batchSize: BATCH_SIZE,
        });
      }
      inFlightWorkersRef.current = workers;
    }, 30);

    return () => {
      clearTimeout(t);
      inFlightWorkersRef.current.forEach(w => w.terminate());
      inFlightWorkersRef.current = [];
    };
  }, [players, board, validBoard]);

  function openPicker(seatIdx) {
    const existing = players[seatIdx];
    setPicker({
      seat: seatIdx,
      mode: existing && existing.kind === 'range' ? 'range' : 'hand',
      selectedCards: existing && existing.kind === 'hand' ? existing.hand : [],
      initialRange: existing && existing.kind === 'range' ? existing.range : [],
    });
  }
  function closePicker() { setPicker(null); }
  function commitHand(seatIdx, cards) {
    setPlayers(prev => {
      const n = [...prev];
      n[seatIdx] = { kind: 'hand', hand: cards };
      return n;
    });
    setPicker(null);
  }
  function commitRange(seatIdx, keys) {
    setPlayers(prev => {
      const n = [...prev];
      n[seatIdx] = { kind: 'range', range: keys };
      return n;
    });
    setPicker(null);
  }
  function removePlayer(seatIdx) {
    setPlayers(prev => { const n = [...prev]; n[seatIdx] = null; return n; });
  }

  function renamePlayer(seatIdx, newName) {
    setPlayerNames(prev => {
      const n = [...prev];
      n[seatIdx] = newName;
      return n;
    });
  }

  function openBoardPicker(idx) {
    setBoardPicker({ index: idx, selectedCards: board[idx] ? [board[idx]] : [] });
  }
  function commitBoardCard(idx, card) {
    setBoard(prev => {
      const n = [...prev];
      n[idx] = card;
      while (n.length && !n[n.length - 1]) n.pop();
      return n.filter(Boolean);
    });
    setBoardPicker(null);
  }
  function removeBoardCard(idx) {
    setBoard(prev => prev.filter((_, i) => i !== idx));
  }

  const potNum = parseFloat(pot) || 0;
  const callNum = parseFloat(callAmt) || 0;
  const potOddsEntered = potNum > 0 && callNum > 0;
  // pot = pot BEFORE opponent's bet, callAmt = opponent's bet (= what we'd call).
  const potOddsPct = potOddsEntered ? (callNum / (potNum + 2 * callNum)) * 100 : null;
  const mdfPct = potOddsEntered ? (potNum / (potNum + callNum)) * 100 : null;

  function clearAll() {
    commitToHistory();
    setPlayers(Array(9).fill(null));
    setBoard([]);
    setPlayerNames(Array(9).fill(null));
  }

  function saveHand() {
    if (!user) { signIn(); return; }
    setSaveError(null);
    setSaveModalOpen(true);
  }

  async function doSave(name) {
    setSaving(true);
    setSaveError(null);
    const scenario = encodeScenario({ players, board, playerNames, pot, callAmt });
    try {
      const r = await fetch('/api/searches', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || null,
          players,
          board,
          playerNames,
          scenario,
          odds: results.perPlayer || {},
          favorite: true,
        }),
      });
      if (!r.ok) throw new Error('save failed');
      // Mark as already-committed so the boundary auto-save won't duplicate it.
      lastSavedScenarioRef.current = scenario;
      setSaveModalOpen(false);
    } catch {
      setSaveError('Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Keep the current committable hand snapshot fresh (no network) ──
  useEffect(() => {
    const hasActive = players.some(p => p && (
      (p.kind === 'hand' && p.hand.length === 2) ||
      (p.kind === 'range' && p.range.length > 0)
    ));
    if (!hasActive || !validBoard || !results.sims) {
      currentSnapshotRef.current = null;
      return;
    }
    currentSnapshotRef.current = {
      players,
      board,
      playerNames,
      pot,
      callAmt,
      odds: results.perPlayer || {},
      scenario: encodeScenario({ players, board, playerNames, pot, callAmt }),
    };
  }, [results, players, board, playerNames, pot, callAmt, validBoard]);

  // ── Commit the current hand to history (once per distinct hand) ──
  // Called at hand boundaries; deduped so the same spot isn't saved twice.
  const commitToHistory = useCallback((useBeacon = false) => {
    if (!user) return;
    const snap = currentSnapshotRef.current;
    if (!snap || snap.scenario === lastSavedScenarioRef.current) return;
    lastSavedScenarioRef.current = snap.scenario;
    const body = JSON.stringify({
      name: null,
      players: snap.players,
      board: snap.board,
      playerNames: snap.playerNames,
      scenario: snap.scenario,
      odds: snap.odds,
    });
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/searches', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/searches', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => { lastSavedScenarioRef.current = null; });
    }
  }, [user]);

  // ── Commit on page exit (tab close / navigate away / backgrounded) ──
  useEffect(() => {
    if (!user) return;
    const onHide = () => commitToHistory(true);
    const onVis = () => { if (document.visibilityState === 'hidden') commitToHistory(true); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [user, commitToHistory]);

  function dealRandom() {
    commitToHistory();
    const deck = PokerEngine.makeDeck();
    for (let i = deck.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const numPlayers = 2 + ((Math.random() * 8) | 0);
    const seats = Array.from({ length: 9 }, (_, i) => i);
    for (let i = seats.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [seats[i], seats[j]] = [seats[j], seats[i]];
    }
    const chosen = seats.slice(0, numPlayers);
    const newP = Array(9).fill(null);
    for (const s of chosen) newP[s] = { kind: 'hand', hand: [deck.pop(), deck.pop()] };
    // Random street: preflop / flop / turn / river — uniform.
    const STREETS = [0, 3, 4, 5];
    const boardSize = STREETS[(Math.random() * STREETS.length) | 0];
    const newBoard = [];
    for (let i = 0; i < boardSize; i++) newBoard.push(deck.pop());
    setPlayers(newP);
    setBoard(newBoard);
  }

  // Profile menu + history drawer — shared between the calculator and the replayer
  // so a user can open another hand from history without leaving the replayer.
  const userMenuEl = user ? (
    <UserChip user={user} onSignOut={signOut} onOpenHistory={openHistory} />
  ) : (
    <button className="btn btn-signin" onClick={signIn}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="M10 17l5-5-5-5" /><path d="M15 12H3" />
      </svg>
      Sign in
    </button>
  );
  const historyDrawerEl = (
    <HistoryDrawer
      open={showHistory}
      onClose={() => setShowHistory(false)}
      history={history}
      loading={historyLoading}
      error={historyError}
      onLoad={loadHistoryItem}
      onToggleFavorite={toggleFavorite}
      onDelete={deleteHistoryItem}
      onClear={clearAllUnfavorited}
      user={user}
    />
  );

  // The replayer takes over the whole screen when active.
  if (view === 'replayer') {
    return (
      <ReplayerView
        initialHand={replayHand}
        onExit={() => setView('calc')}
        onSaveToHistory={saveReplayToHistory}
        userMenu={userMenuEl}
        historyDrawer={historyDrawerEl}
      />
    );
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark"><span className="accent">Poker</span>Lab</div>
        </div>
        <div className="toolbar">
          {calculating && (
            <div className="status-bar">
              <span className="dot-pulse" /> calculating · {results.sims.toLocaleString()} sims
            </div>
          )}
          <button className="btn btn-ghost" onClick={clearAll}>Clear all</button>
          <button className="btn btn-ghost btn-replayer" onClick={openReplayer} title="Open the hand replayer">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Replayer
          </button>
          <button className="btn btn-ghost btn-share" onClick={openShare} title="Share scenario via link">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
            </svg>
            Share
          </button>
          <button className="btn btn-ghost btn-upload" onClick={openUpload} title="Import hands from a PokerNow log">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4" /><path d="M7 9l5-5 5 5" />
              <path d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
            </svg>
            Upload log
          </button>
          {user && (
            <button className="btn btn-primary" onClick={saveHand} disabled={saving}>
              {saving ? 'Saving…' : 'Favorite'}
            </button>
          )}
          <button className="icon-btn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <div className="topbar-divider" />
          {userMenuEl}
        </div>
      </div>

      <div className="stage-wrap">
        <StageScaler>
          <div className="stage">
            <div className="felt-rim" />
            <div className="felt" />

            {/* Board */}
            <div className={"board-label" + (!validBoard ? ' board-label-warn' : '')}>
              {board.length === 0 ? 'Pre-flop' :
               board.length === 1 ? 'Incomplete flop · need 2 more cards' :
               board.length === 2 ? 'Incomplete flop · need 1 more card' :
               board.length === 3 ? 'Flop' :
               board.length === 4 ? 'Turn' :
               'River'}
            </div>
            <div className="board">
              {Array.from({ length: 5 }).map((_, i) => (
                <BoardSlot
                  key={i}
                  idx={i}
                  card={board[i]}
                  onClick={() => openBoardPicker(i)}
                  onRemove={() => removeBoardCard(i)}
                  active={boardPicker && boardPicker.index === i}
                />
              ))}
            </div>
            {/* Seats */}
            {SEAT_POSITIONS.map((pos, i) => (
              <div key={i} className="seat-wrap" style={{ left: pos.x + '%', top: pos.y + '%' }}>
                <PlayerSeat
                  index={i}
                  player={players[i]}
                  active={picker && picker.seat === i}
                  onOpen={() => openPicker(i)}
                  onRemove={() => removePlayer(i)}
                  equity={results.perPlayer[i] || null}
                  name={playerNames[i]}
                  onRename={(nm) => renamePlayer(i, nm)}
                />
              </div>
            ))}
          </div>
        </StageScaler>
      </div>

      <ResultsPanel
        players={players}
        playerNames={playerNames}
        results={results}
        boardLen={board.length}
        validBoard={validBoard}
        pot={pot} setPot={setPot}
        callAmt={callAmt} setCallAmt={setCallAmt}
        potOddsPct={potOddsPct}
        mdfPct={mdfPct}
        oddsMode={oddsMode} setOddsMode={setOddsMode}
      />

      {picker && (
        <SeatPickerModal
          picker={picker}
          setPicker={setPicker}
          usedCards={usedCards}
          existingPlayer={players[picker.seat]}
          onCancel={closePicker}
          onCommitHand={(cards) => commitHand(picker.seat, cards)}
          onCommitRange={(keys) => commitRange(picker.seat, keys)}
        />
      )}
      {boardPicker && (
        <div className="picker-overlay" onClick={(e) => { if (e.target === e.currentTarget) setBoardPicker(null); }}>
          <CardPicker
            title={`Board card ${boardPicker.index + 1}`}
            usedCards={usedCards.filter(c => !(board[boardPicker.index] && c.v === board[boardPicker.index].v && c.s === board[boardPicker.index].s))}
            selected={boardPicker.selectedCards}
            maxCards={1}
            onPick={(c) => commitBoardCard(boardPicker.index, c)}
            onConfirm={() => boardPicker.selectedCards[0] && commitBoardCard(boardPicker.index, boardPicker.selectedCards[0])}
            onClear={() => { removeBoardCard(boardPicker.index); setBoardPicker(null); }}
            onClose={() => setBoardPicker(null)}
          />
        </div>
      )}

      {historyDrawerEl}
      <ShareModal open={showShare} onClose={() => setShowShare(false)} url={shareUrl} />
      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} onConfirm={onImportConfirm} />
      <SaveModal
        open={saveModalOpen}
        busy={saving}
        error={saveError}
        onClose={() => setSaveModalOpen(false)}
        onSave={doSave}
      />

      {(sharedToast || importToast) && (
        <div className="shared-toast">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          {importToast || 'Loaded shared scenario'}
        </div>
      )}
    </div>
  );
}

// ─── SaveModal — name-and-save a hand (replaces window.prompt) ───
function SaveModal({ open, busy, error, onClose, onSave }) {
  const [name, setName] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setName('');
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="picker-overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="share-modal" role="dialog" aria-label="Save hand">
        <div className="share-head">
          <div>
            <div className="auth-title">Favorite hand</div>
            <div className="auth-sub">Star this spot to keep it in history. Name it, or leave blank.</div>
          </div>
          <button className="modal-x" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>
        <form
          className="share-body"
          onSubmit={(e) => { e.preventDefault(); onSave(name.trim()); }}
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <input
            ref={inputRef}
            className="share-link"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            maxLength={80}
          />
          {error && <div style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Favorite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── UserChip — avatar dropdown in the topbar ───
function UserChip({ user, onSignOut, onOpenHistory }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const initial = (user.name || user.email || '?')[0].toUpperCase();
  const avatar = user.image
    ? <img src={user.image} alt="" className="user-avatar user-avatar-img" />
    : <span className="user-avatar">{initial}</span>;
  return (
    <div className="user-chip-wrap" ref={ref}>
      <button className="user-chip" onClick={() => setOpen(o => !o)}>
        {avatar}
        <span className="user-chip-name">{user.name || user.email}</span>
        <span className="user-chip-caret">▾</span>
      </button>
      {open && (
        <div className="user-menu">
          <div className="user-menu-head">
            <div className="user-menu-name">{user.name || 'Account'}</div>
            <div className="user-menu-email">{user.email}</div>
          </div>
          <button className="user-menu-item" onClick={() => { setOpen(false); onOpenHistory(); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" />
            </svg>
            Hand history
          </button>
          <button className="user-menu-item danger" onClick={() => { setOpen(false); onSignOut(); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Map a Search row from /api/searches to a HistoryRow item ───
function toHistoryItem(s) {
  // Replay rows map straight from the stored replay payload (no equity recompute).
  if (s.isReplay && s.replay) {
    const rep = s.replay;
    const seats = (rep.setup && rep.setup.seats) || [];
    const repBoard = Array.isArray(rep.board) ? rep.board : [];
    const heroSeat = seats.findIndex(x => x && x.cards && x.cards.length === 2);
    const nameOf = (i) => (seats[i] && (seats[i].name || seats[i].pos)) || `Player ${i + 1}`;
    return {
      id: s.id,
      ts: s.createdAt ? new Date(s.createdAt).getTime() : Date.now(),
      name: s.name || null,
      isReplay: true,
      replay: rep,
      scenario: null,
      playerCount: seats.length,
      boardLen: repBoard.length,
      boardPreview: repBoard.slice(0, 5),
      heroCards: heroSeat >= 0 ? seats[heroSeat].cards : null,
      heroLabel: null,
      heroName: heroSeat >= 0 ? nameOf(heroSeat) : null,
      heroEquity: null,
      topName: null,
      topEquity: null,
      blindsLabel: rep.setup ? `${rep.setup.sb}/${rep.setup.bb}` : null,
      actionCount: Array.isArray(rep.actions) ? rep.actions.length : 0,
      starred: !!s.favorite,
    };
  }

  const players = Array.isArray(s.players) ? s.players : [];
  const board = Array.isArray(s.board) ? s.board : [];
  const odds = s.odds || {};
  const playerNames = Array.isArray(s.playerNames) ? s.playerNames : [];

  const activeIdx = players.map((p, i) => p ? i : -1).filter(i => i >= 0);
  const heroIdx = activeIdx.find(i => players[i] && players[i].kind === 'hand') ?? activeIdx[0] ?? 0;
  const hero = players[heroIdx];
  const heroEq = odds[heroIdx];

  let topIdx = activeIdx[0] ?? 0;
  let topEq = -1;
  activeIdx.forEach(i => {
    const e = odds[i];
    if (e && e.equity > topEq) { topEq = e.equity; topIdx = i; }
  });

  const nameOf = (i) => playerNames[i] || `Player ${i + 1}`;
  const scenario = s.scenario || encodeScenario({
    players, board, playerNames,
    pot: s.pot || '', callAmt: s.callAmt || '',
  });

  return {
    id: s.id,
    ts: s.createdAt ? new Date(s.createdAt).getTime() : Date.now(),
    name: s.name || null,
    scenario,
    playerCount: activeIdx.length,
    boardLen: board.length,
    boardPreview: board.slice(0, 5),
    heroCards: hero && hero.kind === 'hand' ? hero.hand : null,
    heroLabel: hero && hero.kind === 'range' ? `${hero.range?.length || 0} combos` : null,
    heroName: nameOf(heroIdx),
    heroEquity: heroEq ? heroEq.equity : null,
    topName: nameOf(topIdx),
    topEquity: topEq >= 0 ? topEq : null,
    starred: !!s.favorite,
  };
}

function StageScaler({ children }) {
  const ref = useRef(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    function update() {
      const el = ref.current;
      if (!el) return;
      const wrap = el.parentElement;
      const wrapW = wrap.clientWidth - 8;
      const s = Math.min(wrapW / 1080, 1);
      setScale(s > 0 ? s : 1);
    }
    update();
    const ro = new ResizeObserver(update);
    if (ref.current && ref.current.parentElement) ro.observe(ref.current.parentElement);
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  return (
    <div ref={ref} className="stage-scaler" style={{
      width: 1080 * scale,
      height: 600 * scale,
    }}>
      <div className="stage-inner" style={{
        width: 1080,
        height: 600,
        transform: `scale(${scale})`,
      }}>
        {children}
      </div>
    </div>
  );
}

function BoardSlot({ idx, card, onClick, onRemove, active }) {
  return (
    <div className="board-slot" style={{ position: 'relative' }}>
      {card ? (
        <button onClick={onClick} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', position: 'relative' }}>
          <PlayingCard card={card} size="lg" />
          <span
            className="board-remove-btn"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
          >×</span>
        </button>
      ) : (
        <button onClick={onClick} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
          <EmptyCardSlot size="lg" label="+" active={active} />
        </button>
      )}
    </div>
  );
}

function SeatPickerModal({ picker, setPicker, usedCards, existingPlayer, onCancel, onCommitHand, onCommitRange }) {
  function setMode(m) { setPicker(p => ({ ...p, mode: m })); }
  function pickHandCard(c) {
    setPicker(p => {
      const sel = [...p.selectedCards];
      const ix = sel.findIndex(x => x.v === c.v && x.s === c.s);
      if (ix >= 0) sel.splice(ix, 1);
      else if (sel.length < 2) sel.push(c);
      return { ...p, selectedCards: sel };
    });
  }
  function clearHand() { setPicker(p => ({ ...p, selectedCards: [] })); }
  function confirmHand() {
    if (picker.selectedCards.length === 2) onCommitHand(picker.selectedCards);
  }

  const ownPrev = existingPlayer && existingPlayer.kind === 'hand' ? existingPlayer.hand : [];
  const ownSet = new Set(ownPrev.map(c => c.v + c.s));
  const usedForPicker = usedCards.filter(c => !ownSet.has(c.v + c.s));

  return (
    <div className="picker-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="picker" style={{ width: 760 }}>
        <div className="picker-head">
          <div>
            <div className="picker-title">Player {picker.seat + 1}</div>
            <div className="picker-sub">
              {picker.mode === 'hand'
                ? `${picker.selectedCards.length} / 2 cards selected`
                : 'Drag to paint cells · click to toggle'}
            </div>
          </div>
          <div className="picker-mode">
            <button className={'picker-tab ' + (picker.mode === 'hand' ? 'active' : '')} onClick={() => setMode('hand')}>Hand</button>
            <button className={'picker-tab ' + (picker.mode === 'range' ? 'active' : '')} onClick={() => setMode('range')}>Range</button>
          </div>
        </div>

        {picker.mode === 'hand' ? (
          <>
            <div style={{ padding: '14px 20px 0', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {Array.from({ length: 2 }).map((_, i) => (
                  picker.selectedCards[i]
                    ? <PlayingCard key={i} card={picker.selectedCards[i]} size="sm" />
                    : <EmptyCardSlot key={i} size="sm" label="" />
                ))}
              </div>
            </div>
            <CardGridOnly
              usedCards={usedForPicker}
              selected={picker.selectedCards}
              onPick={pickHandCard}
            />
            <div className="picker-foot">
              <button className="btn btn-ghost" onClick={clearHand}>Clear</button>
              <div className="picker-foot-right">
                <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
                <button className="btn btn-primary" disabled={picker.selectedCards.length !== 2} onClick={confirmHand}>Confirm hand</button>
              </div>
            </div>
          </>
        ) : (
          <RangePicker
            initial={picker.initialRange}
            onCancel={onCancel}
            onSave={onCommitRange}
          />
        )}
      </div>
    </div>
  );
}

function CardGridOnly({ usedCards, selected, onPick }) {
  const usedSet = new Set(usedCards.map(c => c.v + c.s));
  const selSet = new Set(selected.map(c => c.v + c.s));
  return (
    <div className="picker-grid">
      {SUIT_ORDER.map(s => (
        <div key={s} className="picker-row">
          {VALUE_ORDER.map(v => {
            const id = v + s;
            const isUsed = usedSet.has(id) && !selSet.has(id);
            const isSelected = selSet.has(id);
            return (
              <button
                key={id}
                className={'pcard ' + (isUsed ? 'used ' : '') + (isSelected ? 'selected ' : '') + (SUIT_RED[s] ? 'red ' : 'ink ')}
                disabled={isUsed}
                onClick={() => onPick({ v, s })}
              >
                <span className={"pcard-rank" + (v === 'T' ? ' is-ten' : '')}>{v === 'T' ? '10' : v}</span>
                <span className="pcard-suit"><SuitGlyph suit={s} size={19} color="currentColor" /></span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ResultsPanel({ players, playerNames, results, boardLen, validBoard, pot, setPot, callAmt, setCallAmt, potOddsPct, mdfPct, oddsMode, setOddsMode }) {
  const active = players.map((p, i) => ({ p, i })).filter(x => x.p);
  const nameOf = (i) => (playerNames && playerNames[i]) || `Player ${i + 1}`;
  const haveResults = Object.keys(results.perPlayer).length > 0;

  function describe(p) {
    if (!p) return null;
    if (p.kind === 'hand') return p.hand.map(c => (c.v === 'T' ? '10' : c.v) + SUIT_GLYPH[c.s]).join(' ');
    if (p.kind === 'range') return `Range · ${p.range.length} hands`;
  }

  return (
    <div className="results">
      <div>
        <div className="results-head">
          <div className="results-title">Equity Breakdown</div>
          <div className="results-meta">
            {!validBoard
              ? `board needs 0, 3, 4, or 5 cards · currently ${boardLen}`
              : haveResults && oddsMode === 'potOdds' && potOddsPct != null
                ? `pot odds threshold: ${potOddsPct.toFixed(1)}%`
                : haveResults && oddsMode === 'mdf' && mdfPct != null
                  ? `min defense frequency: ${mdfPct.toFixed(1)}%`
                  : ''}
          </div>
        </div>
        {active.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>
            Click any seat to deal cards or assign a range.
          </div>
        ) : (
          <table className="results-table">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Player</th>
                <th style={{ width: 160 }}>Holding</th>
                <th className="num">Win</th>
                <th className="num">Tie</th>
                <th className="num">Equity</th>
                <th className="equity-cell">Vs. pot odds</th>
              </tr>
            </thead>
            <tbody>
              {active.map(({ p, i }) => {
                const eq = results.perPlayer[i];
                const equity = eq ? eq.equity : 0;
                const beatsPotOdds = potOddsPct != null && equity >= potOddsPct;
                const useColor = oddsMode === 'potOdds' && potOddsPct != null;
                const rowClass = !useColor ? 'eq-row-neutral' : (beatsPotOdds ? 'eq-row-pos' : 'eq-row-neg');
                return (
                  <tr key={i} className={rowClass}>
                    <td>
                      <div className="player-cell">
                        <span className="player-dot" style={{ background: !useColor ? 'var(--text-faint)' : (beatsPotOdds ? 'var(--green)' : 'var(--gold)') }} />
                        {nameOf(i)}
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-dim)' }}>{describe(p)}</td>
                    <td className="num">{eq ? eq.win.toFixed(1) + '%' : '-'}</td>
                    <td className="num">{eq ? eq.tie.toFixed(1) + '%' : '-'}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{eq ? eq.equity.toFixed(1) + '%' : '-'}</td>
                    <td className="equity-cell">
                      <div className="eq-track"><div className="eq-track-fill" style={{ width: equity + '%' }} /></div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className={"pot-odds" + ((oddsMode === 'mdf' ? mdfPct : potOddsPct) == null ? ' pot-odds-empty' : '')}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <h4>{oddsMode === 'mdf' ? 'MDF' : 'Pot Odds'}</h4>
          <div className="odds-toggle" role="tablist">
            <button type="button" className={'odds-toggle-btn ' + (oddsMode === 'potOdds' ? 'active' : '')} onClick={() => setOddsMode('potOdds')}>Pot Odds</button>
            <button type="button" className={'odds-toggle-btn ' + (oddsMode === 'mdf' ? 'active' : '')} onClick={() => setOddsMode('mdf')}>MDF</button>
          </div>
        </div>
        <div className="pot-input-row">
          <div className="pot-input-wrap">
            <label>{oddsMode === 'mdf' ? 'Pot (before bet)' : 'Pot'}</label>
            <input className="pot-input" type="number" min="0" placeholder="0" value={pot} onChange={e => setPot(e.target.value)} />
          </div>
          <div className="pot-input-wrap">
            <label>{oddsMode === 'mdf' ? 'Bet' : 'To call'}</label>
            <input className="pot-input" type="number" min="0" placeholder="0" value={callAmt} onChange={e => setCallAmt(e.target.value)} />
          </div>
        </div>
        {oddsMode === 'mdf' ? (
          <>
            <div className="pot-result">
              <div className="pot-result-row">
                <span className="lbl">MDF</span>
                <span className="val">{mdfPct == null ? 'N/A' : mdfPct.toFixed(1) + '%'}</span>
              </div>
              <div className="pot-result-row">
                <span className="lbl">Bet : pot</span>
                <span className="val" style={{ fontSize: 13 }}>
                  {mdfPct == null
                    ? 'N/A'
                    : <>{callAmt}<span style={{ color: 'var(--text-dim)', margin: '0 4px' }}>into</span>{pot}</>}
                </span>
              </div>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-faint)', lineHeight: 1.5, letterSpacing: 0.01, marginTop: 4 }}>
              {mdfPct == null
                ? ''
                : 'Defend at least this share of your continuing range to remain unexploitable to bluffs.'}
            </div>
          </>
        ) : (
          <>
            <div className="pot-result">
              <div className="pot-result-row">
                <span className="lbl">Pot odds</span>
                <span className="val">{potOddsPct == null ? 'N/A' : potOddsPct.toFixed(1) + '%'}</span>
              </div>
              <div className="pot-result-row">
                <span className="lbl">Risk : reward</span>
                <span className="val" style={{ fontSize: 13 }}>
                  {potOddsPct == null
                    ? 'N/A'
                    : <>{callAmt}<span style={{ color: 'var(--text-dim)', margin: '0 4px' }}>to win</span>{(parseFloat(pot) || 0) + (parseFloat(callAmt) || 0)}</>}
                </span>
              </div>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-faint)', lineHeight: 1.5, letterSpacing: 0.01, marginTop: 4 }}>
              {potOddsPct == null
                ? ''
                : "A call is profitable when a player's equity exceeds the pot odds threshold."}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
