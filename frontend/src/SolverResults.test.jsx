import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { ResultsView } from './SolverResults.jsx';
import { solve, actionColor } from './solverEngine.js';

const c = (v, s) => ({ v, s });
const BOARD = [c('2', 's'), c('7', 'h'), c('9', 'c'), c('J', 'd'), c('K', 's')];
const SPOT = { pot: 20, stack: 80, betSizes: [{ id: 'b75', pct: 75, on: true }], allIn: false };
const OOP_KEYS = ['AA', 'QQ'];
const IP_KEYS = ['AA', 'KQs'];

// real solve keeps the result-shape contract honest
let result;
beforeAll(() => {
  result = solve(BOARD, OOP_KEYS, IP_KEYS, SPOT, { iterations: 8 });
});

function renderResults(over = {}) {
  const onResolve = vi.fn(), onBackToSetup = vi.fn();
  render(
    <ResultsView spot={SPOT} board={BOARD}
      oopSide={{ kind: 'range', keys: OOP_KEYS }} ipSide={{ kind: 'range', keys: IP_KEYS }}
      oopKeys={OOP_KEYS} ipKeys={IP_KEYS}
      result={over.result || result} onResolve={onResolve} onBackToSetup={onBackToSetup} />
  );
  return { onResolve, onBackToSetup };
}

const grid = () => document.querySelector('.sv-grid');
const cellOf = (key) => within(grid()).getByText(key).closest('.sv-cell');
const tabs = () => document.querySelectorAll('.sv-node-tab');
const detail = () => document.querySelector('.sv-detail');
const rgbOf = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

describe('header readout', () => {
  it('renders formatted EV, exploitability, and iteration stats', () => {
    renderResults();
    const stats = document.querySelectorAll('.sv-readout-stats .sv-stat');
    expect(within(stats[0]).getByText('EV · OOP')).toBeInTheDocument();
    expect(stats[0].querySelector('.sv-stat-value').textContent).toBe(result.meta.evOOP.toFixed(2));
    expect(within(stats[1]).getByText('EV · IP')).toBeInTheDocument();
    expect(stats[1].querySelector('.sv-stat-value').textContent).toBe(result.meta.evIP.toFixed(2));
    const ex = document.querySelector('.sv-stat-exploit .sv-stat-value');
    expect(ex.textContent).toBe(result.meta.exploitPctPot.toFixed(2) + '% pot');
    expect(screen.getByText('8 iters')).toBeInTheDocument();
    expect(document.querySelector('.sv-spark polyline')).not.toBeNull();
  });

  it('Edit spot and Re-solve fire their callbacks', () => {
    const { onResolve, onBackToSetup } = renderResults();
    fireEvent.click(screen.getByRole('button', { name: 'Edit spot' }));
    expect(onBackToSetup).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Re-solve' }));
    expect(onResolve).toHaveBeenCalledTimes(1);
  });

  it('sparkline renders an empty svg for traces shorter than 2', () => {
    renderResults({ result: { ...result, trace: [1] } });
    const spark = document.querySelector('.sv-spark');
    expect(spark).not.toBeNull();
    expect(spark.querySelector('polyline')).toBeNull();
  });
});

describe('node tabs', () => {
  it('renders one tab per node with actor badge and stripped label', () => {
    renderResults();
    expect(tabs()).toHaveLength(result.nodes.length);
    result.nodes.forEach((n, i) => {
      const badge = tabs()[i].querySelector('.sv-pos-badge');
      expect(badge.className).toContain(n.actor === 'OOP' ? 'oop' : 'ip');
      expect(badge.textContent).toBe(n.actor);
      expect(tabs()[i].textContent).toBe(n.actor + n.label.replace(/^(OOP|IP)\s*—\s*/, ''));
    });
  });

  it('clicking a tab switches the grid to that node solve', () => {
    renderResults();
    expect(cellOf('KQs').tagName).toBe('DIV'); // not in OOP range
    fireEvent.click(tabs()[1]); // ip_vs_check
    expect(cellOf('KQs').tagName).toBe('BUTTON');
  });
});

describe('grid layouts', () => {
  it('strategy layout renders proportional fill divs, skipping weights < 0.01', () => {
    renderResults();
    const node = result.nodes[0];
    const g = result.nodeSolves.oop_first.byKey.AA;
    const expected = node.actions.map((a) => g.agg[a.id] || 0).filter((w) => w >= 0.01).map((w) => `${w * 100}%`);
    expect(expected.length).toBeGreaterThan(0);
    const fills = cellOf('AA').querySelectorAll('.sv-cell-fill > div');
    expect(Array.from(fills).map((d) => d.style.width)).toEqual(expected);
  });

  it('a key absent from the solve renders a non-interactive empty div', () => {
    renderResults();
    const off = cellOf('72o');
    expect(off.tagName).toBe('DIV');
    expect(off.className).toContain('empty');
  });

  const tintOf = (key) => cellOf(key).querySelector('.sv-cell-tint');

  it('dominant layout tints the cell by dominant action with weighted opacity, label stays solid', () => {
    renderResults();
    fireEvent.click(screen.getByRole('button', { name: 'Dominant' }));
    const node = result.nodes[0];
    const g = result.nodeSolves.oop_first.byKey.AA;
    const domA = node.actions.find((a) => a.id === g.dominant);
    const tint = tintOf('AA');
    expect(tint.style.opacity).toBe(String(0.32 + 0.68 * (g.agg[g.dominant] || 0)));
    expect(tint.style.backgroundColor).toBe(rgbOf(actionColor(domA)));
    expect(cellOf('AA').style.opacity).toBe('');
  });

  it('heat layout defaults focus to the first bet action and scales tint opacity', () => {
    renderResults();
    fireEvent.click(screen.getByRole('button', { name: 'Heat' }));
    const node = result.nodes[0];
    const opts = document.querySelectorAll('.sv-heat-opt');
    expect(Array.from(opts).map((o) => o.textContent)).toEqual(node.actions.map((a) => a.label));
    const bet = node.actions.find((a) => a.kind === 'bet');
    expect(document.querySelector('.sv-heat-opt.active').textContent).toBe(bet.label);
    const g = result.nodeSolves.oop_first.byKey.AA;
    expect(tintOf('AA').style.opacity).toBe(String(0.06 + 0.94 * (g.agg[bet.id] || 0)));
  });

  it('heat focus falls back to the node default when the action is missing', () => {
    renderResults();
    fireEvent.click(screen.getByRole('button', { name: 'Heat' }));
    fireEvent.click(Array.from(document.querySelectorAll('.sv-heat-opt')).find((o) => o.textContent === 'Check'));
    expect(document.querySelector('.sv-heat-opt.active').textContent).toBe('Check');
    fireEvent.click(tabs()[2]); // ip_vs_bet: fold/call/raise — no check
    expect(document.querySelector('.sv-heat-opt.active').textContent).toBe('Call');
    const node = result.nodes[2];
    const s = result.nodeSolves[node.id];
    const key = Object.keys(s.byKey)[0];
    expect(tintOf(key).style.opacity).toBe(String(0.06 + 0.94 * (s.byKey[key].agg.call || 0)));
  });
});

describe('combo drill-in', () => {
  it('clicking a cell shows the per-combo breakdown and clicking again toggles back', () => {
    renderResults();
    fireEvent.click(cellOf('AA'));
    expect(within(detail()).getByText('AA')).toBeInTheDocument();
    expect(within(detail()).getByText('6 combos')).toBeInTheDocument();
    expect(detail().querySelectorAll('.sv-combo-row')).toHaveLength(6);
    expect(within(detail()).getAllByText('Pair')).toHaveLength(6);
    expect(detail().querySelectorAll('.sv-combo-row .card-chip')).toHaveLength(12);
    expect(detail().querySelectorAll('.sv-segbar').length).toBeGreaterThan(0);
    fireEvent.click(cellOf('AA'));
    expect(within(detail()).getByText('Range summary')).toBeInTheDocument();
  });

  it('switching node clears the selection back to the range summary', () => {
    renderResults();
    fireEvent.click(cellOf('AA'));
    expect(within(detail()).getByText('6 combos')).toBeInTheDocument();
    fireEvent.click(tabs()[1]);
    expect(within(detail()).getByText('Range summary')).toBeInTheDocument();
  });

  it('range summary aggregates weights as count-weighted means', () => {
    renderResults();
    const node = result.nodes[0];
    const s = result.nodeSolves.oop_first;
    const agg = {};
    let total = 0;
    for (const k in s.byKey) {
      const g = s.byKey[k];
      total += g.count;
      for (const aid in g.agg) agg[aid] = (agg[aid] || 0) + g.agg[aid] * g.count;
    }
    expect(within(detail()).getByText(`OOP · ${s.count} combos in range`)).toBeInTheDocument();
    const rows = detail().querySelectorAll('.sv-freq-row');
    node.actions.forEach((a, i) => {
      expect(rows[i].querySelector('.sv-freq-val').textContent).toBe((((agg[a.id] || 0) / total) * 100).toFixed(1) + '%');
    });
  });
});

describe('grid cell layer structure', () => {
  it('a strategy cell is a button with a fill layer, an "over" label, and no tint', () => {
    renderResults();
    const cell = cellOf('AA');
    expect(cell.tagName).toBe('BUTTON');
    expect(cell.querySelector('.sv-cell-fill')).not.toBeNull();
    expect(cell.querySelector('.sv-cell-tint')).toBeNull();
    expect(cell.querySelector('.sv-cell-label').className).toContain('over');
    expect(cell.style.opacity).toBe('');
    expect(cell.className).not.toContain('solid');
  });

  it('dominant and heat cells carry a tint layer, a plain label, and the solid modifier', () => {
    renderResults();
    fireEvent.click(screen.getByRole('button', { name: 'Dominant' }));
    let cell = cellOf('AA');
    expect(cell.querySelector('.sv-cell-tint')).not.toBeNull();
    expect(cell.querySelector('.sv-cell-fill')).toBeNull();
    expect(cell.querySelector('.sv-cell-label').className).not.toContain('over');
    expect(cell.className).toContain('solid');
    fireEvent.click(screen.getByRole('button', { name: 'Heat' }));
    cell = cellOf('AA');
    expect(cell.querySelector('.sv-cell-tint')).not.toBeNull();
    expect(cell.querySelector('.sv-cell-fill')).toBeNull();
    expect(cell.style.opacity).toBe('');
    expect(cell.className).toContain('solid');
  });

  it('switching Strategy back drops the tint and solid modifier again', () => {
    renderResults();
    fireEvent.click(screen.getByRole('button', { name: 'Dominant' }));
    expect(cellOf('AA').querySelector('.sv-cell-tint')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Strategy' }));
    const cell = cellOf('AA');
    expect(cell.querySelector('.sv-cell-tint')).toBeNull();
    expect(cell.querySelector('.sv-cell-fill')).not.toBeNull();
    expect(cell.className).not.toContain('solid');
  });

  it('an empty cell is a non-interactive div with neither a fill nor a tint layer', () => {
    renderResults();
    const off = cellOf('72o');
    expect(off.tagName).toBe('DIV');
    expect(off.className).toContain('empty');
    expect(off.querySelector('.sv-cell-fill')).toBeNull();
    expect(off.querySelector('.sv-cell-tint')).toBeNull();
  });
});
