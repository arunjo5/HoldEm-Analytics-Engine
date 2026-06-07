import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { search: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() } },
}))
vi.mock('@/lib/rateLimit', () => ({ limit: vi.fn(async () => ({ ok: true, retryAfter: 0 })) }))

import { POST, GET } from '@/app/api/searches/route'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { limit } from '@/lib/rateLimit'

function req(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  const h: Record<string, string> = { 'content-length': String(Buffer.byteLength(json, 'utf8')), ...headers }
  return {
    headers: { get: (k: string) => h[k.toLowerCase()] ?? null },
    text: async () => json,
  } as unknown as Request
}

const valid = { players: [null, null], board: [], odds: {}, name: 'spot' }

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: 'user1' } })
  ;(limit as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, retryAfter: 0 })
  ;(prisma.search.create as ReturnType<typeof vi.fn>).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 's1', ...data }))
  ;(prisma.search.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
})

describe('searches POST', () => {
  it('401 when unauthenticated', async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await POST(req(valid) as never)).status).toBe(401)
  })

  it('403 on a cross-site request', async () => {
    expect((await POST(req(valid, { 'sec-fetch-site': 'cross-site' }) as never)).status).toBe(403)
    expect(prisma.search.create).not.toHaveBeenCalled()
  })

  it('creates a search scoped to the session user', async () => {
    const res = await POST(req(valid) as never)
    expect(res.status).toBe(200)
    expect((prisma.search.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.userId).toBe('user1')
  })

  it('400 when required fields are missing', async () => {
    expect((await POST(req({ players: [], board: [] }) as never)).status).toBe(400)
  })

  it('400 when odds is not a plain object', async () => {
    expect((await POST(req({ players: [], board: [], odds: [1, 2] }) as never)).status).toBe(400)
  })

  it('400 when there are too many players', async () => {
    expect((await POST(req({ players: new Array(10).fill(null), board: [], odds: {} }) as never)).status).toBe(400)
  })

  it('400 when a field is oversize', async () => {
    expect((await POST(req({ players: [], board: [], odds: {}, replay: { x: 'a'.repeat(60000) } }) as never)).status).toBe(400)
  })

  it('cleans the saved name', async () => {
    await POST(req({ players: [], board: [], odds: {}, name: 'Na' + String.fromCharCode(0x200b) + 'me' }) as never)
    expect((prisma.search.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.name).toBe('Name')
  })
})

describe('searches GET', () => {
  it('401 when unauthenticated', async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })

  it('returns only the session user\'s searches', async () => {
    ;(prisma.search.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 's1' }])
    const res = await GET()
    expect(res.status).toBe(200)
    expect((prisma.search.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].where.userId).toBe('user1')
  })

  it('429 when rate limited', async () => {
    ;(limit as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, retryAfter: 1 })
    expect((await GET()).status).toBe(429)
  })
})
