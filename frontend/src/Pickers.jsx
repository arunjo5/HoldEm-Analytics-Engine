import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useLibrary } from './LibraryContext.jsx';
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

// Expand standard range notation ("44+, A2s+, K9s+, T9s, ATo+, A4s-A5s") into hand keys.
const RIDX = Object.fromEntries(RANK_ORDER.map((r, i) => [r, i])); // A=0 (best) … 2=12

function expandToken(tok) {
  tok = tok.trim();
  if (!tok) return [];
  if (tok.includes('-')) { // dash range, e.g. 55-99 or A4s-A5s
    const [a, b] = tok.split('-').map(s => s.trim());
    const out = [];
    if (a.length === 2 && a[0] === a[1]) {
      for (let i = Math.min(RIDX[a[0]], RIDX[b[0]]); i <= Math.max(RIDX[a[0]], RIDX[b[0]]); i++) out.push(RANK_ORDER[i] + RANK_ORDER[i]);
    } else {
      const hi = a[0], suit = a[2]; // same high card + suitedness, varying low card
      for (let i = Math.min(RIDX[a[1]], RIDX[b[1]]); i <= Math.max(RIDX[a[1]], RIDX[b[1]]); i++) out.push(hi + RANK_ORDER[i] + suit);
    }
    return out;
  }
  const plus = tok.endsWith('+');
  const core = plus ? tok.slice(0, -1) : tok;
  if (core.length === 2 && core[0] === core[1]) { // pair
    if (!plus) return [core];
    const out = [];
    for (let i = RIDX[core[0]]; i >= 0; i--) out.push(RANK_ORDER[i] + RANK_ORDER[i]);
    return out;
  }
  const hi = core[0], lo = core[1], suit = core[2]; // suited / offsuit
  if (!plus) return [hi + lo + suit];
  const out = [];
  for (let i = RIDX[lo]; i > RIDX[hi]; i--) out.push(hi + RANK_ORDER[i] + suit);
  return out;
}

export function expandNotation(notation) {
  const out = new Set();
  for (const tok of notation.split(',')) for (const k of expandToken(tok)) out.add(k);
  return [...out];
}

// Standard RFI (raise-first-in) opening ranges by position.
const POS_6MAX = [
  ['UTG',         '44+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, ATo+, KJo+'],
  ['UTG+1',       '22+, A2s+, K8s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, 65s, 54s, ATo+, KTo+, QJo, JTo'],
  ['Cutoff',      '22+, A2s+, K6s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, 43s, 32s, A8o+, A5o, KTo+, QTo+, JTo, T9o, 98o'],
  ['Button',      '22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 95s+, 85s+, 74s+, 63s+, 53s+, 43s, 32s, A2o+, K7o+, Q9o+, J9o+, T9o, 98o'],
  ['Small Blind', '22+, A2s+, K2s+, Q3s+, J4s+, T4s+, 94s+, 84s+, 73s+, 63s+, 53s+, 43s, 32s, A2o+, K4o+, Q8o+, J9o+, T9o, 98o'],
];
const POS_9MAX = [
  ['UTG',         '77+, ATs+, A5s, KTs+, QTs+, J9s+, T9s, 98s, AQo+'],
  ['UTG+1',       '77+, ATs+, A5s, KTs+, QTs+, J9s+, T9s, 98s, AQo+'],
  ['UTG+2',       '77+, A8s+, A4s-A5s, K9s+, Q9s+, J9s+, T9s, 98s, AJo+'],
  ['Lojack',      '44+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, ATo+, KJo+'],
  ['Hijack',      '22+, A2s+, K8s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, 65s, 54s, ATo+, KTo+, QJo, JTo'],
  ['Cutoff',      '22+, A2s+, K6s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, 43s, 32s, A8o+, A5o, KTo+, QTo+, JTo, T9o, 98o'],
  ['Button',      '22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 95s+, 85s+, 74s+, 63s+, 53s+, 43s, 32s, A2o+, K7o+, Q9o+, J9o+, T9o, 98o'],
  ['Small Blind', '22+, A2s+, K2s+, Q3s+, J4s+, T4s+, 94s+, 84s+, 73s+, 63s+, 53s+, 43s, 32s, A2o+, K4o+, Q8o+, J9o+, T9o, 98o'],
];

const PRESET_GROUPS = [
  { label: '6-max opening ranges', presets: POS_6MAX.map(([label, n]) => ({ label, keys: expandNotation(n) })) },
  { label: '9-max opening ranges', presets: POS_9MAX.map(([label, n]) => ({ label, keys: expandNotation(n) })) },
];

// Themed preset dropdown (replaces the native <select> so it matches the app).
function PresetMenu({ groups, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div className="preset-menu-wrap" ref={ref}>
      <button type="button" className="preset-trigger" onClick={() => setOpen(o => !o)}>
        Preset… <span className="preset-caret">▾</span>
      </button>
      {open && (
        <div className="preset-menu">
          {groups.map(g => (
            <div key={g.label} className="preset-group">
              <div className="preset-group-label">{g.label}</div>
              {g.presets.map(p => (
                <button type="button" key={p.label} className="preset-item" onClick={() => { onPick(p); setOpen(false); }}>
                  {p.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// saved ranges dropdown, next to the presets
function MyRangesMenu({ lib, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div className="preset-menu-wrap" ref={ref}>
      <button type="button" className="preset-trigger" onClick={() => setOpen(o => !o)}>
        My ranges <span className="preset-caret">▾</span>
      </button>
      {open && (
        <div className="preset-menu myranges-menu">
          {lib.ranges.length === 0 ? (
            <div className="myranges-empty">{lib.rangesLoaded ? 'No saved ranges yet' : 'Loading…'}</div>
          ) : lib.ranges.map(r => (
            <div key={r.id} className="myrange-row">
              <button type="button" className="myrange-item" onClick={() => { onPick(r); setOpen(false); }}>
                <span className="myrange-name">{r.name}</span>
                <span className="myrange-count">{combosFromKeys(r.keys)} combos</span>
              </button>
              <button type="button" className="myrange-del" aria-label={`Delete ${r.name}`} title="Delete" onClick={() => lib.deleteRange(r.id)}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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

  // account library: pick a saved range, or save this one
  const lib = useLibrary();
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveMsg, setSaveMsg] = useState(null); // { kind: 'ok' | 'err' | 'limit', text }
  const [saving, setSaving] = useState(false);
  const { available: libAvailable, rangesLoaded, refreshRanges } = lib;
  useEffect(() => { if (libAvailable && !rangesLoaded) refreshRanges(); }, [libAvailable, rangesLoaded, refreshRanges]);

  async function saveToLibrary(e) {
    e.preventDefault();
    const name = saveName.trim();
    if (!name || saving) return;
    setSaving(true);
    const res = await lib.saveRange(name, Array.from(keys));
    setSaving(false);
    if (res.ok) { setSaveMsg({ kind: 'ok', text: `Saved “${name}”` }); setSaveOpen(false); setSaveName(''); }
    else setSaveMsg({ kind: res.code === 'limit_reached' ? 'limit' : 'err', text: res.error || 'Could not save' });
  }

  return (
    <div className="picker picker-range">
      <div className="picker-head">
        <div>
          <div className="picker-title">Select hand range</div>
          <div className="picker-sub">{totalCombos} combos · {pct.toFixed(1)}% of all hands</div>
        </div>
        <div className="range-presets">
          <PresetMenu groups={PRESET_GROUPS} onPick={applyPreset} />
          {lib.available && <MyRangesMenu lib={lib} onPick={(r) => setKeys(new Set(r.keys))} />}
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
              else style = { background: 'var(--rg-offsuit-on)', color: '#1a1208', fontWeight: 500 };
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

      {lib.available && (saveOpen || saveMsg) && (
        <div className="range-save-row">
          {saveOpen && (
            <form className="range-save-form" onSubmit={saveToLibrary}>
              <input
                className="range-save-input"
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                placeholder="Range name"
                maxLength={60}
                autoFocus
                aria-label="Range name"
              />
              <button type="submit" className="btn btn-primary" disabled={!saveName.trim() || saving}>{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" className="btn btn-ghost" onClick={() => { setSaveOpen(false); setSaveMsg(null); }}>Cancel</button>
            </form>
          )}
          {saveMsg && (
            <div className={'range-save-msg ' + saveMsg.kind} role={saveMsg.kind === 'ok' ? 'status' : 'alert'}>
              {saveMsg.text}
              {saveMsg.kind === 'limit' && <button type="button" className="link-btn" onClick={lib.openPlans}>Upgrade to Pro</button>}
            </div>
          )}
        </div>
      )}

      <div className="picker-foot">
        <div className="picker-foot-left">
          <button className="btn btn-ghost" onClick={() => setKeys(new Set())}>Clear</button>
          {lib.available && (
            <button className="btn btn-ghost" disabled={keys.size === 0} onClick={() => { setSaveMsg(null); setSaveOpen(o => !o); }}>
              Save to My ranges
            </button>
          )}
        </div>
        <div className="picker-foot-right">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={keys.size === 0} onClick={() => onSave(Array.from(keys))}>Save range</button>
        </div>
      </div>
    </div>
  );
}
