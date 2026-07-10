import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { PlayingCard, CardChip, ThemeIcon, BoardStrip } from './Cards.jsx';
import { PlayerSeat, RangeMini } from './Seat.jsx';
import { ShareModal } from './ShareModal.jsx';

const c = (s) => ({ v: s[0], s: s[1] });

afterEach(() => {
  vi.useRealTimers();
  delete window.navigator.clipboard;
  delete document.execCommand;
});

describe('PlayingCard', () => {
  it('renders T as 10 and reds hearts/diamonds', () => {
    render(<PlayingCard card={c('Th')} />);
    const rank = screen.getByText('10');
    expect(rank.style.color).toBe('var(--card-red)');
  });

  it('uses ink color for black suits', () => {
    render(<PlayingCard card={c('As')} />);
    expect(screen.getByText('A').style.color).toBe('var(--card-ink)');
  });
});

describe('CardChip', () => {
  it('renders T as 10 with red class for diamonds', () => {
    const { container } = render(<CardChip card={c('Td')} />);
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('card-chip', 'red');
  });

  it('uses ink class for clubs', () => {
    const { container } = render(<CardChip card={c('Tc')} />);
    expect(container.firstChild).toHaveClass('card-chip', 'ink');
  });
});

describe('PlayerSeat', () => {
  function renderSeat(over = {}) {
    const props = {
      index: 2, player: null, active: false,
      onOpen: vi.fn(), onRemove: vi.fn(), onRename: vi.fn(),
      equity: null, name: null, ...over,
    };
    const utils = render(<PlayerSeat {...props} />);
    return { ...utils, props };
  }
  const startEditing = () => fireEvent.click(screen.getByTitle('Click to rename'));
  const nameInput = () => screen.getByPlaceholderText('Player 3');

  it('commits a trimmed rename on Enter', () => {
    const { props } = renderSeat();
    startEditing();
    fireEvent.change(nameInput(), { target: { value: '  Hero ' } });
    fireEvent.keyDown(nameInput(), { key: 'Enter' });
    expect(props.onRename).toHaveBeenCalledWith('Hero');
    expect(screen.queryByPlaceholderText('Player 3')).toBeNull();
  });

  it('commits null for a whitespace-only rename', () => {
    const { props } = renderSeat();
    startEditing();
    fireEvent.change(nameInput(), { target: { value: '   ' } });
    fireEvent.keyDown(nameInput(), { key: 'Enter' });
    expect(props.onRename).toHaveBeenCalledWith(null);
  });

  it('cancels on Escape without calling onRename', () => {
    const { props } = renderSeat();
    startEditing();
    fireEvent.change(nameInput(), { target: { value: 'ZZZ' } });
    fireEvent.keyDown(nameInput(), { key: 'Escape' });
    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.getByText('Player 3')).toBeInTheDocument();
  });

  it('commits on blur and caps input at 18 chars', () => {
    const { props } = renderSeat();
    startEditing();
    expect(nameInput()).toHaveAttribute('maxlength', '18');
    fireEvent.change(nameInput(), { target: { value: 'Bob' } });
    fireEvent.blur(nameInput());
    expect(props.onRename).toHaveBeenCalledWith('Bob');
  });

  it('remove button calls onRemove, not onOpen', () => {
    const { props } = renderSeat({ player: { kind: 'hand', hand: [c('As'), c('Ah')] } });
    fireEvent.click(screen.getByLabelText('Remove'));
    expect(props.onRemove).toHaveBeenCalledTimes(1);
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it('renders win/tie/equity to one decimal only when equity is set', () => {
    const { unmount } = renderSeat({
      player: { kind: 'hand', hand: [c('As'), c('Ah')] },
      equity: { win: 50.12, tie: 1.26, equity: 51.34 },
    });
    expect(screen.getByText('51.3%')).toBeInTheDocument();
    expect(screen.getByText('W 50.1')).toBeInTheDocument();
    expect(screen.getByText('T 1.3')).toBeInTheDocument();
    unmount();
    renderSeat({ player: { kind: 'hand', hand: [c('As'), c('Ah')] }, equity: null });
    expect(screen.queryByText('Equity')).toBeNull();
  });

  it('empty seat renders two card backs at the md footprint', () => {
    const { container } = renderSeat({ player: null });
    const row = container.querySelector('.seat-empty-row');
    expect(row).toBeInTheDocument();
    expect(row.children).toHaveLength(2);
    // backs share the 50px md footprint so empty and filled plates line up
    expect(row.children[0].style.width).toBe('50px');
    expect(row.children[1].style.width).toBe('50px');
    expect(container.querySelector('.seat-cards')).toBeNull();
  });

  it('hand seat renders two md hole cards and no empty backs', () => {
    const { container } = renderSeat({ player: { kind: 'hand', hand: [c('As'), c('Kd')] } });
    const cards = container.querySelectorAll('.seat-cards > *');
    expect(cards).toHaveLength(2);
    expect(cards[0].style.width).toBe('50px');
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('K')).toBeInTheDocument();
    expect(container.querySelector('.seat-empty-row')).toBeNull();
  });

  it('range seat renders a RangeMini plate with the count split from the unit', () => {
    const { container } = renderSeat({ player: { kind: 'range', range: ['AA', 'KK'] } });
    expect(container.querySelectorAll('.range-mini-grid .rmc')).toHaveLength(169);
    expect(container.querySelector('.range-mini-count').textContent).toBe('2');
    expect(container.querySelector('.range-mini-unit').textContent).toBe('hands');
    expect(screen.queryByText('2 hands')).toBeNull(); // old single "N hands" node is gone
  });
});

describe('ShareModal', () => {
  const URL = 'http://x/#s=abc';

  it('copies via navigator.clipboard and reverts after 1.8s', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ShareModal open onClose={() => {}} url={URL} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /copy link/i })); });
    expect(writeText).toHaveBeenCalledWith(URL);
    expect(screen.getByText('Copied')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1800); });
    expect(screen.getByText('Copy link')).toBeInTheDocument();
  });

  it('falls back to select + execCommand when clipboard is missing', async () => {
    Object.defineProperty(window.navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = vi.fn(() => true);
    render(<ShareModal open onClose={() => {}} url={URL} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /copy link/i })); });
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });

  it('renders the url in a read-only input and nothing when closed', () => {
    const { rerender } = render(<ShareModal open onClose={() => {}} url={URL} />);
    const input = screen.getByDisplayValue(URL);
    expect(input).toHaveAttribute('readonly');
    rerender(<ShareModal open={false} onClose={() => {}} url={URL} />);
    expect(screen.queryByDisplayValue(URL)).toBeNull();
  });
});

describe('ThemeIcon', () => {
  it('renders a sun (disc + rays) as svg in the dark theme', () => {
    const { container } = render(<ThemeIcon theme="dark" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg.querySelector('circle')).toBeInTheDocument(); // sun disc
    expect(svg.querySelectorAll('path')).toHaveLength(1);     // rays as one path
    expect(container.textContent).toBe('');                   // no emoji/text glyph
  });

  it('renders a moon (single path, no disc) as svg in the light theme', () => {
    const { container } = render(<ThemeIcon theme="light" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg.querySelector('circle')).toBeNull();
    expect(svg.querySelectorAll('path')).toHaveLength(1);
    expect(container.textContent).toBe('');
  });
});

describe('BoardStrip', () => {
  const B = ['As', 'Kd', 'Qh', 'Jc', 'Ts'].map(c);
  function renderStrip(over = {}) {
    const onDeal = vi.fn();
    const onClearFrom = vi.fn();
    const utils = render(<BoardStrip board={[]} onDeal={onDeal} onClearFrom={onClearFrom} {...over} />);
    return { ...utils, onDeal, onClearFrom };
  }

  it('empty board: flop is one deal button, turn and river locked', () => {
    const { container, onDeal } = renderStrip();
    const btns = container.querySelectorAll('.board-strip-btn');
    expect(btns).toHaveLength(3);
    expect(btns[0].title).toBe('Deal flop');
    expect(btns[1]).toBeDisabled();
    expect(btns[2]).toBeDisabled();
    fireEvent.click(btns[0]);
    expect(onDeal).toHaveBeenCalledWith('flop');
  });

  it('turn unlocks after the flop, river after the turn', () => {
    const { container, rerender } = renderStrip({ board: B.slice(0, 3) });
    let btns = container.querySelectorAll('.board-strip-btn');
    expect(btns[1]).not.toBeDisabled();
    expect(btns[2]).toBeDisabled();
    rerender(<BoardStrip board={B.slice(0, 4)} onDeal={vi.fn()} onClearFrom={vi.fn()} />);
    btns = container.querySelectorAll('.board-strip-btn');
    expect(btns[2]).not.toBeDisabled();
  });

  it('a dealt street clears from its index', () => {
    const { container, onClearFrom } = renderStrip({ board: B });
    const btns = container.querySelectorAll('.board-strip-btn');
    expect(btns[0].title).toBe('Clear board');
    expect(btns[1].title).toBe('Clear turn');
    expect(btns[2].title).toBe('Clear river');
    fireEvent.click(btns[0]);
    fireEvent.click(btns[1]);
    fireEvent.click(btns[2]);
    expect(onClearFrom.mock.calls.map((a) => a[0])).toEqual([0, 3, 4]);
  });

  it('passes the size prop through to every board card (mdr = 55px)', () => {
    const { container } = renderStrip({ board: B, size: 'mdr' });
    const flopCards = container.querySelectorAll('.board-flop-cards > *');
    expect(flopCards).toHaveLength(3);
    flopCards.forEach((el) => expect(el.style.width).toBe('55px'));
    const singles = [...container.querySelectorAll('.board-strip-btn')].slice(1)
      .map((b) => b.querySelector('div'));
    singles.forEach((el) => expect(el.style.width).toBe('55px'));
  });
});

describe('RangeMini', () => {
  const RANGE = ['AA', 'AKs', 'AKo']; // one pair, one suited, one offsuit

  it('renders a 169-cell grid classed pair / suited / offsuit', () => {
    const { container } = render(<RangeMini keys={RANGE} />);
    expect(container.querySelectorAll('.range-mini-grid .rmc')).toHaveLength(169);
    expect(container.querySelectorAll('.rmc.pair')).toHaveLength(13);
    expect(container.querySelectorAll('.rmc.suited')).toHaveLength(78);
    expect(container.querySelectorAll('.rmc.offsuit')).toHaveLength(78);
  });

  it("marks 'on' only for keys in the range, tagged by their cell type", () => {
    const { container } = render(<RangeMini keys={RANGE} />);
    expect(container.querySelectorAll('.rmc.on')).toHaveLength(3);
    expect(container.querySelectorAll('.rmc.on.pair')).toHaveLength(1);
    expect(container.querySelectorAll('.rmc.on.suited')).toHaveLength(1);
    expect(container.querySelectorAll('.rmc.on.offsuit')).toHaveLength(1);
  });

  it('splits the count and unit and marks nothing on for an empty range', () => {
    const { container } = render(<RangeMini keys={[]} />);
    expect(container.querySelectorAll('.rmc.on')).toHaveLength(0);
    expect(container.querySelector('.range-mini-count').textContent).toBe('0');
    expect(container.querySelector('.range-mini-unit').textContent).toBe('hands');
    expect(screen.queryByText('0 hands')).toBeNull();
  });
});
