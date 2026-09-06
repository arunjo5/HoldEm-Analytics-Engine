import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import { LibraryProvider } from './LibraryContext.jsx';
import { RangePicker } from './Pickers.jsx';

const ok = (data) => ({ ok: true, status: 200, json: async () => data });
const fail = (status = 500, data = {}) => ({ ok: false, status, json: async () => data });

// url-substring router; first matching key wins, sane auth defaults
function mockFetch(routes = {}) {
  const fn = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    for (const key of Object.keys(routes)) {
      if (u.includes(key)) {
        const h = routes[key];
        return typeof h === 'function' ? h(u, opts) : h;
      }
    }
    if (u.includes('/api/auth/session')) return ok({ user: null });
    if (u.includes('/api/auth/providers')) return ok({});
    if (u.includes('/api/auth/csrf')) return ok({ csrfToken: 'tok' });
    return fail(404);
  });
  global.fetch = fn;
  return fn;
}

const callsTo = (substr, method) =>
  global.fetch.mock.calls.filter(([u, o]) =>
    String(u).includes(substr) && (!method || ((o && o.method) || 'GET') === method));
const bodyOf = (substr, method) => JSON.parse(callsTo(substr, method)[0][1].body);

const USER = { name: 'Arun', email: 'a@b.c' };
const status = (over = {}) => ok({ plan: 'free', saveCap: 25, saved: 0, billingEnabled: true, ...over });
const range = (id, name, keys) => ({ id, name, keys });
const SAVED = [range('r1', 'BTN open', ['AA', 'AKs']), range('r2', 'BB defend', ['QQ'])];

// a route that stays pending until resolved, for the loading state
function pending() {
  let settle;
  const promise = new Promise((res) => { settle = res; });
  return { handler: () => promise, resolve: async (v) => { await act(async () => { settle(v); }); } };
}

function NonceProbe() {
  const { plansNonce } = useAuth();
  return <div data-testid="nonce">{plansNonce}</div>;
}

function renderPicker({ initial = ['AA'], routes = {} } = {}) {
  mockFetch({ '/api/auth/session': ok({ user: USER }), '/api/billing/status': status(), ...routes });
  const onCancel = vi.fn();
  const onSave = vi.fn();
  const utils = render(
    <AuthProvider>
      <LibraryProvider>
        <NonceProbe />
        <RangePicker initial={initial} onCancel={onCancel} onSave={onSave} />
      </LibraryProvider>
    </AuthProvider>,
  );
  return { ...utils, onCancel, onSave };
}

// "Save to My ranges" also matches a loose /My ranges/, so anchor the trigger
const myRangesBtn = () => screen.queryByRole('button', { name: /^My ranges/ });
const saveToLibBtn = () => screen.queryByRole('button', { name: 'Save to My ranges' });
const menu = () => document.querySelector('.myranges-menu');
const rows = () => [...document.querySelectorAll('.myrange-row')];
const msgEl = () => document.querySelector('.range-save-msg');
const subText = () => document.querySelector('.picker-sub').textContent;
const activeKeys = () =>
  [...document.querySelectorAll('.rg-cell')].filter((el) => el.style.fontWeight !== '').map((el) => el.textContent);
const nameInput = () => screen.queryByLabelText('Range name');
const openMenu = async () => { await waitFor(() => expect(myRangesBtn()).toBeInTheDocument()); fireEvent.click(myRangesBtn()); };
const typeName = (v) => fireEvent.change(nameInput(), { target: { value: v } });
const formBtn = (name) => within(document.querySelector('.range-save-form')).getByRole('button', { name });
const submitSave = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); }); };

beforeEach(() => { mockFetch(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('RangePicker signed out', () => {
  it('renders none of the library controls and asks the server for nothing', async () => {
    render(<RangePicker initial={['AA']} onCancel={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Preset/ })).toBeInTheDocument();
    expect(myRangesBtn()).toBeNull();
    expect(saveToLibBtn()).toBeNull();
    expect(document.querySelector('.range-save-row')).toBeNull();
    await waitFor(() => expect(callsTo('/api/ranges')).toHaveLength(0));
  });

  it('a signed-out provider is treated the same way', async () => {
    mockFetch({ '/api/billing/status': status() });
    render(<AuthProvider><LibraryProvider><RangePicker initial={['AA']} onCancel={vi.fn()} onSave={vi.fn()} /></LibraryProvider></AuthProvider>);
    await waitFor(() => expect(callsTo('/api/billing/status')).toHaveLength(1));
    expect(myRangesBtn()).toBeNull();
    expect(saveToLibBtn()).toBeNull();
    expect(callsTo('/api/ranges')).toHaveLength(0);
  });
});

describe('My ranges dropdown', () => {
  it('fetches the saved list without being asked and lists each range with its combo count', async () => {
    renderPicker({ routes: { '/api/ranges': ok({ ranges: SAVED }) } });
    expect(menu()).toBeNull(); // closed until clicked
    await openMenu();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows()[0].querySelector('.myrange-name').textContent).toBe('BTN open');
    expect(rows()[0].querySelector('.myrange-count').textContent).toBe('10 combos');
    expect(rows()[1].querySelector('.myrange-count').textContent).toBe('6 combos');
    // once loaded the list is left alone, however often the menu is toggled
    const n = callsTo('/api/ranges', 'GET').length;
    fireEvent.click(myRangesBtn());
    fireEvent.click(myRangesBtn());
    expect(callsTo('/api/ranges', 'GET')).toHaveLength(n);
  });

  it('picking a saved range replaces the selection and closes the menu', async () => {
    renderPicker({ initial: ['22'], routes: { '/api/ranges': ok({ ranges: SAVED }) } });
    await openMenu();
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(rows()[0].querySelector('.myrange-item'));
    expect(menu()).toBeNull();
    expect(activeKeys().sort()).toEqual(['AA', 'AKs']);
    expect(subText()).toBe('10 combos · 0.8% of all hands');
  });

  it('the delete button removes the row and DELETEs the id', async () => {
    renderPicker({ routes: { '/api/ranges': (u, o) => (o.method === 'DELETE' ? ok({}) : ok({ ranges: SAVED })) } });
    await openMenu();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete BTN open' })); });
    expect(callsTo('/api/ranges/r1', 'DELETE')).toHaveLength(1);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector('.myrange-name').textContent).toBe('BB defend');
  });

  it('shows Loading… until the list arrives, then the empty state', async () => {
    const list = pending();
    renderPicker({ routes: { '/api/ranges': list.handler } });
    await openMenu();
    expect(document.querySelector('.myranges-empty').textContent).toBe('Loading…');
    await list.resolve(ok({ ranges: [] }));
    expect(document.querySelector('.myranges-empty').textContent).toBe('No saved ranges yet');
  });

  it('a failed list falls back to the empty state', async () => {
    renderPicker({ routes: { '/api/ranges': fail(500) } });
    await openMenu();
    await waitFor(() => expect(document.querySelector('.myranges-empty').textContent).toBe('No saved ranges yet'));
  });

  it('closes on an outside mousedown but not on a click inside', async () => {
    renderPicker({ routes: { '/api/ranges': ok({ ranges: SAVED }) } });
    await openMenu();
    fireEvent.mouseDown(menu());
    expect(menu()).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(menu()).toBeNull();
  });

  it('the trigger toggles the menu shut again', async () => {
    renderPicker({ routes: { '/api/ranges': ok({ ranges: SAVED }) } });
    await openMenu();
    fireEvent.click(myRangesBtn());
    expect(menu()).toBeNull();
  });
});

describe('Save to My ranges', () => {
  it('is disabled with nothing selected and enabled once a hand is picked', async () => {
    renderPicker({ initial: [], routes: { '/api/ranges': ok({ ranges: [] }) } });
    await waitFor(() => expect(saveToLibBtn()).toBeInTheDocument());
    expect(saveToLibBtn()).toBeDisabled();
    fireEvent.mouseDown(screen.getByText('AA'));
    fireEvent.mouseUp(window);
    expect(saveToLibBtn()).toBeEnabled();
  });

  it('toggles the inline form, which gates Save on a non-blank name', async () => {
    renderPicker({ routes: { '/api/ranges': ok({ ranges: [] }) } });
    await waitFor(() => expect(saveToLibBtn()).toBeInTheDocument());
    expect(nameInput()).toBeNull();
    fireEvent.click(saveToLibBtn());
    const input = nameInput();
    expect(input).toHaveAttribute('maxLength', '60');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    typeName('   ');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    typeName('BTN open');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(saveToLibBtn()); // the footer button closes it again
    expect(nameInput()).toBeNull();
  });

  it('Cancel closes the form without posting', async () => {
    renderPicker({ routes: { '/api/ranges': ok({ ranges: [] }) } });
    await waitFor(() => expect(saveToLibBtn()).toBeInTheDocument());
    fireEvent.click(saveToLibBtn());
    typeName('BTN open');
    fireEvent.click(formBtn('Cancel'));
    expect(nameInput()).toBeNull();
    expect(callsTo('/api/ranges', 'POST')).toHaveLength(0);
  });

  it('posts the name and keys, confirms, and closes the form', async () => {
    renderPicker({
      initial: ['AA', 'AKs'],
      routes: { '/api/ranges': (u, o) => (o.method === 'POST' ? ok({ range: range('r9', 'BTN open', ['AA', 'AKs']) }) : ok({ ranges: [] })) },
    });
    await waitFor(() => expect(saveToLibBtn()).toBeInTheDocument());
    fireEvent.click(saveToLibBtn());
    typeName('  BTN open  ');
    await submitSave();
    expect(bodyOf('/api/ranges', 'POST')).toEqual({ name: 'BTN open', keys: ['AA', 'AKs'] });
    expect(msgEl()).toHaveClass('ok');
    expect(msgEl()).toHaveAttribute('role', 'status');
    expect(msgEl().textContent).toBe('Saved “BTN open”');
    expect(nameInput()).toBeNull();
  });

  it('the saved range joins the dropdown straight away', async () => {
    renderPicker({
      routes: { '/api/ranges': (u, o) => (o.method === 'POST' ? ok({ range: range('r9', 'BTN open', ['AA']) }) : ok({ ranges: SAVED })) },
    });
    await waitFor(() => expect(saveToLibBtn()).toBeInTheDocument());
    fireEvent.click(saveToLibBtn());
    typeName('BTN open');
    await submitSave();
    await openMenu();
    expect(rows()).toHaveLength(3);
    expect(rows()[0].querySelector('.myrange-name').textContent).toBe('BTN open');
  });

  it('a limit refusal alerts with an Upgrade to Pro link that opens the plans page', async () => {
    renderPicker({
      routes: {
        '/api/ranges': (u, o) => (o.method === 'POST'
          ? fail(403, { error: 'Free accounts keep 3 saved ranges.', code: 'limit_reached', cap: 3 })
          : ok({ ranges: [] })),
      },
    });
    await waitFor(() => expect(saveToLibBtn()).toBeInTheDocument());
    fireEvent.click(saveToLibBtn());
    typeName('Fourth');
    await submitSave();
    expect(msgEl()).toHaveClass('limit');
    expect(msgEl()).toHaveAttribute('role', 'alert');
    expect(msgEl().textContent).toContain('Free accounts keep 3 saved ranges.');
    expect(nameInput()).not.toBeNull(); // the form stays open to retry
    const upgrade = within(msgEl()).getByRole('button', { name: 'Upgrade to Pro' });
    expect(upgrade).toHaveClass('link-btn');
    expect(screen.getByTestId('nonce').textContent).toBe('0');
    fireEvent.click(upgrade);
    expect(screen.getByTestId('nonce').textContent).toBe('1');
  });

  it('any other failure shows a plain error with no upgrade link', async () => {
    renderPicker({
      routes: { '/api/ranges': (u, o) => (o.method === 'POST' ? fail(500) : ok({ ranges: [] })) },
    });
    await waitFor(() => expect(saveToLibBtn()).toBeInTheDocument());
    fireEvent.click(saveToLibBtn());
    typeName('BTN open');
    await submitSave();
    expect(msgEl()).toHaveClass('err');
    expect(msgEl()).toHaveAttribute('role', 'alert');
    expect(msgEl().textContent).toBe('Request failed (500)');
    expect(within(msgEl()).queryByRole('button')).toBeNull();
  });

  it('reopening the form clears the previous message', async () => {
    renderPicker({
      routes: { '/api/ranges': (u, o) => (o.method === 'POST' ? fail(500) : ok({ ranges: [] })) },
    });
    await waitFor(() => expect(saveToLibBtn()).toBeInTheDocument());
    fireEvent.click(saveToLibBtn());
    typeName('BTN open');
    await submitSave();
    expect(msgEl()).not.toBeNull();
    fireEvent.click(saveToLibBtn());
    expect(msgEl()).toBeNull();
  });

  it('leaves the picker Save range button doing its own job', async () => {
    const { onSave } = renderPicker({ initial: ['AA'], routes: { '/api/ranges': ok({ ranges: [] }) } });
    await waitFor(() => expect(saveToLibBtn()).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save range' }));
    expect(onSave).toHaveBeenCalledWith(['AA']);
    expect(callsTo('/api/ranges', 'POST')).toHaveLength(0);
  });
});
