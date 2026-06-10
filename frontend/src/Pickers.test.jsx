import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CardPicker, RangePicker, rangeKey, expandNotation } from './Pickers.jsx';

const comboCount = (k) => (k.length === 2 ? 6 : k.endsWith('s') ? 4 : 12);
const PAIRS = Array.from({ length: 13 }, (_, i) => rangeKey(i, i));

const cellEls = (container) => [...container.querySelectorAll('.rg-cell')];
const cellFor = (container, key) => cellEls(container).find((el) => el.textContent === key);
// active cells carry inline fontWeight, inactive ones no inline style
const activeKeys = (container) =>
  cellEls(container).filter((el) => el.style.fontWeight !== '').map((el) => el.textContent);
const subText = (container) => container.querySelector('.picker-sub').textContent;
const setSlider = (container, value) =>
  fireEvent.change(container.querySelector('.range-slider'), { target: { value } });
// React synthesizes onMouseEnter from native mouseover
const enterCell = (container, key) => fireEvent.mouseOver(cellFor(container, key));

function renderRange(initial = []) {
  const onCancel = vi.fn();
  const onSave = vi.fn();
  const utils = render(<RangePicker initial={initial} onCancel={onCancel} onSave={onSave} />);
  return { ...utils, onCancel, onSave };
}

describe('RangePicker', () => {
  it('renders the 13x13 grid and the combo/percent readout for the initial range', () => {
    const { container } = renderRange(['AA', 'AKs']);
    expect(cellEls(container)).toHaveLength(169);
    expect(subText(container)).toBe('10 combos · 0.8% of all hands');
    expect(activeKeys(container).sort()).toEqual(['AA', 'AKs']);
  });

  it('gates Save on a non-empty selection and saves the picked keys', () => {
    const { container, onSave } = renderRange([]);
    const save = screen.getByRole('button', { name: 'Save range' });
    expect(save).toBeDisabled();
    fireEvent.mouseDown(cellFor(container, 'AA'));
    fireEvent.mouseUp(window);
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith(['AA']);
  });

  it('Clear empties the selection and disables Save', () => {
    const { container } = renderRange(['AA', 'KK']);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(activeKeys(container)).toEqual([]);
    expect(subText(container)).toBe('0 combos · 0.0% of all hands');
    expect(screen.getByRole('button', { name: 'Save range' })).toBeDisabled();
  });

  it('Cancel calls onCancel without saving', () => {
    const { onCancel, onSave } = renderRange(['AA']);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('mouseDown toggles a cell on, a second mouseDown toggles it off', () => {
    const { container } = renderRange([]);
    fireEvent.mouseDown(cellFor(container, 'AA'));
    fireEvent.mouseUp(window);
    expect(activeKeys(container)).toEqual(['AA']);
    fireEvent.mouseDown(cellFor(container, 'AA'));
    fireEvent.mouseUp(window);
    expect(activeKeys(container)).toEqual([]);
  });

  it('drag-paints cells until mouseup, after which hover does nothing', () => {
    const { container } = renderRange([]);
    fireEvent.mouseDown(cellFor(container, 'AA'));
    enterCell(container, 'KK');
    expect(activeKeys(container).sort()).toEqual(['AA', 'KK']);
    fireEvent.mouseUp(window);
    enterCell(container, 'QQ');
    expect(activeKeys(container).sort()).toEqual(['AA', 'KK']);
  });

  it('drag starting on an active cell erases instead of painting', () => {
    const { container } = renderRange(['AA', 'KK', 'QQ']);
    fireEvent.mouseDown(cellFor(container, 'AA'));
    enterCell(container, 'KK');
    fireEvent.mouseUp(window);
    expect(activeKeys(container)).toEqual(['QQ']);
  });

  it('counts 6 combos for a pair, 4 suited, 12 offsuit', () => {
    const { container } = renderRange([]);
    fireEvent.mouseDown(cellFor(container, 'AA'));
    fireEvent.mouseUp(window);
    expect(subText(container)).toBe('6 combos · 0.5% of all hands');
    fireEvent.mouseDown(cellFor(container, 'AKs'));
    fireEvent.mouseUp(window);
    expect(subText(container)).toBe('10 combos · 0.8% of all hands');
    fireEvent.mouseDown(cellFor(container, 'AKo'));
    fireEvent.mouseUp(window);
    expect(subText(container)).toBe('22 combos · 1.7% of all hands');
  });

  it('slider at 100 selects all 169 hands (1326 combos), at 0 clears', () => {
    const { container } = renderRange([]);
    setSlider(container, '100');
    expect(activeKeys(container)).toHaveLength(169);
    expect(subText(container)).toBe('1326 combos · 100.0% of all hands');
    expect(container.querySelector('.range-slider-val').textContent).toBe('100.0%');
    setSlider(container, '0');
    expect(activeKeys(container)).toEqual([]);
    expect(subText(container)).toBe('0 combos · 0.0% of all hands');
  });

  it('slider boundaries pin the head of the hand ranking', () => {
    const { container } = renderRange([]);
    setSlider(container, '0.1');
    expect(activeKeys(container)).toEqual(['AA']);
    setSlider(container, '0'); // ['AA'] already reads 0.5%, so a 0.5 change would be deduped
    setSlider(container, '0.5');
    expect(activeKeys(container).sort()).toEqual(['AA', 'KK']);
    setSlider(container, '1.3');
    expect(activeKeys(container).sort()).toEqual(['AA', 'KK', 'QQ']);
  });

  it('ranks all pairs and AKs above AKo', () => {
    const { container } = renderRange([]);
    setSlider(container, '6');
    const keys = activeKeys(container);
    expect(keys).toHaveLength(14);
    for (const p of PAIRS) expect(keys).toContain(p);
    expect(keys).toContain('AKs');
    expect(keys).not.toContain('AKo');
  });

  it('larger top-% ranges contain smaller ones', () => {
    const { container } = renderRange([]);
    let prev = [];
    for (const pct of ['1', '5', '20', '60', '100']) {
      setSlider(container, pct);
      const cur = new Set(activeKeys(container));
      expect(prev.every((k) => cur.has(k))).toBe(true);
      prev = [...cur];
    }
  });

  it('top-% ranges meet the combo target minimally and match the readout', () => {
    const { container } = renderRange([]);
    for (const pct of [1, 5, 25, 50]) {
      setSlider(container, String(pct));
      const keys = activeKeys(container);
      const sum = keys.reduce((n, k) => n + comboCount(k), 0);
      const target = (pct / 100) * 1326;
      expect(parseInt(subText(container), 10)).toBe(sum);
      expect(sum).toBeGreaterThanOrEqual(target);
      // dropping the last-ranked key must fall below the target
      expect(Math.max(...keys.map(comboCount))).toBeGreaterThan(sum - target);
    }
  });

  it('preset menu lists both table sizes and closes on outside mousedown', () => {
    const { container } = renderRange(['AA']);
    fireEvent.click(screen.getByRole('button', { name: /preset/i }));
    const groups = [...container.querySelectorAll('.preset-group')];
    expect(groups.map((g) => g.querySelector('.preset-group-label').textContent)).toEqual([
      '6-max opening ranges',
      '9-max opening ranges',
    ]);
    expect(groups.map((g) => g.querySelectorAll('.preset-item').length)).toEqual([5, 8]);
    fireEvent.mouseDown(document.body);
    expect(container.querySelector('.preset-menu')).toBeNull();
    expect(activeKeys(container)).toEqual(['AA']);
  });

  it('applies the 6-max UTG preset, replacing the selection, and closes the menu', () => {
    const { container } = renderRange(['72o']);
    fireEvent.click(screen.getByRole('button', { name: /preset/i }));
    fireEvent.click(screen.getAllByRole('button', { name: 'UTG' })[0]);
    const expected = expandNotation('44+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, ATo+, KJo+');
    expect(activeKeys(container).sort()).toEqual(expected.sort());
    expect(container.querySelector('.preset-menu')).toBeNull();
  });

  it('every position preset paints a non-empty range of valid keys that matches the readout', () => {
    const { container } = renderRange([]);
    const trigger = screen.getByRole('button', { name: /preset/i });
    const valid = new Set();
    for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) valid.add(rangeKey(r, c));
    const labels = [];
    const combosAt = [];
    for (let i = 0; i < 13; i++) {
      fireEvent.click(trigger);
      const items = [...container.querySelectorAll('.preset-item')];
      expect(items).toHaveLength(13);
      labels.push(items[i].textContent);
      fireEvent.click(items[i]);
      const keys = activeKeys(container);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.every((k) => valid.has(k))).toBe(true);
      const sum = keys.reduce((n, k) => n + comboCount(k), 0);
      // a typo key (e.g. 'AKundefined') would inflate the readout past the painted cells
      expect(parseInt(subText(container), 10)).toBe(sum);
      combosAt.push(sum);
    }
    expect(labels).toEqual([
      'UTG', 'UTG+1', 'Cutoff', 'Button', 'Small Blind',
      'UTG', 'UTG+1', 'UTG+2', 'Lojack', 'Hijack', 'Cutoff', 'Button', 'Small Blind',
    ]);
    // later positions open wider within each table size
    expect(combosAt[3]).toBeGreaterThan(combosAt[0]);
    expect(combosAt[4]).toBeGreaterThan(combosAt[0]);
    expect(combosAt[11]).toBeGreaterThan(combosAt[5]);
    expect(combosAt[12]).toBeGreaterThan(combosAt[5]);
  });
});

const AS = { v: 'A', s: 's' };
const KD = { v: 'K', s: 'd' };

function renderCards(props = {}) {
  const fns = { onPick: vi.fn(), onClose: vi.fn(), onClear: vi.fn(), onConfirm: vi.fn() };
  const utils = render(<CardPicker usedCards={[]} selected={[]} {...fns} {...props} />);
  return { ...utils, ...fns };
}

describe('CardPicker', () => {
  it('renders 52 card buttons, the default title and the selection count', () => {
    const { container } = renderCards();
    expect(container.querySelectorAll('.pcard')).toHaveLength(52);
    expect(screen.getByText('Pick 2 cards')).toBeInTheDocument();
    expect(screen.getByText('0 / 2 selected')).toBeInTheDocument();
  });

  it('disables used cards and ignores clicks on them', () => {
    const { onPick } = renderCards({ usedCards: [AS] });
    const btn = screen.getByRole('button', { name: 'A of s' });
    expect(btn).toBeDisabled();
    expect(btn.className).toContain('used');
    fireEvent.click(btn);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('keeps a used card clickable when it is part of the current selection', () => {
    const { onPick } = renderCards({ usedCards: [AS], selected: [AS] });
    const btn = screen.getByRole('button', { name: 'A of s' });
    expect(btn).toBeEnabled();
    expect(btn.className).toContain('selected');
    expect(btn.className).not.toContain('used');
    fireEvent.click(btn);
    expect(onPick).toHaveBeenCalledWith({ v: 'A', s: 's' });
  });

  it('calls onPick with the clicked card', () => {
    const { onPick } = renderCards();
    fireEvent.click(screen.getByRole('button', { name: 'K of d' }));
    expect(onPick).toHaveBeenCalledWith({ v: 'K', s: 'd' });
  });

  it('renders the T rank as 10', () => {
    renderCards();
    const rank = screen.getByRole('button', { name: 'T of h' }).querySelector('.pcard-rank');
    expect(rank.textContent).toBe('10');
    expect(rank.className).toContain('is-ten');
  });

  it('enables Confirm only at exactly maxCards selections', () => {
    const onConfirm = vi.fn();
    const noop = vi.fn();
    const { rerender } = render(
      <CardPicker usedCards={[]} selected={[AS]} onPick={noop} onClose={noop} onClear={noop} onConfirm={onConfirm} />
    );
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();
    expect(screen.getByText('1 / 2 selected')).toBeInTheDocument();
    rerender(
      <CardPicker usedCards={[]} selected={[AS, KD]} onPick={noop} onClose={noop} onClear={noop} onConfirm={onConfirm} />
    );
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('fills the selected tray and leaves remaining slots empty', () => {
    const { container } = renderCards({ selected: [AS] });
    const tray = container.querySelector('.picker-selected');
    expect(tray.children).toHaveLength(2);
    expect(tray.children[0].textContent).toBe('A');
    expect(tray.children[1].textContent).toBe('');
  });

  it('Clear and Cancel call onClear and onClose', () => {
    const { onClear, onClose } = renderCards();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
