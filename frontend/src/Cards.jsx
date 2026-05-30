import React from 'react';

export const SUIT_GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const SUIT_NAME = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
export const SUIT_RED = { s: false, c: false, h: true, d: true };

// Symmetric SVG paths for suits. Font glyphs render off-center for spade/club
// (asymmetric stems); these are mirrored around x=50 in a 100x100 viewBox.
const SUIT_PATHS = {
  h: 'M50 86 C50 86 12 60 12 32 C12 18 22 10 32 10 C40 10 46 14 50 22 C54 14 60 10 68 10 C78 10 88 18 88 32 C88 60 50 86 50 86 Z',
  d: 'M50 8 L88 50 L50 92 L12 50 Z',
  s: 'M50 10 C50 10 12 40 12 58 C12 72 22 80 32 80 C40 80 45 76 48 70 L44 90 L56 90 L52 70 C55 76 60 80 68 80 C78 80 88 72 88 58 C88 40 50 10 50 10 Z',
};

export function SuitGlyph({ suit, size, color }) {
  const px = typeof size === 'number' ? size : 22;
  const common = {
    width: px,
    height: px,
    viewBox: '0 0 100 100',
    style: { display: 'inline-block', verticalAlign: 'middle' },
    fill: color,
  };
  if (suit === 'c') {
    // Three overlapping lobes (no center gap) + flared bezier stem.
    return (
      <svg {...common}>
        <circle cx="50" cy="30" r="21" />
        <circle cx="32" cy="58" r="21" />
        <circle cx="68" cy="58" r="21" />
        <path d="M42 64 C40 78 36 84 30 92 L70 92 C64 84 60 78 58 64 Z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d={SUIT_PATHS[suit]} />
    </svg>
  );
}

const CARD_SIZES = {
  xs: { w: 24, h: 32, rank: 13, suit: 13, pad: 2, radius: 3 },
  sm: { w: 32, h: 44, rank: 16, suit: 15, pad: 3, radius: 4 },
  md: { w: 50, h: 68, rank: 24, suit: 22, pad: 4, radius: 6 },
  // replayer: a touch larger than md / lg
  mdr: { w: 55, h: 75, rank: 26, suit: 24, pad: 4, radius: 6 },
  lg: { w: 64, h: 88, rank: 30, suit: 28, pad: 5, radius: 8 },
  lgr: { w: 70, h: 96, rank: 33, suit: 30, pad: 5, radius: 8 },
  xl: { w: 80, h: 110, rank: 38, suit: 34, pad: 6, radius: 10 },
};

export function PlayingCard({ card, size = 'md', faded = false, dim = false }) {
  const s = CARD_SIZES[size];
  const red = SUIT_RED[card.s];
  const color = red ? 'var(--card-red)' : 'var(--card-ink)';
  const rankText = card.v === 'T' ? '10' : card.v;
  return (
    <div
      style={{
        width: s.w,
        height: s.h,
        borderRadius: s.radius,
        background: faded ? 'var(--card-face-dim)' : 'var(--card-face)',
        boxShadow: faded
          ? 'inset 0 0 0 1px rgba(0,0,0,.06)'
          : '0 1px 0 rgba(0,0,0,.35), 0 4px 10px -4px rgba(0,0,0,.45), inset 0 0 0 1px rgba(0,0,0,.06)',
        padding: s.pad,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        position: 'relative',
        opacity: dim ? 0.35 : 1,
        flexShrink: 0,
        gap: Math.round(s.suit * 0.08),
        lineHeight: 1,
      }}
    >
      <span style={{
        color,
        fontWeight: 800,
        fontSize: s.rank,
        fontFamily: 'var(--font-card)',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: 0,
        lineHeight: 1,
        display: 'block',
        width: '100%',
        textAlign: 'center',
      }}>{rankText}</span>
      <span style={{
        color,
        fontSize: s.suit,
        lineHeight: 1,
        display: 'block',
        width: '100%',
        textAlign: 'center',
      }}>
        <SuitGlyph suit={card.s} size={s.suit} color={color} />
      </span>
    </div>
  );
}

const BACK_SIZES = {
  xs: { w: 24, h: 32, radius: 3 },
  sm: { w: 32, h: 44, radius: 4 },
  md: { w: 50, h: 68, radius: 6 },
  mdr: { w: 55, h: 75, radius: 6 },
  lg: { w: 64, h: 88, radius: 8 },
  lgr: { w: 70, h: 96, radius: 8 },
  xl: { w: 80, h: 110, radius: 10 },
};

export function CardBack({ size = 'md' }) {
  const s = BACK_SIZES[size];
  return (
    <div
      style={{
        width: s.w,
        height: s.h,
        borderRadius: s.radius,
        background: 'var(--card-back)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)',
        flexShrink: 0,
      }}
    />
  );
}

const SLOT_SIZES = {
  sm: { w: 32, h: 44, radius: 4, font: 16 },
  md: { w: 50, h: 68, radius: 6, font: 20 },
  lg: { w: 64, h: 88, radius: 8, font: 24 },
};

export function EmptyCardSlot({ size = 'md', label = '+', active = false }) {
  const s = SLOT_SIZES[size];
  return (
    <div
      style={{
        width: s.w,
        height: s.h,
        borderRadius: s.radius,
        border: '1.5px dashed var(--slot-border)',
        background: active ? 'var(--slot-active-bg)' : 'transparent',
        color: 'var(--slot-fg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: s.font,
        fontWeight: 300,
        flexShrink: 0,
      }}
    >
      {label}
    </div>
  );
}

// compact inline card for dense lists
export function CardChip({ card }) {
  const red = SUIT_RED[card.s];
  return (
    <span className={'card-chip ' + (red ? 'red' : 'ink')}>
      <span className="card-chip-rank">{card.v === 'T' ? '10' : card.v}</span>
      <SuitGlyph suit={card.s} size={10} color="currentColor" />
    </span>
  );
}
