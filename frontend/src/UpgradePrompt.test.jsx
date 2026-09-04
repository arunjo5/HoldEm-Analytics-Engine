import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { UpgradePrompt } from './UpgradePrompt.jsx';
import { PRO_FEATURES } from './PlansView.jsx';

function renderPrompt(over = {}) {
  const props = {
    open: true, cap: 25, busy: false,
    onClose: vi.fn(), onCompare: vi.fn(), onUpgrade: vi.fn(),
    ...over,
  };
  const utils = render(<UpgradePrompt {...props} />);
  return { ...utils, props };
}

const dialog = () => screen.getByRole('dialog', { name: 'Your hand history is full' });

describe('UpgradePrompt', () => {
  it('renders nothing when closed', () => {
    const { container } = renderPrompt({ open: false });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names the cap in the copy and quotes the annual price', () => {
    renderPrompt({ cap: 25 });
    expect(within(dialog()).getByText(/Free accounts keep the 25 most recent hands/)).toBeInTheDocument();
    expect(screen.getByText('Pro is $5 a month, billed yearly. Cancel anytime.')).toBeInTheDocument();
  });

  it('takes the cap from props rather than hardcoding 25', () => {
    renderPrompt({ cap: 50 });
    expect(within(dialog()).getByText(/keep the 50 most recent hands/)).toBeInTheDocument();
  });

  it('lists the pro features minus the everything-in-free line', () => {
    renderPrompt();
    const items = dialog().querySelectorAll('.plan-feats li');
    expect([...items].map((li) => li.textContent)).toEqual(PRO_FEATURES.slice(1));
    expect(within(dialog()).queryByText('Everything in Free')).toBeNull();
  });

  it('wires Compare plans, Not now, Upgrade to Pro and the × to their handlers', () => {
    const { props } = renderPrompt();
    const compare = screen.getByRole('button', { name: 'Compare plans' });
    expect(compare).toHaveClass('link-btn');
    fireEvent.click(compare);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));
    fireEvent.click(screen.getByLabelText('Close'));
    expect(props.onCompare).toHaveBeenCalledTimes(1);
    expect(props.onUpgrade).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(2); // Not now + ×
  });

  it('busy disables only the upgrade button', () => {
    renderPrompt({ busy: true });
    expect(screen.getByRole('button', { name: 'Upgrade to Pro' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Compare plans' })).toBeEnabled();
  });

  it('closes on a backdrop click but not on a click inside the modal', () => {
    const { props } = renderPrompt();
    fireEvent.click(dialog());
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('.picker-overlay'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
