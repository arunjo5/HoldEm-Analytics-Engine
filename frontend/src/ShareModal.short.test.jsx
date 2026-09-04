import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ShareModal } from './ShareModal.jsx';

const SCENARIO_URL = 'http://x/#s=abc';
const REPLAY_URL = 'http://x/#r=xyz';
const SHORT_URL = 'http://x/s/AbCdEf12';

// a promise the test resolves by hand, to hold the modal in its pending state
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

const shortProps = (over = {}) => ({
  pro: true,
  signedIn: true,
  create: vi.fn().mockResolvedValue({ ok: true, url: SHORT_URL }),
  onUpgrade: vi.fn(),
  ...over,
});

function renderModal(over = {}) {
  const props = { open: true, onClose: vi.fn(), url: SCENARIO_URL, short: shortProps(), ...over };
  const utils = render(<ShareModal {...props} />);
  return { ...utils, props };
}

const createBtn = () => screen.getByRole('button', { name: 'Create' });
const clickCreate = async () => { await act(async () => { fireEvent.click(createBtn()); }); };
const errorText = () => screen.queryByRole('alert')?.textContent;

afterEach(() => {
  vi.useRealTimers();
  delete window.navigator.clipboard;
});

describe('ShareModal short link — pro', () => {
  it('offers the permanent-link section with a Create button', () => {
    renderModal();
    expect(screen.getByText('Permanent short link')).toBeInTheDocument();
    expect(screen.getByText('A short link that never breaks, listed under your account.')).toBeInTheDocument();
    expect(createBtn()).toBeEnabled();
    expect(document.querySelector('.share-pro-tease')).toBeNull();
  });

  it('is absent entirely when no short prop is passed', () => {
    renderModal({ short: undefined });
    expect(screen.queryByText('Permanent short link')).toBeNull();
    expect(document.querySelector('.share-short')).toBeNull();
    expect(document.querySelector('.share-pro-tease')).toBeNull();
  });

  it('creates from the scenario hash of the long url', async () => {
    const { props } = renderModal();
    await clickCreate();
    expect(props.short.create).toHaveBeenCalledWith('scenario', 'abc');
    expect(screen.getByDisplayValue(SHORT_URL)).toBeInTheDocument();
  });

  it('creates from the replay hash of the long url', async () => {
    const { props } = renderModal({ url: REPLAY_URL });
    await clickCreate();
    expect(props.short.create).toHaveBeenCalledWith('replay', 'xyz');
  });

  it('reads Creating… and is disabled while the request is in flight', async () => {
    const d = deferred();
    renderModal({ short: shortProps({ create: vi.fn(() => d.promise) }) });
    fireEvent.click(createBtn());
    const busy = screen.getByRole('button', { name: 'Creating…' });
    expect(busy).toBeDisabled();
    await act(async () => { d.resolve({ ok: true, url: SHORT_URL }); });
    expect(screen.getByDisplayValue(SHORT_URL)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Creating|Create/ })).toBeNull();
  });

  it('shows the short url read-only with the retention hint', async () => {
    renderModal();
    await clickCreate();
    const input = screen.getByDisplayValue(SHORT_URL);
    expect(input).toHaveAttribute('readonly');
    expect(input).toHaveClass('share-link-short');
    expect(screen.getByText('Stays live until you delete it from Hand History → Links.')).toBeInTheDocument();
  });

  it('copies the short url and reverts the label after 1.8s', async () => {
    const writeText = stubClipboard();
    renderModal();
    await clickCreate();
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });
    expect(writeText).toHaveBeenCalledWith(SHORT_URL);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1800); });
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('a blocked clipboard leaves the Copy label alone instead of throwing', async () => {
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true,
    });
    renderModal();
    await clickCreate();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('surfaces the server error in an alert and keeps the Create button', async () => {
    renderModal({ short: shortProps({ create: vi.fn().mockResolvedValue({ ok: false, error: 'Pro only' }) }) });
    await clickCreate();
    expect(errorText()).toBe('Pro only');
    expect(document.querySelector('.share-error')).toBeInTheDocument();
    expect(createBtn()).toBeEnabled();
  });

  it('falls back to a generic message when the failure carries no error text', async () => {
    renderModal({ short: shortProps({ create: vi.fn().mockResolvedValue({ ok: false }) }) });
    await clickCreate();
    expect(errorText()).toBe('Could not create the link.');
  });

  it('treats an ok result with no url as a failure', async () => {
    renderModal({ short: shortProps({ create: vi.fn().mockResolvedValue({ ok: true }) }) });
    await clickCreate();
    expect(errorText()).toBe('Could not create the link.');
    expect(screen.queryByText('Stays live until you delete it from Hand History → Links.')).toBeNull();
  });

  it('refuses a url with nothing to shorten, without calling create', async () => {
    const { props } = renderModal({ url: 'http://x/' });
    await clickCreate();
    expect(errorText()).toBe('Nothing to shorten yet.');
    expect(props.short.create).not.toHaveBeenCalled();
  });

  it('clears the error on the next attempt', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'Rate limited' })
      .mockResolvedValueOnce({ ok: true, url: SHORT_URL });
    renderModal({ short: shortProps({ create }) });
    await clickCreate();
    expect(errorText()).toBe('Rate limited');
    await clickCreate();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByDisplayValue(SHORT_URL)).toBeInTheDocument();
  });

  it('resets the created link when the modal reopens', async () => {
    const props = { open: true, onClose: vi.fn(), url: SCENARIO_URL, short: shortProps() };
    const { rerender } = render(<ShareModal {...props} />);
    await clickCreate();
    expect(screen.getByDisplayValue(SHORT_URL)).toBeInTheDocument();
    rerender(<ShareModal {...props} open={false} />);
    rerender(<ShareModal {...props} open />);
    expect(screen.queryByDisplayValue(SHORT_URL)).toBeNull();
    expect(createBtn()).toBeInTheDocument();
  });

  it('resets a pending error when the modal reopens', async () => {
    const props = {
      open: true, onClose: vi.fn(), url: 'http://x/', short: shortProps(),
    };
    const { rerender } = render(<ShareModal {...props} />);
    await clickCreate();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(<ShareModal {...props} open={false} />);
    rerender(<ShareModal {...props} open />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('resets when the url changes under an open modal', async () => {
    const props = { open: true, onClose: vi.fn(), url: SCENARIO_URL, short: shortProps() };
    const { rerender } = render(<ShareModal {...props} />);
    await clickCreate();
    expect(screen.getByDisplayValue(SHORT_URL)).toBeInTheDocument();
    rerender(<ShareModal {...props} url={REPLAY_URL} />);
    expect(screen.queryByDisplayValue(SHORT_URL)).toBeNull();
    await clickCreate();
    expect(props.short.create).toHaveBeenLastCalledWith('replay', 'xyz');
  });
});

describe('ShareModal short link — free', () => {
  it('teases Pro with an Upgrade button when signed in', () => {
    const { props } = renderModal({ short: shortProps({ pro: false }) });
    expect(document.querySelector('.share-pro-tease')).toBeInTheDocument();
    expect(screen.getByText('Pro members get a permanent short link that never breaks.')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Upgrade' });
    expect(btn).toHaveClass('link-btn');
    fireEvent.click(btn);
    expect(props.short.onUpgrade).toHaveBeenCalledTimes(1);
  });

  it('reads See Pro when signed out', () => {
    const { props } = renderModal({ short: shortProps({ pro: false, signedIn: false }) });
    fireEvent.click(screen.getByRole('button', { name: 'See Pro' }));
    expect(props.short.onUpgrade).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull();
  });

  it('offers no create path at all', () => {
    renderModal({ short: shortProps({ pro: false }) });
    expect(screen.queryByText('Permanent short link')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
  });

  it('still renders the plain long-link row', async () => {
    renderModal({ short: shortProps({ pro: false }) });
    expect(screen.getByDisplayValue(SCENARIO_URL)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument());
  });
});
