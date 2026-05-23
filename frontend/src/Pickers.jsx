import React, { useState, useRef, useEffect, useMemo } from 'react';
import { PlayingCard, EmptyCardSlot, SuitGlyph, SUIT_RED } from './Cards.jsx';

export const SUIT_ORDER = ['s', 'h', 'c', 'd'];
export const VALUE_ORDER = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];

export function CardPicker({
  usedCards,
  selected,
  onPick,
  maxCards = 2,
  onClose,
  onClear,
  onConfirm,
  title = 'Pick 2 cards',
}) {
  const usedSet = useMemo(() => new Set(usedCards.map(c => c.v + c.s)), [usedCards]);
  const selSet = useMemo(() => new Set(selected.map(c => c.v + c.s)), [selected]);

  return (
    <div className="picker">
      <div className="picker-head">
        <div>
          <div className="picker-title">{title}</div>
          <div className="picker-sub">{selected.length} / {maxCards} selected</div>
        </div>
        <div className="picker-selected">
          {Array.from({ length: maxCards }).map((_, i) => (
            selected[i]
              ? <PlayingCard key={i} card={selected[i]} size="sm" />
              : <EmptyCardSlot key={i} size="sm" label="" />
          ))}
        </div>
      </div>

      <div className="picker-grid">
        {SUIT_ORDER.map(s => (
          <div key={s} className="picker-row">
            {VALUE_ORDER.map(v => {
              const card = { v, s };
              const id = v + s;
              const isUsed = usedSet.has(id) && !selSet.has(id);
              const isSelected = selSet.has(id);
              return (
                <button
                  key={id}
                  className={'pcard ' + (isUsed ? 'used ' : '') + (isSelected ? 'selected ' : '') + (SUIT_RED[s] ? 'red ' : 'ink ')}
                  disabled={isUsed}
                  onClick={() => onPick(card)}
                  aria-label={v + ' of ' + s}
                >
                  <span className={"pcard-rank" + (v === 'T' ? ' is-ten' : '')}>{v === 'T' ? '10' : v}</span>
                  <span className="pcard-suit"><SuitGlyph suit={s} size={19} color="currentColor" /></span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="picker-foot">
        <button className="btn btn-ghost" onClick={onClear}>Clear</button>
        <div className="picker-foot-right">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={selected.length !== maxCards} onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

export const RANK_ORDER = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];
const RANK_VAL = {'A':14,'K':13,'Q':12,'J':11,'T':10,'9':9,'8':8,'7':7,'6':6,'5':5,'4':4,'3':3,'2':2};

export function rangeKey(r, c) {
  const a = RANK_ORDER[r], b = RANK_ORDER[c];
  if (r === c) return a + b;
  if (r < c) return a + b + 's';
  return b + a + 'o';
}

function comboCount(key) {
  if (key.length === 2) return 6;
  return key.endsWith('s') ? 4 : 12;
}

function buildHandRanking() {
  const all = [];
  for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) all.push(rangeKey(r, c));
  function score(key) {
    const a = RANK_VAL[key[0]], b = RANK_VAL[key[1]];
    if (a === b) return 200 + a * 6;
    const high = Math.max(a, b), low = Math.min(a, b);
    const gap = high - low;
    let s = high * 4 + low * 2;
    if (key[2] === 's') s += 20;
    if (gap === 1) s += 8;
    else if (gap === 2) s += 4;
    else if (gap === 3) s += 2;
    return s;
  }
  all.sort((a, b) => score(b) - score(a));
  return all;
}
const HAND_RANKING = buildHandRanking();

function topRangeByPercent(pct) {
  if (pct <= 0) return [];
  const target = (pct / 100) * 1326;
  const out = [];
  let combos = 0;
  for (const k of HAND_RANKING) {
    out.push(k);
    combos += comboCount(k);
    if (combos >= target) break;
  }
  return out;
}

function combosFromKeys(keys) {
  let n = 0;
  for (const k of keys) n += comboCount(k);
  return n;
}

const PRESETS = [
  { label: 'Empty', keys: [] },
  { label: 'Top 5%', keys: ['AA','KK','QQ','JJ','TT','AKs','AKo','AQs'] },
  { label: 'Top 10%', keys: ['AA','KK','QQ','JJ','TT','99','88','AKs','AKo','AQs','AQo','AJs','KQs'] },
  { label: 'Top 20%', keys: ['AA','KK','QQ','JJ','TT','99','88','77','66','55','AKs','AKo','AQs','AQo','AJs','AJo','ATs','KQs','KQo','KJs','KTs','QJs','QTs','JTs','T9s','98s','87s','76s','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s'] },
  { label: 'Pairs only', keys: ['AA','KK','QQ','JJ','TT','99','88','77','66','55','44','33','22'] },
  { label: 'Suited Ax', keys: ['A2s','A3s','A4s','A5s','A6s','A7s','A8s','A9s','ATs','AJs','AQs','AKs'] },
  { label: 'Broadways', keys: ['AKs','AQs','AJs','ATs','KQs','KJs','KTs','QJs','QTs','JTs','AKo','AQo','AJo','ATo','KQo','KJo','KTo','QJo','QTo','JTo'] },
  { label: 'All hands', keys: 'ALL' },
];

export function RangePicker({ initial, onCancel, onSave }) {
  const [keys, setKeys] = useState(() => new Set(initial || []));
  const [dragMode, setDragMode] = useState(null); // 'on' | 'off'
  const dragging = useRef(false);

  function toggle(k, mode) {
    setKeys(prev => {
      const n = new Set(prev);
      if (mode === 'on') n.add(k);
      else if (mode === 'off') n.delete(k);
      else { if (n.has(k)) n.delete(k); else n.add(k); }
      return n;
    });
  }

  useEffect(() => {
    const up = () => { dragging.current = false; setDragMode(null); };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const total = 1326;
  const totalCombos = useMemo(() => combosFromKeys(keys), [keys]);
  const pct = (totalCombos / total) * 100;

  function applyPreset(p) {
    if (p.keys === 'ALL') {
      const all = new Set();
      for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) all.add(rangeKey(r, c));
      setKeys(all);
    } else {
      setKeys(new Set(p.keys));
    }
  }

  function onSliderChange(value) {
    const v = parseFloat(value);
    setKeys(new Set(topRangeByPercent(v)));
  }

  return (
    <div className="picker picker-range">
      <div className="picker-head">
        <div>
          <div className="picker-title">Select hand range</div>
          <div className="picker-sub">{totalCombos} combos · {pct.toFixed(1)}% of all hands</div>
        </div>
        <div className="range-presets">
          <select onChange={e => {
            const p = PRESETS[parseInt(e.target.value, 10)];
            if (p) applyPreset(p);
            e.target.value = '';
          }} defaultValue="">
            <option value="" disabled>Preset…</option>
            {PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
          </select>
        </div>
      </div>

      <div className="range-slider-row">
        <span className="range-slider-label">Top</span>
        <input
          type="range"
          min="0"
          max="100"
          step="0.5"
          value={pct.toFixed(1)}
          onChange={e => onSliderChange(e.target.value)}
          className="range-slider"
        />
        <span className="range-slider-val">{pct.toFixed(1)}%</span>
      </div>

      <div className="rg-grid" onMouseLeave={() => { dragging.current = false; setDragMode(null); }}>
        {Array.from({ length: 13 }).map((_, r) => (
          Array.from({ length: 13 }).map((_, c) => {
            const k = rangeKey(r, c);
            const active = keys.has(k);
            const isPair = r === c;
            const isSuited = r < c;
            const baseClass = 'rg-cell ' + (isPair ? 'pair' : isSuited ? 'suited' : 'offsuit');
            let style = {};
            if (active) {
              if (isPair) style = { background: 'var(--gold)', color: '#1a1208', fontWeight: 600 };
              else if (isSuited) style = { background: 'var(--blue)', color: '#fff', fontWeight: 500 };
              else style = { background: 'rgba(255,255,255,0.7)', color: '#1a1208', fontWeight: 500 };
            }
            return (
              <div
                key={k}
                className={baseClass}
                style={style}
                onMouseDown={(e) => {
                  e.preventDefault();
                  dragging.current = true;
                  const next = !active ? 'on' : 'off';
                  setDragMode(next);
                  toggle(k, next);
                }}
                onMouseEnter={() => {
                  if (dragging.current && dragMode) toggle(k, dragMode);
                }}
              >
                <span>{k}</span>
              </div>
            );
          })
        ))}
      </div>

      <div className="picker-foot">
        <button className="btn btn-ghost" onClick={() => setKeys(new Set())}>Clear</button>
        <div className="picker-foot-right">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={keys.size === 0} onClick={() => onSave(Array.from(keys))}>Save range</button>
        </div>
      </div>
    </div>
  );
}
