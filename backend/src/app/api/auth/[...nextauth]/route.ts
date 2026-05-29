import { NextRequest, NextResponse } from 'next/server'
import { handlers } from '@/auth'
import { rateLimit, getClientIp } from '@/lib/rateLimit'

export const GET = handlers.GET

export async function POST(req: NextRequest) {
  // Throttle credential sign-in attempts: 10 per 5 min per IP.
  if (req.url.includes('/callback/credentials')) {
    const ip = getClientIp(req)
    const rl = rateLimit(`login:${ip}`, 10, 5 * 60_000)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many sign-in attempts. Try again in a few minutes.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }
  }
  return handlers.POST(req)
}
