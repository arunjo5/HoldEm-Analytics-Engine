import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { readJsonBody, cleanName } from '@/lib/body'
import { limit } from '@/lib/rateLimit'
import { getPlan } from '@/lib/plan'

// Per-user row cap comes from the plan. Over it, non-favorites get pruned before favorites.
const MAX_BODY = 100 * 1024 // legit saves are a few KB
const MAX_NAME = 200

export async function POST(request: NextRequest) {
  try {
    if (request.headers.get('sec-fetch-site') === 'cross-site') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const rl = await limit('save', userId)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Saving too fast. Slow down a moment.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    const parsed = await readJsonBody(request, MAX_BODY)
    if (parsed.error) return parsed.error
    const { plan, saveCap } = await getPlan(userId)
    const { name, players, board, odds, playerNames, scenario, isReplay, replay, favorite } = parsed.data

    if (!players || !board || !odds) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (!Array.isArray(players) || players.length > 9) {
      return NextResponse.json({ error: 'Invalid players' }, { status: 400 })
    }
    if (!Array.isArray(board) || board.length > 5) {
      return NextResponse.json({ error: 'Invalid board' }, { status: 400 })
    }
    if (name != null && (typeof name !== 'string' || name.length > MAX_NAME)) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
    }
    if (scenario != null && typeof scenario !== 'string') {
      return NextResponse.json({ error: 'Invalid scenario' }, { status: 400 })
    }
    if (typeof odds !== 'object' || odds === null || Array.isArray(odds)) {
      return NextResponse.json({ error: 'Invalid odds' }, { status: 400 })
    }
    if (
      playerNames != null &&
      (!Array.isArray(playerNames) ||
        playerNames.length > 9 ||
        playerNames.some((n: any) => n != null && (typeof n !== 'string' || n.length > 100)))
    ) {
      return NextResponse.json({ error: 'Invalid playerNames' }, { status: 400 })
    }
    if (
      JSON.stringify(players).length > 16384 ||
      JSON.stringify(board).length > 2048 ||
      JSON.stringify(odds).length > 16384 ||
      (replay != null && JSON.stringify(replay).length > 49152) ||
      (scenario != null && scenario.length > 16384)
    ) {
      return NextResponse.json({ error: 'Field too large' }, { status: 400 })
    }

    const search = await prisma.search.create({
      data: {
        name: name != null ? cleanName(name) : null,
        players: players as any,
        board: board as any,
        odds: odds as any,
        playerNames: (playerNames ?? null) as any,
        scenario: scenario ?? null,
        isReplay: !!isReplay,
        replay: (replay ?? null) as any,
        favorite: !!favorite,
        userId,
      },
    })

    // Prune past the cap (LRU): favorites kept first, then most-recently-used;
    // whatever falls past the cap is the least-recently-used non-favorite.
    const stale = await prisma.search.findMany({
      where: { userId },
      orderBy: [{ favorite: 'desc' }, { lastAccessedAt: 'desc' }, { createdAt: 'desc' }],
      skip: saveCap,
      select: { id: true },
    })
    if (stale.length) {
      await prisma.search.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } })
    }
    const used = await prisma.search.count({ where: { userId } })

    return NextResponse.json({ search, limit: { plan, cap: saveCap, used, atCap: used >= saveCap } })
  } catch (error) {
    console.error('Error creating search:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const PAGE_DEFAULT = 60
const PAGE_MAX = 200
const listSelect = {
  id: true, name: true, favorite: true, isReplay: true, createdAt: true, lastAccessedAt: true,
  board: true, odds: true, playerNames: true, scenario: true, players: true, replay: true,
} as const

type Card = { v: string; s: string }
type Seat = { name?: string; pos?: string; cards?: Card[] | null }

// the drawer only previews a row: drop range key lists and replay action logs
function slimRow(row: { players: unknown; replay: unknown; isReplay: boolean }) {
  const players = Array.isArray(row.players)
    ? row.players.map((p) =>
        p && typeof p === 'object' && (p as { kind?: string }).kind === 'range'
          ? { kind: 'range', rangeCount: Array.isArray((p as { range?: unknown[] }).range) ? (p as { range: unknown[] }).range.length : 0 }
          : p
      )
    : row.players
  let replay: unknown = null
  if (row.isReplay && row.replay && typeof row.replay === 'object') {
    const rep = row.replay as { setup?: { sb?: number; bb?: number; seats?: Seat[] }; board?: Card[]; actions?: unknown[] }
    const setup = rep.setup || {}
    replay = {
      slim: true,
      setup: {
        sb: setup.sb, bb: setup.bb,
        seats: (setup.seats || []).map((s) => ({ name: s?.name, pos: s?.pos, cards: s?.cards ?? null })),
      },
      board: Array.isArray(rep.board) ? rep.board : [],
      actionCount: Array.isArray(rep.actions) ? rep.actions.length : 0,
    }
  }
  return { ...row, players, replay }
}

// newest first, keyset-paginated; ?starred=1 narrows to favorites
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const rl = await limit('read', userId)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    const params = request?.url ? new URL(request.url).searchParams : new URLSearchParams()
    const limitParam = Number(params.get('limit'))
    const take = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), PAGE_MAX) : PAGE_DEFAULT
    const cursor = params.get('cursor')
    const starred = params.get('starred') === '1'

    const rows = await prisma.search.findMany({
      where: { userId, ...(starred ? { favorite: true } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: listSelect,
    })
    const page = rows.slice(0, take)
    const nextCursor = rows.length > take ? page[page.length - 1].id : null

    return NextResponse.json({ searches: page.map(slimRow), nextCursor })
  } catch (error) {
    console.error('Error fetching searches:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// clear everything that isn't a favorite
export async function DELETE(request: NextRequest) {
  try {
    if (request.headers.get('sec-fetch-site') === 'cross-site') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const rl = await limit('save', session.user.id)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }
    const res = await prisma.search.deleteMany({ where: { userId: session.user.id, favorite: false } })
    return NextResponse.json({ deleted: res.count })
  } catch (error) {
    console.error('Error clearing searches:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
