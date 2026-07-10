import React, { useEffect, useRef, useState } from 'react';
import { PlayingCard, CardBack } from './Cards.jsx';
import { rangeKey } from './Pickers.jsx';

export function PlayerSeat({
  index,
  player,
  active,
  onOpen,
  onRemove,
  equity,
  name,
  onRename,
  compact = false,
}) {
  const cardSize = compact ? 'bd' : 'md';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name || '');
  const inputRef = useRef(null);

  // keep draft in sync if name changes externally (e.g. shared link load)
  useEffect(() => { if (!editing) setDraft(name || ''); }, [name, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function commit() {
    const v = draft.trim();
    onRename?.(v || null);
    setEditing(false);
  }
  function cancel() {
    setDraft(name || '');
    setEditing(false);
  }

  const displayName = name || `Player ${index + 1}`;

  return (
    <div className={'seat ' + (active ? 'active ' : '') + (player ? 'filled ' : 'empty ')}>
      <div className="seat-label">
        <span className="seat-num">{(index + 1).toString().padStart(2, '0')}</span>
        {editing ? (
          <input
            ref={inputRef}
            className="seat-name-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            }}
            onClick={(e) => e.stopPropagation()}
            maxLength={18}
            placeholder={`Player ${index + 1}`}
          />
        ) : (
          <button
            className={'seat-name seat-name-btn' + (name ? ' is-custom' : '')}
            onClick={(e) => { e.stopPropagation(); setEditing(true); }}
            title="Click to rename"
          >
            <span>{displayName}</span>
            <svg className="seat-name-pencil" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
          </button>
        )}
        {player && (
          <button
            className="seat-x"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            aria-label="Remove"
          >×</button>
        )}
      </div>

      <button className="seat-body" onClick={onOpen}>
        {!player && (
          <div className="seat-empty">
            <div className="seat-empty-row">
              <CardBack size={cardSize} />
              <CardBack size={cardSize} />
            </div>
          </div>
        )}
        {player && player.kind === 'hand' && (
          <div className="seat-cards">
            <PlayingCard card={player.hand[0]} size={cardSize} />
            <PlayingCard card={player.hand[1]} size={cardSize} />
          </div>
        )}
        {player && player.kind === 'range' && (
          <RangeMini keys={player.range} />
        )}
      </button>

      {equity && (
        <div className="seat-equity">
          <div className="seat-equity-row">
            <span className="seat-equity-label">Equity</span>
            <span className="seat-equity-val">{equity.equity.toFixed(1)}%</span>
          </div>
          <div className="equity-bar"><div className="equity-bar-fill" style={{ width: equity.equity + '%' }} /></div>
          <div className="seat-equity-row sub">
            <span>W {equity.win.toFixed(1)}</span>
            <span>T {equity.tie.toFixed(1)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// 13x13 range thumbnail at hole-card height, so all plates share one footprint
export function RangeMini({ keys }) {
  const set = new Set(keys);
  return (
    <div className="range-mini">
      <div className="range-mini-grid">
        {Array.from({ length: 13 }).map((_, r) =>
          Array.from({ length: 13 }).map((_, c) => {
            const k = rangeKey(r, c);
            return (
              <div
                key={k}
                className={'rmc ' + (set.has(k) ? 'on ' : '') + (r === c ? 'pair ' : r < c ? 'suited ' : 'offsuit ')}
              />
            );
          })
        )}
      </div>
      <div className="range-mini-meta">
        <span className="range-mini-count">{keys.length}</span>
        <span className="range-mini-unit">hands</span>
      </div>
    </div>
  );
}
