import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { limit, getClientIp } from '@/lib/rateLimit'
import { getPlan, PLAN_LIMITS } from '@/lib/plan'
import { billingEnabled } from '@/lib/stripe'

// anonymous callers only learn whether billing is on; plan details need a session
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    const userId = session?.user?.id ?? null

    const rl = await limit('read', userId ?? `ip:${getClientIp(request)}`)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    const enabled = billingEnabled()
    if (!userId) {
      return NextResponse.json({
        plan: 'free', interval: null, expiresAt: null, saveCap: PLAN_LIMITS.free.saveCap,
        hasCustomer: false, saved: 0, billingEnabled: enabled,
      })
    }
    const [info, saved] = await Promise.all([getPlan(userId), prisma.search.count({ where: { userId } })])
    return NextResponse.json({ ...info, saved, billingEnabled: enabled })
  } catch (error) {
    console.error('Error fetching billing status:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
