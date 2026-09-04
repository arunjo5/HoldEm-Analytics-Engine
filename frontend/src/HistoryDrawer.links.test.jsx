import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { HistoryDrawer } from './HistoryDrawer.jsx';

const c = (s) => ({ v: s[0], s: s[1] });

const histItem = (over = {}) => ({
  id: 'h1', ts: Date.now() - 30_000, name: 'a hand', isReplay: false, replay: null,
  scenario: 'enc', playerCount: 2, boardLen: 3,
  boardPreview: [c('As'), c('Kh'), c('Td')],
  heroCards: [c('As'), c('Kh')], heroLabel: null, heroName: 'Ann',
  heroEquity: 55.46, topName: 'Ann', topEquity: 55.46, starred: false, ...over,
});

const link = (over = {}) => ({
  code: 'AbCdEf12', kind: 'scenario', name: 'Turn probe',
  createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(), views: 3, ...over,
});

const baseProps = () => ({
  open: true, onClose: vi.fn(), history: [], loading: false, error: null,
  onLoad: vi.fn(), onToggleFavorite: vi.fn(), onDelete: vi.fn(), onClear: vi.fn(),
  user: { name: 'Arun', email: 'a@b.c' },
  links: [], linksLoading: false,
  linkUrl: (code) => `https://pokerlab.test/s/${code}`,
  onOpenLink: vi.fn(), onDeleteLink: vi.fn(), onRenameLink: vi.fn(),
});

function renderDrawer(over = {}) {
  const props = { ...baseProps(), ...over };
  const utils = render(<HistoryDrawer {...props} />);
  return { ...utils, props };
}

const tabFor = (label) => screen.getByText(label).closest('button');
const openLinksTab = () => fireEvent.click(tabFor('Links'));
const rowFor = (name) => screen.getByText(name).closest('.link-row');

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

afterEach(() => {
  vi.useRealTimers();
  delete window.navigator.clipboard;
});

describe('HistoryDrawer Links tab visibility', () => {
  it('hides the tab unless links is an array', () => {
    const { rerender, props } = renderDrawer({ links: undefined });
    expect(screen.queryByText('Links')).toBeNull();
    rerender(<HistoryDrawer {...props} links={null} />);
    expect(screen.queryByText('Links')).toBeNull();
    rerender(<HistoryDrawer {...props} links={[]} />);
    expect(screen.getByText('Links')).toBeInTheDocument();
  });

  it('shows the link count and sits after Starred', () => {
    renderDrawer({ links: [link(), link({ code: 'ZZ99zz99', name: 'Second' })] });
    expect(within(tabFor('Links')).getByText('2')).toBeInTheDocument();
    const tabs = [...document.querySelectorAll('.drawer-tab')].map(b => b.textContent);
    expect(tabs).toEqual(['All0', 'Starred0', 'Links2']);
  });

  it('hides Clear all while the Links tab is active and brings it back on All', () => {
    renderDrawer({ history: [histItem()], links: [link()] });
    expect(screen.getByText('Clear all')).toBeInTheDocument();
    openLinksTab();
    expect(screen.queryByText('Clear all')).toBeNull();
    fireEvent.click(tabFor('All'));
    expect(screen.getByText('Clear all')).toBeInTheDocument();
  });

  it('survives the links prop going away while the Links tab is active', () => {
    const props = { ...baseProps(), links: [link()] };
    const { rerender } = render(<HistoryDrawer {...props} />);
    openLinksTab();
    expect(screen.getByText('Turn probe')).toBeInTheDocument();
    rerender(<HistoryDrawer {...props} links={undefined} />);
    expect(screen.queryByText('Links')).toBeNull();
    expect(screen.queryByText('Turn probe')).toBeNull();
    expect(tabFor('All')).toHaveClass('active');
  });

  it('reopening drops back to the All tab', () => {
    const props = { ...baseProps(), links: [link()] };
    const { rerender } = render(<HistoryDrawer {...props} />);
    openLinksTab();
    expect(screen.getByText('Turn probe')).toBeInTheDocument();
    rerender(<HistoryDrawer {...props} open={false} />);
    rerender(<HistoryDrawer {...props} open />);
    expect(screen.queryByText('Turn probe')).toBeNull();
    expect(tabFor('All').className).toContain('active');
  });
});

describe('HistoryDrawer Links tab body', () => {
  it('shows the loading state', () => {
    renderDrawer({ links: [], linksLoading: true });
    openLinksTab();
    expect(screen.getByText('Loading links…')).toBeInTheDocument();
  });

  it('shows the empty state when there are no links', () => {
    renderDrawer({ links: [] });
    openLinksTab();
    expect(screen.getByText('No short links yet')).toBeInTheDocument();
    expect(screen.getByText('Open Share on a spot or replay and create a permanent link.')).toBeInTheDocument();
  });

  it('leaves the hand list alone while the Links tab is up', () => {
    renderDrawer({ history: [histItem({ name: 'a hand' })], links: [link()] });
    openLinksTab();
    expect(screen.queryByText('a hand')).toBeNull();
    expect(screen.getByText('Turn probe')).toBeInTheDocument();
  });

  it('renders a row per link: badge, name, time, bare url, view count', () => {
    renderDrawer({
      links: [
        link(),
        link({ code: 'RePl4y00', kind: 'replay', name: null, views: 1 }),
      ],
    });
    openLinksTab();
    const spot = rowFor('Turn probe');
    expect(within(spot).getByText('SPOT')).toBeInTheDocument();
    expect(within(spot).getByText('2h ago')).toBeInTheDocument();
    expect(within(spot).getByText('pokerlab.test/s/AbCdEf12')).toBeInTheDocument();
    expect(within(spot).getByText('3 views')).toBeInTheDocument();

    const replay = rowFor('Untitled');
    expect(within(replay).getByText('REPLAY')).toBeInTheDocument();
    expect(within(replay).getByText('pokerlab.test/s/RePl4y00')).toBeInTheDocument();
    expect(within(replay).getByText('1 view')).toBeInTheDocument();
  });

  it('opens a link from its row body', () => {
    const { props } = renderDrawer({ links: [link()] });
    openLinksTab();
    fireEvent.click(rowFor('Turn probe').querySelector('.link-load'));
    expect(props.onOpenLink).toHaveBeenCalledWith('AbCdEf12');
  });

  it('deletes a link from its row', () => {
    const { props } = renderDrawer({ links: [link()] });
    openLinksTab();
    fireEvent.click(within(rowFor('Turn probe')).getByLabelText('Delete link'));
    expect(props.onDeleteLink).toHaveBeenCalledWith('AbCdEf12');
  });

  it('copies the row url and reverts the label after 1.5s', async () => {
    const writeText = stubClipboard();
    renderDrawer({ links: [link()] });
    openLinksTab();
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(screen.getByText('Copy')); });
    expect(writeText).toHaveBeenCalledWith('https://pokerlab.test/s/AbCdEf12');
    expect(screen.getByText('Copied')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('keeps the Copy label when the clipboard is blocked', async () => {
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true,
    });
    renderDrawer({ links: [link()] });
    openLinksTab();
    await act(async () => { fireEvent.click(screen.getByText('Copy')); });
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });
});

describe('HistoryDrawer link rename', () => {
  const startRename = () => {
    fireEvent.click(screen.getByText('Rename'));
    return screen.getByLabelText('Link name');
  };
  const typeName = (input, value) => fireEvent.change(input, { target: { value } });

  it('swaps the actions for an input seeded with the current name', () => {
    renderDrawer({ links: [link()] });
    openLinksTab();
    const input = startRename();
    expect(input).toHaveValue('Turn probe');
    expect(input).toHaveAttribute('maxlength', '100');
    expect(screen.queryByText('Copy')).toBeNull();
    expect(screen.queryByText('Rename')).toBeNull();
  });

  it('commits a trimmed name on Enter', () => {
    const { props } = renderDrawer({ links: [link()] });
    openLinksTab();
    const input = startRename();
    typeName(input, '  River bluff  ');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onRenameLink).toHaveBeenCalledWith('AbCdEf12', 'River bluff');
    expect(screen.getByText('Rename')).toBeInTheDocument(); // back to the action row
  });

  it('saves once on Enter even if a blur follows', () => {
    const { props } = renderDrawer({ links: [link()] });
    openLinksTab();
    const input = startRename();
    typeName(input, 'River bluff');
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.blur(input);
    });
    expect(props.onRenameLink).toHaveBeenCalledTimes(1);
  });

  it('Escape cancels without renaming and restores the old name', () => {
    const { props } = renderDrawer({ links: [link()] });
    openLinksTab();
    const input = startRename();
    typeName(input, 'Discard me');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(props.onRenameLink).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Link name')).toBeNull();
    expect(screen.getByText('Turn probe')).toBeInTheDocument();
    expect(startRename()).toHaveValue('Turn probe'); // draft reseeded, not left dirty
  });

  it('ignores other keys while editing', () => {
    const { props } = renderDrawer({ links: [link()] });
    openLinksTab();
    const input = startRename();
    typeName(input, 'Still typing');
    fireEvent.keyDown(input, { key: 'a' });
    expect(props.onRenameLink).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Link name')).toBeInTheDocument();
  });

  it('commits on blur too', () => {
    const { props } = renderDrawer({ links: [link()] });
    openLinksTab();
    const input = startRename();
    fireEvent.change(input, { target: { value: 'Blur name' } });
    fireEvent.blur(input);
    expect(props.onRenameLink).toHaveBeenCalledWith('AbCdEf12', 'Blur name');
  });

  it('names an untitled link', () => {
    const { props } = renderDrawer({ links: [link({ name: null })] });
    openLinksTab();
    const input = startRename();
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'Named now' } });
    fireEvent.blur(input);
    expect(props.onRenameLink).toHaveBeenCalledWith('AbCdEf12', 'Named now');
  });

  it('clears a name back to empty', () => {
    const { props } = renderDrawer({ links: [link()] });
    openLinksTab();
    const input = startRename();
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(props.onRenameLink).toHaveBeenCalledWith('AbCdEf12', '');
  });

  it('does nothing when the name is unchanged', () => {
    const { props } = renderDrawer({ links: [link()] });
    openLinksTab();
    fireEvent.blur(startRename());
    expect(props.onRenameLink).not.toHaveBeenCalled();
    expect(screen.getByText('Rename')).toBeInTheDocument();
  });

  it('does nothing when only surrounding whitespace changed', () => {
    const { props } = renderDrawer({ links: [link()] });
    openLinksTab();
    const input = startRename();
    fireEvent.change(input, { target: { value: '  Turn probe  ' } });
    fireEvent.blur(input);
    expect(props.onRenameLink).not.toHaveBeenCalled();
  });

  it('does nothing when an untitled link is left blank', () => {
    const { props } = renderDrawer({ links: [link({ name: null })] });
    openLinksTab();
    fireEvent.blur(startRename());
    expect(props.onRenameLink).not.toHaveBeenCalled();
  });

  it('renames only the row it was started from', () => {
    const { props } = renderDrawer({
      links: [link(), link({ code: 'ZZ99zz99', name: 'Second' })],
    });
    openLinksTab();
    fireEvent.click(within(rowFor('Second')).getByText('Rename'));
    const input = screen.getByLabelText('Link name');
    fireEvent.change(input, { target: { value: 'Second edited' } });
    fireEvent.blur(input);
    expect(props.onRenameLink).toHaveBeenCalledTimes(1);
    expect(props.onRenameLink).toHaveBeenCalledWith('ZZ99zz99', 'Second edited');
  });
});
