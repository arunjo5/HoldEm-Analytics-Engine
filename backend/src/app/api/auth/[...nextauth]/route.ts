import { NextRequest, NextResponse } from 'next/server'
import { handlers } from '@/auth'
import { limit, getClientIp } from '@/lib/rateLimit'

export const GET = handlers.GET

export async function POST(req: NextRequest) {
  // throttle credential sign-in attempts
  if (req.url.includes('/callback/credentials')) {
    const ip = getClientIp(req)
    const rl = await limit('login', ip)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many sign-in attempts. Try again in a few minutes.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }
  }
  return handlers.POST(req)
}
