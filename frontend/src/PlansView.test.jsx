import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PlansView, FeatureList, PRO_FEATURES } from './PlansView.jsx';

const FREE = { plan: 'free', interval: null, saveCap: 25, saved: 0, hasCustomer: false, billingEnabled: true };
const PRO = { ...FREE, plan: 'pro', interval: 'year', hasCustomer: true };
const USER = { name: 'Arun', email: 'a@b.c' };

function renderPlans(over = {}) {
  const props = {
    onExit: vi.fn(),
    onNavigate: vi.fn(),
    themeToggle: <button>theme</button>,
    userMenu: <button>menu</button>,
    user: null,
    plan: FREE,
    onGetPro: vi.fn(async () => ({ ok: true })),
    onCreateAccount: vi.fn(),
    onManage: vi.fn(async () => ({ ok: true })),
    ...over,
  };
  const utils = render(<PlansView {...props} />);
  return { ...utils, props };
}

const proCard = () => within(screen.getByRole('region', { name: 'Pro plan' }));
const freeCard = () => within(screen.getByRole('region', { name: 'Free plan' }));
const price = () => {
  const card = screen.getByRole('region', { name: 'Pro plan' });
  return {
    amount: card.querySelector('.plan-amount').textContent,
    unit: card.querySelector('.plan-unit').textContent,
    note: card.querySelector('.plan-note').textContent,
  };
};
// a deferred promise so the pending CTA state can be inspected
function deferred() {
  let settle;
  const fn = vi.fn(() => new Promise((res) => { settle = res; }));
  return { fn, resolve: async (v) => { await act(async () => { settle(v); }); } };
}

describe('PlansView billing toggle', () => {
  it('defaults to annual: $5 / month billed $60 a year', () => {
    renderPlans();
    expect(price()).toEqual({ amount: '$5', unit: '/ month', note: 'Billed $60 a year.' });
    expect(screen.getByRole('tab', { name: /Annual/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Monthly' })).toHaveAttribute('aria-selected', 'false');
  });

  it('Monthly swaps the price and note, and Annual swaps back', () => {
    renderPlans();
    fireEvent.click(screen.getByRole('tab', { name: 'Monthly' }));
    expect(price()).toEqual({ amount: '$7', unit: '/ month', note: 'Billed month to month.' });
    expect(screen.getByRole('tab', { name: 'Monthly' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Annual/ })).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(screen.getByRole('tab', { name: /Annual/ }));
    expect(price().amount).toBe('$5');
  });

  it('the tablist is labelled and the annual tab advertises the saving', () => {
    renderPlans();
    const list = screen.getByRole('tablist', { name: 'Billing period' });
    expect(within(list).getAllByRole('tab')).toHaveLength(2);
    expect(list.querySelector('.plans-save').textContent).toBe('2 months free');
  });
});

describe('PlansView CTA states', () => {
  it('signed out: create-account on Free, Get Pro plus the sign-in hint on Pro', () => {
    const { props } = renderPlans({ user: null });
    fireEvent.click(freeCard().getByRole('button', { name: 'Create a free account' }));
    expect(props.onCreateAccount).toHaveBeenCalledTimes(1);
    expect(proCard().getByRole('button', { name: 'Get Pro' })).toBeEnabled();
    expect(screen.getByText('You’ll sign in first, then go straight to checkout.')).toBeInTheDocument();
  });

  it('free user: Free is the current plan (disabled) and Pro still sells', () => {
    renderPlans({ user: USER, plan: FREE });
    expect(freeCard().getByRole('button', { name: 'Current plan' })).toBeDisabled();
    expect(freeCard().queryByRole('button', { name: 'Create a free account' })).toBeNull();
    expect(proCard().getByRole('button', { name: 'Get Pro' })).toBeEnabled();
    expect(screen.queryByText(/You’ll sign in first/)).toBeNull();
  });

  it('pro user: Free reads Included in Pro and Pro offers Manage subscription', () => {
    const { props } = renderPlans({ user: USER, plan: PRO });
    expect(freeCard().getByRole('button', { name: 'Included in Pro' })).toBeDisabled();
    expect(proCard().getByRole('button', { name: 'Current plan' })).toBeDisabled();
    expect(proCard().queryByRole('button', { name: 'Get Pro' })).toBeNull();
    fireEvent.click(proCard().getByRole('button', { name: 'Manage subscription' }));
    expect(props.onManage).toHaveBeenCalledTimes(1);
  });
});

describe('PlansView checkout', () => {
  it('Get Pro sends the selected interval', async () => {
    const onGetPro = vi.fn(async () => ({ ok: true }));
    renderPlans({ user: USER, onGetPro });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Get Pro' })); });
    expect(onGetPro).toHaveBeenLastCalledWith('year');
    fireEvent.click(screen.getByRole('tab', { name: 'Monthly' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Get Pro' })); });
    expect(onGetPro).toHaveBeenLastCalledWith('month');
  });

  it('reads Opening checkout… and stays disabled until the promise settles', async () => {
    const d = deferred();
    renderPlans({ user: USER, onGetPro: d.fn });
    fireEvent.click(screen.getByRole('button', { name: 'Get Pro' }));
    const btn = screen.getByRole('button', { name: 'Opening checkout…' });
    expect(btn).toBeDisabled();
    await d.resolve({ ok: true });
    expect(screen.getByRole('button', { name: 'Get Pro' })).toBeEnabled();
  });

  it('an {error} result renders as an alert, and a later success clears it', async () => {
    let res = { error: 'Card declined' };
    const onGetPro = vi.fn(async () => res);
    renderPlans({ user: USER, onGetPro });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Get Pro' })); });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('plans-error');
    expect(alert).toHaveTextContent('Card declined');
    res = { ok: true };
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Get Pro' })); });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a failing Manage subscription surfaces the same way', async () => {
    const onManage = vi.fn(async () => ({ error: 'Could not open billing (500)' }));
    renderPlans({ user: USER, plan: PRO, onManage });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Manage subscription' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not open billing (500)');
  });

  it('Manage subscription is disabled while its promise is pending', async () => {
    const d = deferred();
    renderPlans({ user: USER, plan: PRO, onManage: d.fn });
    fireEvent.click(screen.getByRole('button', { name: 'Manage subscription' }));
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toBeDisabled();
    await d.resolve({ ok: true });
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toBeEnabled();
  });
});

describe('PlansView chrome', () => {
  it('the brand exits and the toolbar navigates to the other views', () => {
    const { props } = renderPlans();
    fireEvent.click(screen.getByRole('button', { name: 'PokerLab' }));
    expect(props.onExit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Calculator' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replayer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Solver' }));
    expect(props.onNavigate.mock.calls.map(([v]) => v)).toEqual(['calc', 'replayer', 'solver']);
  });

  it('renders the shared theme/account slots, the title and the footer', () => {
    renderPlans();
    expect(screen.getByText('theme')).toBeInTheDocument();
    expect(screen.getByText('menu')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Study for free. Keep everything with Pro.' })).toBeInTheDocument();
    expect(screen.getByText('Cancel anytime.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('each card lists its own features', () => {
    renderPlans();
    PRO_FEATURES.forEach((f) => expect(proCard().getByText(f)).toBeInTheDocument());
    expect(freeCard().getByText('Save up to 25 hands')).toBeInTheDocument();
    expect(freeCard().getByText('Heads-up river solver')).toBeInTheDocument();
  });
});

describe('FeatureList', () => {
  it('renders one checked row per item', () => {
    const { container } = render(<FeatureList items={['a', 'b']} />);
    const rows = container.querySelectorAll('ul.plan-feats li');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toBe('a');
    expect(rows[0].querySelector('svg')).toBeInTheDocument();
  });

  it('PRO_FEATURES leads with the everything-in-free line', () => {
    expect(PRO_FEATURES[0]).toBe('Everything in Free');
    expect(PRO_FEATURES.length).toBeGreaterThan(1);
  });
});
