import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { readJsonBody, cleanName } from '@/lib/body'
import { limit } from '@/lib/rateLimit'
import { getPlan, PLAN_LIMITS } from '@/lib/plan'
import { isShareKind, validPayload, payloadHash, newCode, linkSelect, MAX_LINK_NAME } from '@/lib/shareLinks'

// pro only; a repeat payload returns the existing link
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

    const rl = await limit('share', userId)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many links created. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    const parsed = await readJsonBody(request, 64 * 1024)
    if (parsed.error) return parsed.error
    const { kind, payload, name } = parsed.data ?? {}
    if (!isShareKind(kind)) {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
    }
    if (!validPayload(kind, payload)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }
    if (name != null && (typeof name !== 'string' || name.length > MAX_LINK_NAME)) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
    }

    const { plan } = await getPlan(userId)
    if (plan !== 'pro') {
      return NextResponse.json({ error: 'Short links are a Pro feature', code: 'pro_required' }, { status: 403 })
    }

    const hash = payloadHash(kind, payload)
    const existing = await prisma.shareLink.findFirst({ where: { userId, payloadHash: hash }, select: linkSelect })
    if (existing) {
      return NextResponse.json({ link: existing, existing: true })
    }

    const count = await prisma.shareLink.count({ where: { userId } })
    if (count >= PLAN_LIMITS[plan].shareLinks) {
      return NextResponse.json({ error: 'Link limit reached. Delete some old links first.' }, { status: 409 })
    }

    const data = {
      userId,
      kind,
      payload,
      payloadHash: hash,
      name: name != null ? cleanName(name).trim() || null : null,
    }
    // retry on a code collision
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const link = await prisma.shareLink.create({ data: { ...data, code: newCode() }, select: linkSelect })
        return NextResponse.json({ link })
      } catch (e) {
        if ((e as { code?: string })?.code !== 'P2002' || attempt === 2) throw e
      }
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  } catch (error) {
    console.error('Error creating share link:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const rl = await limit('read', userId)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    const links = await prisma.shareLink.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: linkSelect,
    })
    return NextResponse.json({ links })
  } catch (error) {
    console.error('Error listing share links:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
