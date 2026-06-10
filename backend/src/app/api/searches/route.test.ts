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

describe('searches POST LRU prune', () => {
  it('orders the prune scan favorites-first then by recency, skipping the cap', async () => {
    expect((await POST(req(valid) as never)).status).toBe(200)
    expect((prisma.search.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({
      where: { userId: 'user1' },
      orderBy: [{ favorite: 'desc' }, { lastAccessedAt: 'desc' }, { createdAt: 'desc' }],
      skip: 500,
      select: { id: true },
    })
  })

  it('deletes exactly the stale rows past the cap', async () => {
    ;(prisma.search.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'old1' }, { id: 'old2' }])
    expect((await POST(req(valid) as never)).status).toBe(200)
    expect(prisma.search.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['old1', 'old2'] } } })
  })

  it('skips deleteMany when nothing is past the cap', async () => {
    expect((await POST(req(valid) as never)).status).toBe(200)
    expect(prisma.search.deleteMany).not.toHaveBeenCalled()
  })

  it('prunes unconditionally even when the new save is a favorite', async () => {
    expect((await POST(req({ ...valid, favorite: true }) as never)).status).toBe(200)
    expect(prisma.search.findMany).toHaveBeenCalledTimes(1)
  })

  it('500 when the prune delete fails', async () => {
    ;(prisma.search.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'old1' }])
    ;(prisma.search.deleteMany as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'))
    const res = await POST(req(valid) as never)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
  })
})

describe('searches POST persistence and validation', () => {
  const createData = (i = 0) => (prisma.search.create as ReturnType<typeof vi.fn>).mock.calls[i][0].data

  it('persists favorite:true and defaults to false', async () => {
    await POST(req({ ...valid, favorite: true }) as never)
    await POST(req(valid) as never)
    expect(createData(0).favorite).toBe(true)
    expect(createData(1).favorite).toBe(false)
  })

  it('coerces isReplay and passes replay through, defaulting replay to null', async () => {
    await POST(req({ ...valid, isReplay: 1, replay: { steps: [] } }) as never)
    await POST(req(valid) as never)
    expect(createData(0).isReplay).toBe(true)
    expect(createData(0).replay).toEqual({ steps: [] })
    expect(createData(1).isReplay).toBe(false)
    expect(createData(1).replay).toBeNull()
  })

  it('400 when the board has more than 5 cards', async () => {
    const res = await POST(req({ ...valid, board: new Array(6).fill(null) }) as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid board')
  })

  it('400 for oversize or non-string name', async () => {
    expect((await POST(req({ ...valid, name: 'x'.repeat(201) }) as never)).status).toBe(400)
    expect((await POST(req({ ...valid, name: 42 }) as never)).status).toBe(400)
  })

  it('400 for non-string or oversize scenario', async () => {
    const res = await POST(req({ ...valid, scenario: {} }) as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid scenario')
    const big = await POST(req({ ...valid, scenario: 'x'.repeat(16385) }) as never)
    expect(big.status).toBe(400)
    expect((await big.json()).error).toBe('Field too large')
  })

  it('validates the playerNames matrix and stores a valid one', async () => {
    expect((await POST(req({ ...valid, playerNames: new Array(10).fill('a') }) as never)).status).toBe(400)
    expect((await POST(req({ ...valid, playerNames: ['x'.repeat(101)] }) as never)).status).toBe(400)
    expect((await POST(req({ ...valid, playerNames: [7] }) as never)).status).toBe(400)
    expect(prisma.search.create).not.toHaveBeenCalled()
    expect((await POST(req({ ...valid, playerNames: [null, 'alice'] }) as never)).status).toBe(200)
    expect(createData(0).playerNames).toEqual([null, 'alice'])
  })

  it('400 when the players JSON exceeds 16384 chars', async () => {
    const res = await POST(req({ ...valid, players: [{ x: 'a'.repeat(17000) }] }) as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Field too large')
  })

  it('429 with Retry-After before any create, keyed on save/user', async () => {
    ;(limit as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, retryAfter: 30 })
    const res = await POST(req(valid) as never)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(limit).toHaveBeenCalledWith('save', 'user1')
    expect(prisma.search.create).not.toHaveBeenCalled()
  })

  it('500 when create fails', async () => {
    ;(prisma.search.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'))
    const res = await POST(req(valid) as never)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
  })

  it('413 when the declared body exceeds the cap', async () => {
    expect((await POST(req(valid, { 'content-length': '200000' }) as never)).status).toBe(413)
  })

  it('400 on a non-JSON body', async () => {
    const bad = {
      headers: { get: (k: string) => (k.toLowerCase() === 'content-length' ? '5' : null) },
      text: async () => 'nope!',
    } as unknown as Request
    const res = await POST(bad as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid JSON')
  })

  it('cross-site is rejected before any auth work', async () => {
    expect((await POST(req(valid, { 'sec-fetch-site': 'cross-site' }) as never)).status).toBe(403)
    expect(auth).not.toHaveBeenCalled()
  })

  it('benign sec-fetch-site values pass through', async () => {
    for (const site of ['same-site', 'same-origin']) {
      expect((await POST(req(valid, { 'sec-fetch-site': site }) as never)).status).toBe(200)
    }
    expect((await POST(req(valid) as never)).status).toBe(200)
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

  it('orders the list by createdAt desc', async () => {
    await GET()
    expect((prisma.search.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({
      where: { userId: 'user1' },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('429 when rate limited', async () => {
    ;(limit as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, retryAfter: 1 })
    expect((await GET()).status).toBe(429)
  })

  it('429 carries Retry-After and uses the read limiter', async () => {
    ;(limit as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, retryAfter: 7 })
    const res = await GET()
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('7')
    expect(limit).toHaveBeenCalledWith('read', 'user1')
  })

  it('500 when the list query fails', async () => {
    ;(prisma.search.findMany as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'))
    expect((await GET()).status).toBe(500)
  })
})
