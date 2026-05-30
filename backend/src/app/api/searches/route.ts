import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

// Max total saved hands kept per user. When over the cap, non-favorites are
// pruned (oldest first) before favorites — favorites only get dropped if the
// favorites alone exceed the cap.
const SAVE_CAP = 250

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const { name, players, board, odds, playerNames, scenario, isReplay, replay, favorite } = await request.json()

    if (!players || !board || !odds) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
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
