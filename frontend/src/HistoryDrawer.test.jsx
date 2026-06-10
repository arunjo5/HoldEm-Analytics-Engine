import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HistoryDrawer } from './HistoryDrawer.jsx';

const c = (s) => ({ v: s[0], s: s[1] });

const item = (over = {}) => ({
  id: 'h1', ts: Date.now() - 30_000, name: null, isReplay: false, replay: null,
  scenario: 'enc', playerCount: 2, boardLen: 3,
  boardPreview: [c('As'), c('Kh'), c('Td')],
  heroCards: [c('As'), c('Kh')], heroLabel: null, heroName: 'Ann',
  heroEquity: 55.46, topName: 'Ann', topEquity: 55.46, starred: false, ...over,
});

const baseProps = () => ({
  open: true, onClose: vi.fn(), history: [], loading: false, error: null,
  onLoad: vi.fn(), onToggleFavorite: vi.fn(), onDelete: vi.fn(), onClear: vi.fn(),
  user: { name: 'Arun', email: 'a@b.c' },
});

function renderDrawer(over = {}) {
  const props = { ...baseProps(), ...over };
  const utils = render(<HistoryDrawer {...props} />);
  return { ...utils, props };
}

const tabFor = (label) => screen.getByText(label).closest('button');

describe('HistoryDrawer', () => {
  it('shows tab counts and filters to starred rows', () => {
    renderDrawer({
      history: [
        item({ id: 'a', name: 'one' }),
        item({ id: 'b', name: 'two', starred: true }),
        item({ id: 'c', name: 'three' }),
      ],
    });
    expect(within(tabFor('All')).getByText('3')).toBeInTheDocument();
    expect(within(tabFor('Starred')).getByText('1')).toBeInTheDocument();
    fireEvent.click(tabFor('Starred'));
    expect(screen.getByText('two')).toBeInTheDocument();
    expect(screen.queryByText('one')).toBeNull();
    expect(screen.queryByText('three')).toBeNull();
  });

  it('clear-all requires the inline confirm before calling onClear', () => {
    const { props } = renderDrawer({ history: [item()] });
    fireEvent.click(screen.getByText('Clear all'));
    expect(screen.getByText('Clear unfavorited?')).toBeInTheDocument();
    expect(props.onClear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Clear'));
    expect(props.onClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Clear unfavorited?')).toBeNull();
  });

  it('cancel dismisses the confirm without clearing', () => {
    const { props } = renderDrawer({ history: [item()] });
    fireEvent.click(screen.getByText('Clear all'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(props.onClear).not.toHaveBeenCalled();
    expect(screen.queryByText('Clear unfavorited?')).toBeNull();
    expect(screen.getByText('Clear all')).toBeInTheDocument();
  });

  it('reopening resets the filter and the pending clear confirm', () => {
    const props = {
      ...baseProps(),
      history: [item({ id: 'a', name: 'one' }), item({ id: 'b', name: 'two', starred: true })],
    };
    const { rerender } = render(<HistoryDrawer {...props} />);
    fireEvent.click(tabFor('Starred'));
    fireEvent.click(screen.getByText('Clear all'));
    expect(screen.queryByText('one')).toBeNull();
    rerender(<HistoryDrawer {...props} open={false} />);
    rerender(<HistoryDrawer {...props} open={true} />);
    expect(screen.getByText('one')).toBeInTheDocument();
    expect(screen.queryByText('Clear unfavorited?')).toBeNull();
    expect(tabFor('All').className).toContain('active');
  });

  it('renders loading, error, and per-filter empty states', () => {
    const { rerender, props } = renderDrawer({ loading: true });
    expect(screen.getByText('Loading hand history…')).toBeInTheDocument();
    rerender(<HistoryDrawer {...props} loading={false} error="HTTP 500" />);
    expect(screen.getByText("Couldn't load history")).toBeInTheDocument();
    expect(screen.getByText('HTTP 500')).toBeInTheDocument();
    rerender(<HistoryDrawer {...props} loading={false} error={null} history={[]} />);
    expect(screen.getByText('No saved hands yet')).toBeInTheDocument();
    rerender(<HistoryDrawer {...props} loading={false} error={null} history={[item()]} />);
    fireEvent.click(tabFor('Starred'));
    expect(screen.getByText('No favorited hands yet')).toBeInTheDocument();
  });

  it('renders replay rows with badge, blinds, and action count pluralization', () => {
    renderDrawer({
      history: [
        item({ id: 'r1', isReplay: true, replay: {}, blindsLabel: '50/100', actionCount: 2, heroEquity: null }),
        item({ id: 'r2', isReplay: true, replay: {}, blindsLabel: '1/2', actionCount: 1, heroEquity: null }),
      ],
    });
    expect(screen.getAllByText('REPLAY')).toHaveLength(2);
    expect(screen.getAllByText('Full hand')).toHaveLength(2);
    expect(screen.getByText('50/100')).toBeInTheDocument();
    expect(screen.getByText(/2 actions · click to replay/)).toBeInTheDocument();
    expect(screen.getByText(/1 action · click to replay/)).toBeInTheDocument();
    expect(screen.getAllByText('Stored hand')).toHaveLength(2);
  });

  it('renders scenario rows: stage label, equity pill, T as 10, leader sub', () => {
    renderDrawer({
      history: [
        item({ id: 'b0', boardLen: 0 }),
        item({ id: 'b3', boardLen: 3, topName: 'Bob', topEquity: 60.24 }),
        item({ id: 'b4', boardLen: 4 }),
        item({ id: 'b5', boardLen: 5 }),
        item({ id: 'b2', boardLen: 2 }),
      ],
    });
    expect(screen.getByText('Pre-flop')).toBeInTheDocument();
    expect(screen.getByText('Flop')).toBeInTheDocument();
    expect(screen.getByText('Turn')).toBeInTheDocument();
    expect(screen.getByText('River')).toBeInTheDocument();
    expect(screen.getByText('2 board')).toBeInTheDocument();
    expect(screen.getAllByText('55.5%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('10').length).toBeGreaterThan(0); // Td in boardPreview
    // leader sub only where topName !== heroName
    expect(screen.getAllByText(/leader Bob 60\.2%/)).toHaveLength(1);
  });

  it('star button label flips with starred state and fires the right callbacks', () => {
    const { props } = renderDrawer({
      history: [item({ id: 'a', name: 'one' }), item({ id: 'b', name: 'two', starred: true })],
    });
    const rowA = screen.getByText('one').closest('.hist-row');
    const rowB = screen.getByText('two').closest('.hist-row');
    fireEvent.click(within(rowA).getByLabelText('Favorite'));
    expect(props.onToggleFavorite).toHaveBeenCalledWith('a', true);
    fireEvent.click(within(rowB).getByLabelText('Unfavorite'));
    expect(props.onToggleFavorite).toHaveBeenCalledWith('b', false);
    fireEvent.click(within(rowA).getByLabelText('Delete'));
    expect(props.onDelete).toHaveBeenCalledWith('a');
    fireEvent.click(within(rowA).getByText('one'));
    expect(props.onLoad).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('signed out shows the sync prompt and hides the 500-hand cap note', () => {
    renderDrawer({ user: null, history: [item()] });
    expect(screen.getByText('Sign in to sync across devices')).toBeInTheDocument();
    expect(screen.queryByText(/500 hands/)).toBeNull();
  });
});
