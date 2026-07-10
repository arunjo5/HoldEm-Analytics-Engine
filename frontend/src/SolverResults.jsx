// Solver — Results screen: 13×13 strategy grid (Strategy/Dominant/Heat), combo
// drill-in, and EV + exploitability readouts. Consumes the solver's output.
import React, { useState, useEffect } from 'react';
import { PlayingCard, CardChip } from './Cards.jsx';
import { rangeKey } from './Pickers.jsx';
import { SegBar, Legend } from './solverBits.jsx';
import { actionColor, CAT_NAME, combosFromKeys } from './solverEngine.js';

function GridCell({ r, c, g, node, layout, focusAction, selected, onSelect }) {
  const key = rangeKey(r, c);
  const kind = r === c ? 'pair' : r < c ? 'suited' : 'offsuit';
  if (!g) return <div className={'sv-cell empty ' + kind}><span className="sv-cell-label">{key}</span></div>;
  // tint lives on a child layer so a cold cell fades its color, not its label
  let inner = null;
  if (layout === 'strategy') {
    inner = (
      <div className="sv-cell-fill">
        {node.actions.map((a) => { const w = g.agg[a.id] || 0; if (w < 0.01) return null; return <div key={a.id} style={{ width: (w * 100) + '%', background: actionColor(a) }} />; })}
      </div>
    );
  } else if (layout === 'dominant') {
    const domA = node.actions.find((a) => a.id === g.dominant);
    const f = g.agg[g.dominant] || 0;
    inner = <div className="sv-cell-tint" style={{ background: actionColor(domA), opacity: 0.32 + 0.68 * f }} />;
  } else if (layout === 'heat') {
    const fa = node.actions.find((a) => a.id === focusAction) || node.actions[0];
    const f = g.agg[fa.id] || 0;
    inner = <div className="sv-cell-tint" style={{ background: actionColor(fa), opacity: 0.06 + 0.94 * f }} />;
  }
  return (
    <button className={'sv-cell ' + kind + (selected ? ' selected' : '') + (layout !== 'strategy' ? ' solid' : '')} onClick={() => onSelect(key)}>
      {inner}
      <span className={'sv-cell-label' + (layout === 'strategy' ? ' over' : '')}>{key}</span>
    </button>
  );
}

function StrategyGrid({ solve, node, layout, focusAction, selected, onSelect }) {
  return (
    <div className="sv-grid">
      {Array.from({ length: 13 }).map((_, r) => (
        Array.from({ length: 13 }).map((_, c) => {
          const key = rangeKey(r, c);
          return <GridCell key={key} r={r} c={c} g={solve.byKey[key]} node={node} layout={layout} focusAction={focusAction} selected={selected === key} onSelect={onSelect} />;
        })
      ))}
    </div>
  );
}

function ComboDetail({ solve, node, selectedKey }) {
  if (!selectedKey || !solve.byKey[selectedKey]) {
    const agg = {}; let total = 0;
    for (const k in solve.byKey) { const g = solve.byKey[k]; total += g.count; for (const aid in g.agg) agg[aid] = (agg[aid] || 0) + g.agg[aid] * g.count; }
    for (const aid in agg) agg[aid] /= (total || 1);
    return (
      <div className="sv-detail">
        <div className="sv-detail-head">
          <div className="sv-detail-title">Range summary</div>
          <div className="sv-detail-sub">{node.actor} · {solve.count} combos in range</div>
        </div>
        <div className="sv-detail-block">
          <div className="sv-block-label">Aggregate strategy</div>
          <SegBar node={node} weights={agg} height={20} radius={5} />
          <div className="sv-freq-list">
            {node.actions.map((a) => (
              <div key={a.id} className="sv-freq-row">
                <span className="sv-freq-name"><span className="sv-legend-dot" style={{ background: actionColor(a) }} />{a.label}</span>
                <span className="sv-freq-val">{((agg[a.id] || 0) * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
        <div className="sv-detail-hint">Click any hand in the grid to drill into its individual combos.</div>
      </div>
    );
  }
  const g = solve.byKey[selectedKey];
  return (
    <div className="sv-detail">
      <div className="sv-detail-head">
        <div className="sv-detail-title"><span className="sv-detail-hand">{selectedKey}</span><span className="sv-detail-count">{g.count} combo{g.count === 1 ? '' : 's'}</span></div>
        <div className="sv-detail-sub">{node.label}</div>
      </div>
      <div className="sv-detail-block">
        <div className="sv-block-label">Aggregate action mix</div>
        <SegBar node={node} weights={g.agg} height={20} radius={5} />
        <div className="sv-freq-list">
          {node.actions.map((a) => (
            <div key={a.id} className="sv-freq-row">
              <span className="sv-freq-name"><span className="sv-legend-dot" style={{ background: actionColor(a) }} />{a.label}</span>
              <span className="sv-freq-val">{((g.agg[a.id] || 0) * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
      <div className="sv-detail-block">
        <div className="sv-block-label">Per-combo breakdown</div>
        <div className="sv-combo-list">
          {g.combos.map((c) => (
            <div key={c.id} className="sv-combo-row">
              <span className="sv-combo-cards"><CardChip card={c.cards[0]} /><CardChip card={c.cards[1]} /></span>
              <span className="sv-combo-cat">{CAT_NAME[c.cat]}</span>
              <span className="sv-combo-bar"><SegBar node={node} weights={c.weights} height={10} radius={2} /></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// dark ink on pale action colors, white on the rest
function chipInk(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255);
  return lum > 160 ? '#42201b' : '#fff';
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="sv-stat">
      <div className="sv-stat-label">{label}</div>
      <div className={'sv-stat-value' + (accent ? ' accent' : '')}>{value}</div>
      {sub && <div className="sv-stat-sub">{sub}</div>}
    </div>
  );
}

function Sparkline({ trace }) {
  const w = 64, h = 22;
  if (!trace || trace.length < 2) return <svg width={w} height={h} className="sv-spark" />;
  const max = trace[0], min = trace[trace.length - 1];
  const pts = trace.map((v, i) => { const x = (i / (trace.length - 1)) * w; const y = h - ((v - min) / (max - min || 1)) * (h - 2) - 1; return `${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ');
  return <svg width={w} height={h} className="sv-spark"><polyline points={pts} fill="none" stroke="var(--gold)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function ResultsView({ spot, board, oopSide, ipSide, oopKeys, ipKeys, result, onResolve, onBackToSetup }) {
  const nodes = result.nodes;
  const meta = result.meta, trace = result.trace;
  const [nodeId, setNodeId] = useState(nodes[0].id);
  const [layout, setLayout] = useState('strategy');
  const [selectedKey, setSelectedKey] = useState(null);

  const node = nodes.find((n) => n.id === nodeId) || nodes[0];
  const solve = result.nodeSolves[node.id] || { byKey: {}, combos: [], count: 0 };

  const focusDefault = (node.actions.find((a) => a.kind === 'bet') || node.actions.find((a) => a.kind === 'call') || node.actions[0]).id;
  const [focusAction, setFocusAction] = useState(focusDefault);
  useEffect(() => { setSelectedKey(null); }, [nodeId]);
  const activeFocus = node.actions.some((a) => a.id === focusAction) ? focusAction : focusDefault;

  return (
    <div className="sv-results">
      <div className="sv-readout">
        <div className="sv-readout-left">
          <div className="sv-spot-cards">{board.map((c, i) => c && <PlayingCard key={i} card={c} size="sm" />)}</div>
          <div className="sv-spot-meta">
            <div className="sv-spot-line">
              <span className="sv-pos-badge oop">OOP</span>{oopSide && oopSide.kind === 'hand' ? 'hand' : combosFromKeys(oopKeys) + ' combos'}
              <span className="sv-spot-vs">vs</span>
              <span className="sv-pos-badge ip">IP</span>{ipSide && ipSide.kind === 'hand' ? 'hand' : combosFromKeys(ipKeys) + ' combos'}
            </div>
            <div className="sv-spot-line dim">Pot {spot.pot} bb · {spot.stack} bb eff · {meta.sizeCount}-size tree</div>
          </div>
        </div>
        <div className="sv-readout-stats">
          <StatCard label="EV · OOP" value={meta.evOOP.toFixed(2)} sub="bb" />
          <StatCard label="EV · IP" value={meta.evIP.toFixed(2)} sub="bb" />
          <div className="sv-stat sv-stat-exploit">
            <div className="sv-stat-label">Exploitability</div>
            <div className="sv-stat-value accent">{meta.exploitPctPot.toFixed(2)}<span className="sv-stat-unit">% pot</span></div>
            <div className="sv-exploit-conv">
              <span className="sv-conv-check">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                converged
              </span>
              <Sparkline trace={trace} />
              <span className="sv-conv-iter">{meta.iterations} iters</span>
            </div>
          </div>
        </div>
        <div className="sv-readout-actions">
          <button className="btn btn-ghost" onClick={onBackToSetup}>Edit spot</button>
          <button className="btn btn-ghost" onClick={onResolve}>Re-solve</button>
        </div>
      </div>

      <div className="sv-caveat">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" />
        </svg>
        {/* keep in one div: bare text in a flex row splits into columns */}
        <div>Exploitability is measured against your chosen <strong>{meta.sizeCount}-size bet tree</strong> — it only applies to those bet sizes, not the full continuous (all-sizings) game.</div>
      </div>

      <div className="sv-nodebar">
        <span className="sv-nodebar-label">Decision node</span>
        <div className="sv-node-tabs">
          {nodes.map((n) => (
            <button key={n.id} className={'sv-node-tab' + (n.id === nodeId ? ' active' : '')} onClick={() => setNodeId(n.id)}>
              <span className={'sv-pos-badge ' + (n.actor === 'OOP' ? 'oop' : 'ip')}>{n.actor}</span>
              {n.label.replace(/^(OOP|IP)\s*—\s*/, '')}
            </button>
          ))}
        </div>
      </div>

      <div className="sv-results-main">
        <div className="sv-grid-panel">
          <div className="sv-grid-toolbar">
            <div className="sv-layout-switch">
              {[['strategy', 'Strategy'], ['dominant', 'Dominant'], ['heat', 'Heat']].map(([id, lbl]) => (
                <button key={id} className={'sv-layout-btn' + (layout === id ? ' active' : '')} onClick={() => setLayout(id)}>{lbl}</button>
              ))}
            </div>
            {layout === 'heat' ? (
              <div className="sv-heat-pick">
                <span className="sv-heat-lbl">Action</span>
                <div className="sv-heat-opts">
                  {node.actions.map((a) => (
                    <button key={a.id} className={'sv-heat-opt' + (activeFocus === a.id ? ' active' : '')} onClick={() => setFocusAction(a.id)}
                      style={activeFocus === a.id ? { background: actionColor(a), borderColor: actionColor(a), color: chipInk(actionColor(a)) } : {}}>{a.label}</button>
                  ))}
                </div>
              </div>
            ) : (<Legend node={node} />)}
          </div>
          <StrategyGrid solve={solve} node={node} layout={layout} focusAction={activeFocus} selected={selectedKey} onSelect={(k) => setSelectedKey(k === selectedKey ? null : k)} />
        </div>
        <div className="sv-detail-panel">
          <ComboDetail solve={solve} node={node} selectedKey={selectedKey} />
        </div>
      </div>
    </div>
  );
}
