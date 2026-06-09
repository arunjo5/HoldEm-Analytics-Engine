// Small shared Solver UI pieces.
import React from 'react';
import { rangeKey } from './Pickers.jsx';
import { actionColor } from './solverEngine.js';

// Read-only 13×13 range thumbnail (felt seats + config rows).
export function RangeThumbnail({ keys, cell = 9 }) {
  const set = React.useMemo(() => new Set(keys), [keys]);
  return (
    <div className="range-thumb" style={{ gridTemplateColumns: `repeat(13, ${cell}px)`, gridTemplateRows: `repeat(13, ${cell}px)` }}>
      {Array.from({ length: 13 }).map((_, r) => (
        Array.from({ length: 13 }).map((_, c) => {
          const k = rangeKey(r, c);
          const on = set.has(k);
          const kind = r === c ? 'pair' : r < c ? 'suited' : 'offsuit';
          return <div key={k} className={'rt-cell' + (on ? ' on ' + kind : '')} />;
        })
      ))}
    </div>
  );
}

// Horizontal stacked proportion bar for a set of actions.
export function SegBar({ node, weights, height = 12, radius = 3, min = 0.012 }) {
  const segs = node.actions.map((a) => ({ a, w: weights[a.id] || 0 })).filter((s) => s.w > min);
  return (
    <div className="sv-segbar" style={{ height, borderRadius: radius }}>
      {segs.map((s) => (
        <div key={s.a.id} className="sv-seg"
          style={{ width: (s.w * 100) + '%', background: actionColor(s.a) }}
          title={`${s.a.label} ${(s.w * 100).toFixed(1)}%`} />
      ))}
    </div>
  );
}

export function Legend({ node }) {
  return (
    <div className="sv-legend">
      {node.actions.map((a) => (
        <span key={a.id} className="sv-legend-item">
          <span className="sv-legend-dot" style={{ background: actionColor(a) }} />
          {a.label}
        </span>
      ))}
    </div>
  );
}
