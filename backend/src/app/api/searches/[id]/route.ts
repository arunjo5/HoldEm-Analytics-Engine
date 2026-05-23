import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { id } = params

    // Verify the search belongs to the user
    const search = await prisma.search.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
    })

    if (!search) {
      return NextResponse.json(
        { error: 'Search not found or access denied' },
        { status: 404 }
      )
    }

    // Delete the search
    await prisma.search.delete({
      where: { id },
    })

    return NextResponse.json({ message: 'Search deleted successfully' })
  } catch (error) {
    console.error('Error deleting search:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
