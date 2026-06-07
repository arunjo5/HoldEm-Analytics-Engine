import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { search: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() } },
}))
vi.mock('@/lib/rateLimit', () => ({ limit: vi.fn(async () => ({ ok: true, retryAfter: 0 })) }))

import { PATCH, DELETE } from '@/app/api/searches/[id]/route'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

function req(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  const h: Record<string, string> = { 'content-length': String(Buffer.byteLength(json, 'utf8')), ...headers }
  return {
    headers: { get: (k: string) => h[k.toLowerCase()] ?? null },
    text: async () => json,
  } as unknown as Request
}
const ctx = (id: string) => ({ params: { id } })

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: 'user1' } })
  ;(prisma.search.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1', userId: 'user1' })
  ;(prisma.search.update as ReturnType<typeof vi.fn>).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 's1', ...data }))
  ;(prisma.search.delete as ReturnType<typeof vi.fn>).mockResolvedValue({})
})

describe('searches [id] PATCH', () => {
  it('401 when unauthenticated', async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await PATCH(req({ favorite: true }) as never, ctx('s1') as never)).status).toBe(401)
  })

  it('403 on a cross-site request', async () => {
    expect((await PATCH(req({ favorite: true }, { 'sec-fetch-site': 'cross-site' }) as never, ctx('s1') as never)).status).toBe(403)
  })

  it('404 for a search the user does not own', async () => {
    ;(prisma.search.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await PATCH(req({ favorite: true }) as never, ctx('other') as never)).status).toBe(404)
    expect(prisma.search.update).not.toHaveBeenCalled()
  })

  it('scopes the ownership check to id AND session user', async () => {
    await PATCH(req({ favorite: true }) as never, ctx('s1') as never)
    expect((prisma.search.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0].where).toEqual({ id: 's1', userId: 'user1' })
  })

  it('updates favorite for an owned search', async () => {
    const res = await PATCH(req({ favorite: true }) as never, ctx('s1') as never)
    expect(res.status).toBe(200)
    expect((prisma.search.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data.favorite).toBe(true)
  })
})

describe('searches [id] DELETE', () => {
  it('401 when unauthenticated', async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await DELETE(req({}) as never, ctx('s1') as never)).status).toBe(401)
  })

  it('403 on a cross-site request', async () => {
    expect((await DELETE(req({}, { 'sec-fetch-site': 'cross-site' }) as never, ctx('s1') as never)).status).toBe(403)
  })

  it('404 for a search the user does not own', async () => {
    ;(prisma.search.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await DELETE(req({}) as never, ctx('other') as never)).status).toBe(404)
    expect(prisma.search.delete).not.toHaveBeenCalled()
  })

  it('deletes an owned search', async () => {
    expect((await DELETE(req({}) as never, ctx('s1') as never)).status).toBe(200)
    expect(prisma.search.delete).toHaveBeenCalledTimes(1)
  })
})
