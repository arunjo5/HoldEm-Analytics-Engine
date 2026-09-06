import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { limit } from '@/lib/rateLimit'

type Kind = Parameters<typeof limit>[0]

// csrf + session + per-user rate limit for a mutating route
export async function userGate(request: NextRequest, kind: Kind) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const session = await auth()
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const rl = await limit(kind, session.user.id)
  if (!rl.ok) {
    return {
      error: NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      ),
    }
  }
  return { userId: session.user.id }
}
