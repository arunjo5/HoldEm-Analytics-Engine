import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as PokerEngine from './pokerEngine.js';
import { PlayingCard, EmptyCardSlot, SuitGlyph, SUIT_GLYPH, SUIT_RED } from './Cards.jsx';
import { CardPicker, RangePicker, SUIT_ORDER, VALUE_ORDER } from './Pickers.jsx';
import { PlayerSeat } from './Seat.jsx';

// 9 seats around the felt, evenly spaced, P1 at top.
const SEAT_POSITIONS = (() => {
  const positions = [];
  const N = 9;
  const cx = 50, cy = 50;
  const rx = 44, ry = 42;
  for (let i = 0; i < N; i++) {
    const rad = ((360 / N) * i - 90) * Math.PI / 180;
    positions.push({
      x: cx + rx * Math.cos(rad),
      y: cy + ry * Math.sin(rad),
    });
  }
  return positions;
})();

export default function App() {
  const [players, setPlayers] = useState(() => Array(9).fill(null));
  const [board, setBoard] = useState([]);
  const [picker, setPicker] = useState(null);
  const [boardPicker, setBoardPicker] = useState(null);
  const [theme, setTheme] = useState('dark');
  const [pot, setPot] = useState('');
  const [callAmt, setCallAmt] = useState('');
  const [results, setResults] = useState({ perPlayer: {}, sims: 0 });
  const [calculating, setCalculating] = useState(false);
  const calcVersion = useRef(0);
  const inFlightWorkersRef = useRef([]);

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
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
  const potOddsPct = potOddsEntered ? (callNum / (potNum + callNum)) * 100 : null;

  function clearAll() {
    setPlayers(Array(9).fill(null));
    setBoard([]);
  }

  function dealRandom() {
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
    setPlayers(newP);
    setBoard([]);
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark"><span className="accent">Hold'</span>Em</div>
          <div className="brand-sub">Analytics Engine</div>
        </div>
        <div className="toolbar">
          {calculating && (
            <div className="status-bar">
              <span className="dot-pulse" /> calculating · {results.sims.toLocaleString()} sims
            </div>
          )}
          <button className="btn btn-ghost" onClick={dealRandom}>Deal sample</button>
          <button className="btn btn-ghost" onClick={clearAll}>Clear all</button>
          <button className="icon-btn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
            {theme === 'dark' ? '☾' : '☀'}
          </button>
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
                />
              </div>
            ))}
          </div>
        </StageScaler>
      </div>

      <ResultsPanel
        players={players}
        results={results}
        boardLen={board.length}
        validBoard={validBoard}
        pot={pot} setPot={setPot}
        callAmt={callAmt} setCallAmt={setCallAmt}
        potOddsPct={potOddsPct}
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
    </div>
  );
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

function ResultsPanel({ players, results, boardLen, validBoard, pot, setPot, callAmt, setCallAmt, potOddsPct }) {
  const active = players.map((p, i) => ({ p, i })).filter(x => x.p);
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
              : haveResults && potOddsPct != null
                ? `pot odds threshold: ${potOddsPct.toFixed(1)}%`
                : haveResults
                  ? 'enter pot & call to compare vs. pot odds'
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
                const rowClass = potOddsPct == null ? 'eq-row-neutral' : (beatsPotOdds ? 'eq-row-pos' : 'eq-row-neg');
                return (
                  <tr key={i} className={rowClass}>
                    <td>
                      <div className="player-cell">
                        <span className="player-dot" style={{ background: potOddsPct == null ? 'var(--text-faint)' : (beatsPotOdds ? 'var(--green)' : 'var(--gold)') }} />
                        Player {i + 1}
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

      <div className={"pot-odds" + (potOddsPct == null ? ' pot-odds-empty' : '')}>
        <h4>Pot Odds</h4>
        <div className="pot-input-row">
          <div className="pot-input-wrap">
            <label>Pot</label>
            <input className="pot-input" type="number" min="0" placeholder="0" value={pot} onChange={e => setPot(e.target.value)} />
          </div>
          <div className="pot-input-wrap">
            <label>To call</label>
            <input className="pot-input" type="number" min="0" placeholder="0" value={callAmt} onChange={e => setCallAmt(e.target.value)} />
          </div>
        </div>
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
                : <>{callAmt}<span style={{ color: 'var(--text-dim)', margin: '0 4px' }}>to win</span>{pot}</>}
            </span>
          </div>
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-faint)', lineHeight: 1.5, letterSpacing: 0.01, marginTop: 4 }}>
          {potOddsPct == null
            ? 'Enter pot size and call amount to compare against player equities.'
            : "A call is profitable when a player's equity exceeds the pot odds threshold."}
        </div>
      </div>
    </div>
  );
}
