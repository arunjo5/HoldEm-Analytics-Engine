import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { readJsonBody } from '@/lib/body'
import { userGate } from '@/lib/gate'
import { normalizeName } from '@/lib/library'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const who = await userGate(request, 'save')
    if (who.error) return who.error
    const parsed = await readJsonBody(request, 4 * 1024)
    if (parsed.error) return parsed.error
    const name = normalizeName(parsed.data?.name)
    if (!name) return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
    const res = await prisma.savedSolve.updateMany({ where: { id: params.id, userId: who.userId }, data: { name } })
    if (res.count === 0) return NextResponse.json({ error: 'Solve not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error renaming solve:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const who = await userGate(request, 'save')
    if (who.error) return who.error
    const res = await prisma.savedSolve.deleteMany({ where: { id: params.id, userId: who.userId } })
    if (res.count === 0) return NextResponse.json({ error: 'Solve not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error deleting solve:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
