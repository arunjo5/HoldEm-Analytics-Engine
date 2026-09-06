import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { readJsonBody } from '@/lib/body'
import { limit } from '@/lib/rateLimit'
import { getPlan } from '@/lib/plan'
import { userGate } from '@/lib/gate'
import { normalizeName, validSolveConfig, validSummary } from '@/lib/library'

const select = { id: true, name: true, config: true, summary: true, createdAt: true } as const

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const rl = await limit('read', session.user.id)
    if (!rl.ok) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
    }
    const solves = await prisma.savedSolve.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: 'desc' }, select })
    return NextResponse.json({ solves })
  } catch (error) {
    console.error('Error listing solves:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const who = await userGate(request, 'save')
    if (who.error) return who.error
    const parsed = await readJsonBody(request, 16 * 1024)
    if (parsed.error) return parsed.error
    const name = normalizeName(parsed.data?.name)
    if (!name) return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
    const { config, summary } = parsed.data ?? {}
    if (!validSolveConfig(config)) return NextResponse.json({ error: 'Invalid solve' }, { status: 400 })
    if (!validSummary(summary)) return NextResponse.json({ error: 'Invalid summary' }, { status: 400 })

    const { plan, limits } = await getPlan(who.userId)
    const count = await prisma.savedSolve.count({ where: { userId: who.userId } })
    if (count >= limits.solves) {
      return NextResponse.json(
        { error: `Saved solve limit reached (${limits.solves} on ${plan === 'pro' ? 'Pro' : 'Free'})`, code: 'limit_reached', plan, cap: limits.solves },
        { status: 409 }
      )
    }
    const solve = await prisma.savedSolve.create({ data: { userId: who.userId, name, config, summary }, select })
    return NextResponse.json({ solve })
  } catch (error) {
    console.error('Error saving solve:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
