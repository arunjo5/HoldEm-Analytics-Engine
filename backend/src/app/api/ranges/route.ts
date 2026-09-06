import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { readJsonBody } from '@/lib/body'
import { limit } from '@/lib/rateLimit'
import { getPlan } from '@/lib/plan'
import { userGate } from '@/lib/gate'
import { normalizeRangeKeys, normalizeName } from '@/lib/library'

const select = { id: true, name: true, keys: true, createdAt: true, updatedAt: true } as const

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
    const ranges = await prisma.savedRange.findMany({ where: { userId: session.user.id }, orderBy: { updatedAt: 'desc' }, select })
    return NextResponse.json({ ranges })
  } catch (error) {
    console.error('Error listing ranges:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const who = await userGate(request, 'save')
    if (who.error) return who.error
    const parsed = await readJsonBody(request, 8 * 1024)
    if (parsed.error) return parsed.error
    const name = normalizeName(parsed.data?.name)
    const keys = normalizeRangeKeys(parsed.data?.keys)
    if (!name) return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
    if (!keys) return NextResponse.json({ error: 'Invalid range' }, { status: 400 })

    const { plan, limits } = await getPlan(who.userId)
    const count = await prisma.savedRange.count({ where: { userId: who.userId } })
    if (count >= limits.ranges) {
      return NextResponse.json(
        { error: `Saved range limit reached (${limits.ranges} on ${plan === 'pro' ? 'Pro' : 'Free'})`, code: 'limit_reached', plan, cap: limits.ranges },
        { status: 409 }
      )
    }
    const range = await prisma.savedRange.create({ data: { userId: who.userId, name, keys }, select })
    return NextResponse.json({ range })
  } catch (error) {
    console.error('Error saving range:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
