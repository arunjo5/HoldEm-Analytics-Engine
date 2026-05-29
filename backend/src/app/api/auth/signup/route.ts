import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const { username: rawUsername, password, name } = await request.json()
    const username = (rawUsername || '').toString().trim().toLowerCase()

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
    }
    if (username.length < 3) {
      return NextResponse.json({ error: 'Username must be at least 3 characters' }, { status: 400 })
    }
    if (!/^[a-z0-9._-]+$/.test(username)) {
      return NextResponse.json({ error: 'Username may only contain letters, numbers, and . _ -' }, { status: 400 })
    }
    if (String(password).length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
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
