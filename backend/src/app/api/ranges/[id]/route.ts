import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { readJsonBody } from '@/lib/body'
import { userGate } from '@/lib/gate'
import { normalizeRangeKeys, normalizeName } from '@/lib/library'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const who = await userGate(request, 'save')
    if (who.error) return who.error
    const parsed = await readJsonBody(request, 8 * 1024)
    if (parsed.error) return parsed.error
    const data: { name?: string; keys?: string[] } = {}
    if (parsed.data?.name !== undefined) {
      const name = normalizeName(parsed.data.name)
      if (!name) return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
      data.name = name
    }
    if (parsed.data?.keys !== undefined) {
      const keys = normalizeRangeKeys(parsed.data.keys)
      if (!keys) return NextResponse.json({ error: 'Invalid range' }, { status: 400 })
      data.keys = keys
    }
    if (!Object.keys(data).length) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }
    const res = await prisma.savedRange.updateMany({ where: { id: params.id, userId: who.userId }, data })
    if (res.count === 0) return NextResponse.json({ error: 'Range not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error updating range:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const who = await userGate(request, 'save')
    if (who.error) return who.error
    const res = await prisma.savedRange.deleteMany({ where: { id: params.id, userId: who.userId } })
    if (res.count === 0) return NextResponse.json({ error: 'Range not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error deleting range:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
