import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { PlayingCard, CardChip } from './Cards.jsx';
import { PlayerSeat } from './Seat.jsx';
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
