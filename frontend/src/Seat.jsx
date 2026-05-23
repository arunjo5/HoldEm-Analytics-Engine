import React from 'react';
import { PlayingCard, CardBack } from './Cards.jsx';
import { rangeKey } from './Pickers.jsx';

export function PlayerSeat({
  index,
  player,
  active,
  onOpen,
  onRemove,
  equity,
}) {
  return (
    <div className={'seat ' + (active ? 'active ' : '') + (player ? 'filled ' : 'empty ')}>
      <div className="seat-label">
        <span className="seat-num">{(index + 1).toString().padStart(2, '0')}</span>
        <span className="seat-name">Player {index + 1}</span>
        {player && (
          <button className="seat-x" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label="Remove">×</button>
        )}
      </div>

      <button className="seat-body" onClick={onOpen}>
        {!player && (
          <div className="seat-empty">
            <div className="seat-empty-row">
              <CardBack size="sm" />
              <CardBack size="sm" />
            </div>
          </div>
        )}
        {player && player.kind === 'hand' && (
          <div className="seat-cards">
            <PlayingCard card={player.hand[0]} size="md" />
            <PlayingCard card={player.hand[1]} size="md" />
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

// 13x13 thumbnail of a range.
export function RangeMini({ keys }) {
  const set = new Set(keys);
  return (
    <div className="range-mini">
      <div className="range-mini-grid">
        {Array.from({ length: 13 }).map((_, r) =>
          Array.from({ length: 13 }).map((_, c) => {
            const k = rangeKey(r, c);
            return <div key={k} className={'rmc ' + (set.has(k) ? 'on ' : '') + (r === c ? 'pair ' : r < c ? 'suited ' : 'offsuit ')} />;
          })
        )}
      </div>
      <div className="range-mini-label">{keys.length} hands</div>
    </div>
  );
}
