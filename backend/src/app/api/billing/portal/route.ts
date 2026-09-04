import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { limit } from '@/lib/rateLimit'
import { stripe, appUrl } from '@/lib/stripe'

// stripe's hosted portal handles cancel, plan switch, and card changes
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

    const rl = await limit('billing', userId)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: 'Billing is not configured' }, { status: 503 })
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { stripeCustomerId: true } })
    if (!user?.stripeCustomerId) {
      return NextResponse.json({ error: 'No billing account yet' }, { status: 400 })
    }
    const portal = await stripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${appUrl(request)}/`,
    })
    return NextResponse.json({ url: portal.url })
  } catch (error) {
    console.error('Error creating portal session:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
