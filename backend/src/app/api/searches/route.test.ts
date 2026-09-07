import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { search: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn(async () => 0) } },
}))
vi.mock('@/lib/plan', () => ({
  getPlan: vi.fn(async () => ({ plan: 'free', saveCap: 25, interval: null, expiresAt: null, hasCustomer: false })),
}))
vi.mock('@/lib/rateLimit', () => ({ limit: vi.fn(async () => ({ ok: true, retryAfter: 0 })) }))

import { POST, GET, DELETE } from '@/app/api/searches/route'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { limit } from '@/lib/rateLimit'
import { getPlan } from '@/lib/plan'

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
      skip: 25,
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

  it('orders newest first, keyset-ready, and over-fetches one row to detect a next page', async () => {
    await GET()
    expect((prisma.search.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      where: { userId: 'user1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 61,
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

describe('searches POST plan-aware cap', () => {
  const mock = (f: unknown) => f as ReturnType<typeof vi.fn>
  const PRO = { plan: 'pro', saveCap: 5000, interval: 'year', expiresAt: null, hasCustomer: true }

  beforeEach(() => {
    // clearAllMocks keeps implementations, so undo the failure stubs earlier blocks left behind
    mock(prisma.search.count).mockResolvedValue(0)
    mock(prisma.search.deleteMany).mockResolvedValue({ count: 1 })
  })

  it('prunes at the free cap and reports the free limit', async () => {
    const res = await POST(req(valid) as never)
    expect(mock(prisma.search.findMany).mock.calls[0][0].skip).toBe(25)
    expect((await res.json()).limit).toEqual({ plan: 'free', cap: 25, used: 0, atCap: false })
  })

  it('prunes at the pro cap for a pro user', async () => {
    mock(getPlan).mockResolvedValueOnce(PRO)
    mock(prisma.search.count).mockResolvedValue(120)
    const res = await POST(req(valid) as never)
    expect(getPlan).toHaveBeenCalledWith('user1')
    expect(mock(prisma.search.findMany).mock.calls[0][0].skip).toBe(5000)
    expect((await res.json()).limit).toEqual({ plan: 'pro', cap: 5000, used: 120, atCap: false })
  })

  it('flags atCap once the count reaches the cap', async () => {
    mock(prisma.search.count).mockResolvedValue(25)
    expect((await (await POST(req(valid) as never)).json()).limit.atCap).toBe(true)
    mock(prisma.search.count).mockResolvedValue(24)
    expect((await (await POST(req(valid) as never)).json()).limit.atCap).toBe(false)
  })

  it('counts what survived the prune, not what existed before it', async () => {
    mock(prisma.search.findMany).mockResolvedValue([{ id: 'old1' }])
    const res = await POST(req(valid) as never)
    expect(res.status).toBe(200)
    expect(prisma.search.count).toHaveBeenCalledWith({ where: { userId: 'user1' } })
    expect(mock(prisma.search.count).mock.invocationCallOrder[0]).toBeGreaterThan(
      mock(prisma.search.deleteMany).mock.invocationCallOrder[0]
    )
  })

  it('still returns the saved search alongside the limit', async () => {
    const body = await (await POST(req(valid) as never)).json()
    expect(body.search.userId).toBe('user1')
    expect(body.limit.cap).toBe(25)
  })
})

// GET only reads request.url, so a bare object stands in for NextRequest
const getReq = (qs = '') => ({ url: `http://x/api/searches${qs}`, headers: { get: () => null } })
const listArg = () => (prisma.search.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0]
const listRows = (...rows: unknown[]) =>
  (prisma.search.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows)

// a full preview row as the select returns it
const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: null,
  favorite: false,
  isReplay: false,
  createdAt: '2024-03-01T00:00:00.000Z',
  lastAccessedAt: null,
  board: [],
  odds: {},
  playerNames: null,
  scenario: null,
  players: [],
  replay: null,
  ...extra,
})

describe('searches GET paging', () => {
  it('takes the default page plus one probe row when no limit is given', async () => {
    await GET(getReq() as never)
    expect(listArg().take).toBe(61)
  })

  it('honours an explicit limit', async () => {
    await GET(getReq('?limit=5') as never)
    expect(listArg().take).toBe(6)
  })

  it('caps the limit at 200', async () => {
    await GET(getReq('?limit=999') as never)
    expect(listArg().take).toBe(201)
  })

  it('floors a fractional limit', async () => {
    await GET(getReq('?limit=5.9') as never)
    expect(listArg().take).toBe(6)
  })

  it('falls back to the default for junk, zero and negative limits', async () => {
    for (const qs of ['?limit=abc', '?limit=0', '?limit=-5', '?limit=', '?limit=1e999']) {
      ;(prisma.search.findMany as ReturnType<typeof vi.fn>).mockClear()
      await GET(getReq(qs) as never)
      expect(listArg().take, qs).toBe(61)
    }
  })

  it('passes a cursor as a keyset skip', async () => {
    await GET(getReq('?limit=5&cursor=abc') as never)
    expect(listArg()).toMatchObject({ cursor: { id: 'abc' }, skip: 1, take: 6 })
  })

  it('sends no cursor or skip on the first page', async () => {
    await GET(getReq('?limit=5') as never)
    expect(listArg()).not.toHaveProperty('cursor')
    expect(listArg()).not.toHaveProperty('skip')
  })

  it('starred=1 narrows the where to favorites', async () => {
    await GET(getReq('?starred=1') as never)
    expect(listArg().where).toEqual({ userId: 'user1', favorite: true })
  })

  it('any other starred value lists everything', async () => {
    for (const qs of ['?starred=0', '?starred=true', '?starred=', '']) {
      ;(prisma.search.findMany as ReturnType<typeof vi.fn>).mockClear()
      await GET(getReq(qs) as never)
      expect(listArg().where, qs).toEqual({ userId: 'user1' })
    }
  })

  it('selects only the preview columns', async () => {
    await GET(getReq() as never)
    expect(listArg().select).toEqual({
      id: true, name: true, favorite: true, isReplay: true, createdAt: true, lastAccessedAt: true,
      board: true, odds: true, playerNames: true, scenario: true, players: true, replay: true,
    })
  })

  it('nextCursor is null when exactly a full page comes back', async () => {
    listRows(row('a'), row('b'))
    const body = await (await GET(getReq('?limit=2') as never)).json()
    expect(body.searches.map((s: { id: string }) => s.id)).toEqual(['a', 'b'])
    expect(body.nextCursor).toBeNull()
  })

  it('drops the probe row and points nextCursor at the last returned id', async () => {
    listRows(row('a'), row('b'), row('c'))
    const body = await (await GET(getReq('?limit=2') as never)).json()
    expect(body.searches.map((s: { id: string }) => s.id)).toEqual(['a', 'b'])
    expect(body.nextCursor).toBe('b')
  })

  it('nextCursor is null on a short page', async () => {
    listRows(row('a'))
    expect((await (await GET(getReq('?limit=2') as never)).json()).nextCursor).toBeNull()
  })

  it('treats a call with no request as an empty query', async () => {
    listRows(row('a'))
    const res = await GET()
    expect(res.status).toBe(200)
    expect(listArg()).toMatchObject({ where: { userId: 'user1' }, take: 61 })
    expect(listArg()).not.toHaveProperty('cursor')
    expect((await res.json()).nextCursor).toBeNull()
  })
})

describe('searches GET previews', () => {
  // one row in, its slimmed preview out
  const preview = async (extra: Record<string, unknown>) => {
    listRows(row('p1', extra))
    return (await (await GET(getReq() as never)).json()).searches[0]
  }

  it('replaces range key lists with a count, leaving hands and empty seats alone', async () => {
    const hand = { kind: 'hand', hand: [{ v: 'A', s: 's' }, { v: 'K', s: 'd' }] }
    const out = await preview({ players: [{ kind: 'range', range: ['AA', 'KK', 'AKs'] }, hand, null] })
    expect(out.players).toEqual([{ kind: 'range', rangeCount: 3 }, hand, null])
  })

  it('counts a malformed range as zero', async () => {
    const out = await preview({ players: [{ kind: 'range' }, { kind: 'range', range: 'AA' }] })
    expect(out.players).toEqual([{ kind: 'range', rangeCount: 0 }, { kind: 'range', rangeCount: 0 }])
  })

  it('leaves non-array players untouched', async () => {
    expect((await preview({ players: null })).players).toBeNull()
    expect((await preview({ players: { kind: 'range', range: ['AA'] } })).players).toEqual({
      kind: 'range', range: ['AA'],
    })
  })

  it('slims a replay to a setup skeleton and an action count', async () => {
    const replay = {
      setup: {
        sb: 50, bb: 100, ante: 0, cents: true,
        seats: [
          { name: 'p0', pos: 'BTN', stack: 10000, cards: [{ v: 'A', s: 's' }, { v: 'K', s: 'd' }] },
          { name: 'p1', pos: 'BB', stack: 9000, cards: null },
        ],
      },
      actions: [1, 2, 3, 4],
      board: [{ v: 'J', s: 'h' }],
      board2: [{ v: '2', s: 'c' }],
      won: { 1: 200 },
      runResults: [{ x: 1 }],
    }
    const out = await preview({ isReplay: true, replay })
    expect(out.replay).toEqual({
      slim: true,
      setup: {
        sb: 50, bb: 100,
        seats: [
          { name: 'p0', pos: 'BTN', cards: [{ v: 'A', s: 's' }, { v: 'K', s: 'd' }] },
          { name: 'p1', pos: 'BB', cards: null },
        ],
      },
      board: [{ v: 'J', s: 'h' }],
      actionCount: 4,
    })
  })

  it('tolerates a replay with no setup, seats, board or actions', async () => {
    expect((await preview({ isReplay: true, replay: {} })).replay).toEqual({
      slim: true, setup: { seats: [] }, board: [], actionCount: 0,
    })
  })

  it('tolerates null seats and non-array board/actions', async () => {
    const out = await preview({
      isReplay: true,
      replay: { setup: { seats: [null] }, board: null, actions: 'nope' },
    })
    expect(out.replay.setup.seats).toEqual([{ cards: null }])
    expect(out.replay.board).toEqual([])
    expect(out.replay.actionCount).toBe(0)
  })

  it('nulls replay on rows that are not replays', async () => {
    expect((await preview({ isReplay: false, replay: { setup: {}, actions: [1] } })).replay).toBeNull()
    expect((await preview({ isReplay: true, replay: null })).replay).toBeNull()
    expect((await preview({ isReplay: true, replay: 'nope' })).replay).toBeNull()
  })

  it('passes the rest of the preview row through', async () => {
    const out = await preview({
      name: 'spot', favorite: true, scenario: '~Co', playerNames: ['Hero', null],
      board: [{ v: 'Q', s: 'd' }], odds: { 0: { win: 61.2 } }, lastAccessedAt: '2024-03-02T00:00:00.000Z',
    })
    expect(out).toEqual({
      id: 'p1', name: 'spot', favorite: true, isReplay: false,
      createdAt: '2024-03-01T00:00:00.000Z', lastAccessedAt: '2024-03-02T00:00:00.000Z',
      board: [{ v: 'Q', s: 'd' }], odds: { 0: { win: 61.2 } }, playerNames: ['Hero', null],
      scenario: '~Co', players: [], replay: null,
    })
  })
})

describe('searches DELETE', () => {
  const mock = (f: unknown) => f as ReturnType<typeof vi.fn>

  beforeEach(() => {
    mock(prisma.search.deleteMany).mockResolvedValue({ count: 3 })
  })

  it('403 on a cross-site request, before any auth work', async () => {
    expect((await DELETE(req({}, { 'sec-fetch-site': 'cross-site' }) as never)).status).toBe(403)
    expect(auth).not.toHaveBeenCalled()
    expect(prisma.search.deleteMany).not.toHaveBeenCalled()
  })

  it('401 when unauthenticated, before the rate limiter', async () => {
    mock(auth).mockResolvedValue(null)
    expect((await DELETE(req({}) as never)).status).toBe(401)
    expect(limit).not.toHaveBeenCalled()
    expect(prisma.search.deleteMany).not.toHaveBeenCalled()
  })

  it('429 with Retry-After on the save limiter, before any delete', async () => {
    mock(limit).mockResolvedValue({ ok: false, retryAfter: 12 })
    const res = await DELETE(req({}) as never)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('12')
    expect(limit).toHaveBeenCalledWith('save', 'user1')
    expect(prisma.search.deleteMany).not.toHaveBeenCalled()
  })

  it('clears the session user\'s non-favorites only', async () => {
    const res = await DELETE(req({}) as never)
    expect(res.status).toBe(200)
    expect(prisma.search.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user1', favorite: false },
    })
  })

  it('reports how many rows went', async () => {
    expect(await (await DELETE(req({}) as never)).json()).toEqual({ deleted: 3 })
    mock(prisma.search.deleteMany).mockResolvedValue({ count: 0 })
    expect(await (await DELETE(req({}) as never)).json()).toEqual({ deleted: 0 })
  })

  it('benign sec-fetch-site values pass through', async () => {
    for (const site of ['same-site', 'same-origin']) {
      expect((await DELETE(req({}, { 'sec-fetch-site': site }) as never)).status).toBe(200)
    }
  })

  it('500 when the delete fails', async () => {
    mock(prisma.search.deleteMany).mockRejectedValue(new Error('db down'))
    const res = await DELETE(req({}) as never)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
  })
})
