import { cleanName } from '@/lib/body'

export const MAX_NAME = 60

const RANKS = 'AKQJT98765432'
export const RANGE_KEYS: ReadonlySet<string> = (() => {
  const s = new Set<string>()
  for (let i = 0; i < 13; i++) {
    s.add(RANKS[i] + RANKS[i])
    for (let j = i + 1; j < 13; j++) {
      s.add(RANKS[i] + RANKS[j] + 's')
      s.add(RANKS[i] + RANKS[j] + 'o')
    }
  }
  return s
})()

// 169 hand-class keys like AA, AKs, T9o; returns the deduped list or null
export function normalizeRangeKeys(keys: unknown): string[] | null {
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 169) return null
  const out = new Set<string>()
  for (const k of keys) {
    if (typeof k !== 'string' || !RANGE_KEYS.has(k)) return null
    out.add(k)
  }
  return Array.from(out)
}

export function normalizeName(name: unknown): string | null {
  if (typeof name !== 'string' || name.length > MAX_NAME) return null
  const n = cleanName(name).trim()
  return n.length ? n : null
}

const CARD_RE = /^[AKQJT98765432]$/
const SUIT_RE = /^[shdc]$/
const isCard = (c: unknown) =>
  !!c && typeof c === 'object' && CARD_RE.test((c as { v?: string }).v ?? '') && SUIT_RE.test((c as { s?: string }).s ?? '')

function validSide(side: unknown): boolean {
  if (!side || typeof side !== 'object') return false
  const s = side as { kind?: string; keys?: unknown; cards?: unknown }
  if (s.kind === 'range') return normalizeRangeKeys(s.keys) !== null
  if (s.kind === 'hand') return Array.isArray(s.cards) && s.cards.length === 2 && s.cards.every(isCard)
  return false
}

const num = (x: unknown, lo: number, hi: number) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi

// the solver's spot: 5-card board slots, two sides, and a bet tree
export function validSolveConfig(config: unknown): boolean {
  if (!config || typeof config !== 'object') return false
  const c = config as { board?: unknown; oopSide?: unknown; ipSide?: unknown; spot?: unknown }
  if (!Array.isArray(c.board) || c.board.length > 5 || !c.board.every((x) => x === null || isCard(x))) return false
  if (!validSide(c.oopSide) || !validSide(c.ipSide)) return false
  if (!c.spot || typeof c.spot !== 'object') return false
  const sp = c.spot as { pot?: unknown; stack?: unknown; betSizes?: unknown; allIn?: unknown }
  if (!num(sp.pot, 0, 1e6) || !num(sp.stack, 0, 1e6) || typeof sp.allIn !== 'boolean') return false
  if (!Array.isArray(sp.betSizes) || sp.betSizes.length > 8) return false
  return sp.betSizes.every(
    (b) =>
      !!b && typeof b === 'object' &&
      typeof (b as { id?: unknown }).id === 'string' && (b as { id: string }).id.length <= 12 &&
      num((b as { pct?: unknown }).pct, 1, 1000) &&
      typeof (b as { on?: unknown }).on === 'boolean'
  )
}

export function validSummary(summary: unknown): boolean {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return false
  return JSON.stringify(summary).length <= 1024 && Object.values(summary as object).every((v) => typeof v === 'number' || typeof v === 'string')
}
