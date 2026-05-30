import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { readJsonBody } from '@/lib/body'

const MAX_NAME = 200

async function ownedSearch(userId: string, id: string) {
  return prisma.search.findFirst({ where: { id, userId } })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const found = await ownedSearch(session.user.id, params.id)
    if (!found) {
      return NextResponse.json({ error: 'Search not found' }, { status: 404 })
    }

    const parsed = await readJsonBody(request, 8 * 1024)
    if (parsed.error) return parsed.error
    const body = parsed.data
    const data: any = {}
    if (typeof body.favorite === 'boolean') data.favorite = body.favorite
    if (typeof body.name === 'string' && body.name.length <= MAX_NAME) data.name = body.name

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const updated = await prisma.search.update({ where: { id: params.id }, data })
    return NextResponse.json({ search: updated })
  } catch (err) {
    console.error('PATCH search error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const found = await ownedSearch(session.user.id, params.id)
    if (!found) {
      return NextResponse.json({ error: 'Search not found or access denied' }, { status: 404 })
    }

    await prisma.search.delete({ where: { id: params.id } })
    return NextResponse.json({ message: 'Search deleted successfully' })
  } catch (err) {
    console.error('DELETE search error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
