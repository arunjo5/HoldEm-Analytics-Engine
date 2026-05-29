import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

// Max non-favorite saved hands kept per user. Favorites are never pruned.
const SAVE_CAP = 100

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const { name, players, board, odds, playerNames, scenario } = await request.json()

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
        userId,
      },
    })

    // Prune oldest non-favorite hands beyond the cap so storage stays bounded.
    const stale = await prisma.search.findMany({
      where: { userId, favorite: false },
      orderBy: { createdAt: 'desc' },
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
