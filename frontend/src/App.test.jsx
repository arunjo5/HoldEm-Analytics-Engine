import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import App from './App.jsx';
import { AuthProvider } from './AuthContext.jsx';

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: false, json: async () => ({}) }));
});

const renderApp = () => render(
  <AuthProvider>
    <App />
  </AuthProvider>
);

describe('App (calculator)', () => {
  it('renders the toolbar and the pot-odds panel', () => {
    renderApp();
    expect(screen.getByRole('button', { name: /clear all/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /replayer/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload log/i })).toBeInTheDocument();
    expect(screen.getByText('Pot odds')).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText('0').length).toBeGreaterThanOrEqual(2);
  });

  it('computes pot odds from the pot and call inputs', () => {
    renderApp();
    const inputs = screen.getAllByPlaceholderText('0');
    fireEvent.change(inputs[0], { target: { value: '100' } });
    fireEvent.change(inputs[1], { target: { value: '50' } });
    expect(screen.getByText('25.0%')).toBeInTheDocument();
  });
});
