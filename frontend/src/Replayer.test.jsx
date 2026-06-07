import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReplayerView } from './Replayer.jsx';

const card = (s) => ({ v: s[0], s: s[1] });

const HAND = {
  setup: {
    sb: 50,
    bb: 100,
    ante: 0,
    cents: false,
    seats: [
      { name: 'rex', stack: 10000, pos: 'BTN', cards: null },
      { name: 'pranad', stack: 8000, pos: 'SB', cards: [card('Ah'), card('Kh')] },
      { name: 'luc', stack: 12000, pos: 'BB', cards: [card('Qd'), card('Qs')] },
    ],
  },
  actions: [
    { seat: 0, type: 'fold', street: 0 },
    { seat: 1, type: 'call', street: 0 },
    { seat: 2, type: 'check', street: 0 },
  ],
  board: [card('2c'), card('7d'), card('Jh')],
  board2: null,
  won: null,
  runResults: null,
};

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: false, json: async () => ({}) }));
});

const renderReplayer = () =>
  render(<ReplayerView initialHand={HAND} onExit={() => {}} onSaveToHistory={() => {}} />);

describe('ReplayerView', () => {
  it('renders the hand with seat names and nav controls', () => {
    renderReplayer();
    expect(screen.getByText('pranad')).toBeInTheDocument();
    expect(screen.getByText('luc')).toBeInTheDocument();
    expect(screen.getByText('Blinds posted')).toBeInTheDocument();
    expect(screen.getByLabelText('Forward')).toBeInTheDocument();
  });

  it('advances the frame when Forward is clicked', () => {
    renderReplayer();
    expect(screen.getByText('Blinds posted')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Forward'));
    expect(screen.queryByText('Blinds posted')).not.toBeInTheDocument();
  });
});
