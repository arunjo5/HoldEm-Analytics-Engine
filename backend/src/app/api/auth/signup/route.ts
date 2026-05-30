import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { readJsonBody } from '@/lib/body'

export async function POST(request: NextRequest) {
  try {
    // Throttle account creation: 8 per hour per IP.
    const ip = getClientIp(request)
    const rl = rateLimit(`signup:${ip}`, 8, 60 * 60_000)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many sign-ups from this network. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    const parsed = await readJsonBody(request, 4 * 1024)
    if (parsed.error) return parsed.error
    const { username: rawUsername, password, name } = parsed.data
    const username = (rawUsername || '').toString().trim().toLowerCase()

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
    }
    if (username.length < 3 || username.length > 32) {
      return NextResponse.json({ error: 'Username must be 3–32 characters' }, { status: 400 })
    }
    if (!/^[a-z0-9._-]+$/.test(username)) {
      return NextResponse.json({ error: 'Username may only contain letters, numbers, and . _ -' }, { status: 400 })
    }
    const pwLen = String(password).length
    if (pwLen < 6 || pwLen > 200) {
      return NextResponse.json({ error: 'Password must be 6–200 characters' }, { status: 400 })
    }

    // Username is stored in the `email` column (legacy field reused).
    const existing = await prisma.user.findUnique({ where: { email: username } })
    if (existing) {
      return NextResponse.json({ error: 'Username is already taken' }, { status: 400 })
    }

    const hash = await bcrypt.hash(String(password), 10)
    const user = await prisma.user.create({
      data: {
        email: username,
        name: (name && String(name).trim()) || username,
        password: hash,
      },
    })
    return NextResponse.json({ user: { id: user.id, username: user.email, name: user.name } })
  } catch (err) {
    console.error('signup error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
