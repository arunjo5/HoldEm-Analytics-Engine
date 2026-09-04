import React from 'react';
import { FeatureList, PRO_FEATURES } from './PlansView.jsx';

// shown once per session when a free account fills its hand history
export function UpgradePrompt({ open, cap, busy, onClose, onCompare, onUpgrade }) {
  if (!open) return null;
  return (
    <div className="picker-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="share-modal upgrade-modal" role="dialog" aria-label="Your hand history is full">
        <div className="share-head">
          <div>
            <div className="auth-title">Your hand history is full</div>
            <div className="auth-sub">Free accounts keep the {cap} most recent hands. Older ones get replaced as you save new ones.</div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="share-body">
          <FeatureList items={PRO_FEATURES.slice(1)} />
          <div className="upgrade-price">Pro is $5 a month, billed yearly. Cancel anytime.</div>
          <div className="upgrade-foot">
            <button className="link-btn" onClick={onCompare}>Compare plans</button>
            <button className="btn btn-ghost" onClick={onClose}>Not now</button>
            <button className="btn btn-primary" onClick={onUpgrade} disabled={busy}>Upgrade to Pro</button>
          </div>
        </div>
      </div>
    </div>
  );
}
