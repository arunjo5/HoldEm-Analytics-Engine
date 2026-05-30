import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { readJsonBody } from '@/lib/body'

// Max total saved hands kept per user. When over the cap, non-favorites are
// pruned (oldest first) before favorites — favorites only get dropped if the
// favorites alone exceed the cap.
const SAVE_CAP = 250

// A real save is a few KB; 100 KB is generous but blocks junk-payload abuse.
const MAX_BODY = 100 * 1024
const MAX_NAME = 200

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const parsed = await readJsonBody(request, MAX_BODY)
    if (parsed.error) return parsed.error
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

    const search = await prisma.search.create({
      data: {
        name: name ?? null,
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

    // Keep only the top SAVE_CAP hands: favorites rank above non-favorites,
    // and within each group newer ranks above older. Everything past the cap
    // is pruned — so non-favorites are dropped (oldest first) before any
    // favorite is touched.
    const stale = await prisma.search.findMany({
      where: { userId },
      orderBy: [{ favorite: 'desc' }, { createdAt: 'desc' }],
      skip: SAVE_CAP,
      select: { id: true },
    })
    if (stale.length) {
      await prisma.search.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } })
    }

    return NextResponse.json({ search })
  } catch (error) {
    console.error('Error creating search:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searches = await prisma.search.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ searches })
  } catch (error) {
    console.error('Error fetching searches:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
