import React, { useEffect, useRef, useState } from 'react';

/**
 * ShareModal — copy-to-clipboard link with hash-encoded scenario.
 * Friends opening the link will get the exact same setup loaded.
 */
export function ShareModal({ open, onClose, url }) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    setTimeout(() => inputRef.current?.select(), 60);
  }, [open]);

  if (!open) return null;

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        inputRef.current?.select();
        document.execCommand('copy');
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore — user can copy manually from the field
    }
  }

  return (
    <div className="picker-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="share-modal" role="dialog" aria-label="Share scenario">
        <div className="share-head">
          <div>
            <div className="auth-title">Share scenario</div>
            <div className="auth-sub">
              Friends opening this link will see the exact same setup —
              seats, ranges, board, pot odds and all.
            </div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="share-body">
          <div className="share-link-label">Link</div>
          <div className="share-link-row">
            <input
              ref={inputRef}
              className="share-link"
              type="text"
              value={url}
              readOnly
              onClick={(e) => e.target.select()}
            />
            <button className="btn btn-primary share-copy-btn" onClick={copy}>
              {copied ? (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="11" height="11" rx="2" />
                    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                  </svg>
                  Copy link
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
