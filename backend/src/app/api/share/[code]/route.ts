import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { readJsonBody, cleanName } from '@/lib/body'
import { limit, getClientIp } from '@/lib/rateLimit'
import { CODE_RE, MAX_LINK_NAME } from '@/lib/shareLinks'

// public; returns the payload, nothing about the owner
export async function GET(request: NextRequest, { params }: { params: { code: string } }) {
  try {
    const rl = await limit('read', `ip:${getClientIp(request)}`)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }
    const code = params.code
    if (!CODE_RE.test(code)) {
      return NextResponse.json({ error: 'Link not found' }, { status: 404 })
    }
    const link = await prisma.shareLink.findUnique({
      where: { code },
      select: { kind: true, payload: true, name: true, createdAt: true },
    })
    if (!link) {
      return NextResponse.json({ error: 'Link not found' }, { status: 404 })
    }
    await prisma.shareLink.update({ where: { code }, data: { views: { increment: 1 } } }).catch(() => {})
    return NextResponse.json(link)
  } catch (error) {
    console.error('Error resolving share link:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function owner(request: NextRequest) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const session = await auth()
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const rl = await limit('save', session.user.id)
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

export async function PATCH(request: NextRequest, { params }: { params: { code: string } }) {
  try {
    const who = await owner(request)
    if (who.error) return who.error
    const parsed = await readJsonBody(request, 4 * 1024)
    if (parsed.error) return parsed.error
    const { name } = parsed.data ?? {}
    if (typeof name !== 'string' || name.length > MAX_LINK_NAME) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
    }
    const res = await prisma.shareLink.updateMany({
      where: { code: params.code, userId: who.userId },
      data: { name: cleanName(name).trim() || null },
    })
    if (res.count === 0) {
      return NextResponse.json({ error: 'Link not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error renaming share link:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { code: string } }) {
  try {
    const who = await owner(request)
    if (who.error) return who.error
    const res = await prisma.shareLink.deleteMany({ where: { code: params.code, userId: who.userId } })
    if (res.count === 0) {
      return NextResponse.json({ error: 'Link not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error deleting share link:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
