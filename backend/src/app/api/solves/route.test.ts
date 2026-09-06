import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { savedSolve: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/rateLimit', () => ({ limit: vi.fn(async () => ({ ok: true, retryAfter: 0 })) }))
vi.mock('@/lib/plan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/plan')>()),
  getPlan: vi.fn(),
}))

import { GET, POST } from '@/app/api/solves/route'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { limit } from '@/lib/rateLimit'
import { getPlan, PLAN_LIMITS } from '@/lib/plan'

const asMock = (f: unknown) => f as ReturnType<typeof vi.fn>
const findMany = asMock(prisma.savedSolve.findMany)
const count = asMock(prisma.savedSolve.count)
const create = asMock(prisma.savedSolve.create)

const SELECT = { id: true, name: true, config: true, summary: true, createdAt: true }
const FREE = { plan: 'free', interval: null, expiresAt: null, saveCap: 25, limits: PLAN_LIMITS.free, hasCustomer: false }
const PRO = { plan: 'pro', interval: 'year', expiresAt: null, saveCap: 5000, limits: PLAN_LIMITS.pro, hasCustomer: true }

const AT = new Date('2026-01-15T12:00:00.000Z')
const ZW = String.fromCharCode(0x200b)

const card = (v: string, s: string) => ({ v, s })
const CONFIG = {
  board: [card('A', 's'), card('K', 'h'), card('2', 'd')],
  oopSide: { kind: 'range', keys: ['AA', 'AKs'] },
  ipSide: { kind: 'hand', cards: [card('Q', 'c'), card('J', 'd')] },
  spot: { pot: 10, stack: 100, allIn: false, betSizes: [{ id: 'b1', pct: 33, on: true }] },
}
const SUMMARY = { ev: 1.25, line: 'bet 33' }
const valid = { name: 'Ace-high flop', config: CONFIG, summary: SUMMARY }

function req(body: unknown = {}, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  const h: Record<string, string> = { 'content-length': String(Buffer.byteLength(json, 'utf8')), ...headers }
  return {
    headers: { get: (k: string) => h[k.toLowerCase()] ?? null },
    text: async () => json,
  } as unknown as Request
}

const createData = (i = 0) => create.mock.calls[i][0].data

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  asMock(auth).mockResolvedValue({ user: { id: 'user1' } })
  asMock(limit).mockResolvedValue({ ok: true, retryAfter: 0 })
  asMock(getPlan).mockResolvedValue(FREE)
  findMany.mockResolvedValue([])
  count.mockResolvedValue(0)
  create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 's1',
    name: data.name,
    config: data.config,
    summary: data.summary,
    createdAt: AT,
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('solves GET', () => {
  it('401 when unauthenticated', async () => {
    asMock(auth).mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('429 with Retry-After on the read bucket', async () => {
    asMock(limit).mockResolvedValue({ ok: false, retryAfter: 21 })
    const res = await GET()
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('21')
    expect(limit).toHaveBeenCalledWith('read', 'user1')
    expect(findMany).not.toHaveBeenCalled()
  })

  it("lists only the caller's solves, newest first", async () => {
    await GET()
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user1' },
      orderBy: { createdAt: 'desc' },
      select: SELECT,
    })
  })

  it('returns the rows under solves', async () => {
    const rows = [{ id: 's1', name: 'Ace-high flop', config: CONFIG, summary: SUMMARY, createdAt: AT }]
    findMany.mockResolvedValue(rows)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ solves: [{ ...rows[0], createdAt: AT.toISOString() }] })
  })

  it('500 when the list query fails', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    const res = await GET()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
  })
})

describe('solves POST gates', () => {
  it('403 on a cross-site request, before any auth work', async () => {
    const res = await POST(req(valid, { 'sec-fetch-site': 'cross-site' }) as never)
    expect(res.status).toBe(403)
    expect(auth).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('401 when unauthenticated', async () => {
    asMock(auth).mockResolvedValue(null)
    expect((await POST(req(valid) as never)).status).toBe(401)
    expect(limit).not.toHaveBeenCalled()
  })

  it('429 with Retry-After on the save bucket', async () => {
    asMock(limit).mockResolvedValue({ ok: false, retryAfter: 11 })
    const res = await POST(req(valid) as never)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('11')
    expect(limit).toHaveBeenCalledWith('save', 'user1')
    expect(getPlan).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('413 past the 16KB body cap', async () => {
    expect((await POST(req(valid, { 'content-length': '20000' }) as never)).status).toBe(413)
    expect((await POST(req({ ...valid, name: 'x'.repeat(16385) }) as never)).status).toBe(413)
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
})

describe('solves POST validation', () => {
  it('400 Invalid name when it is missing, wrong-typed, blank or oversize', async () => {
    for (const name of [undefined, null, 42, {}, true, '', '   ', ZW, 'x'.repeat(61)]) {
      const res = await POST(req({ ...valid, name }) as never)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Invalid name')
    }
    expect((await POST(req({ ...valid, name: 'x'.repeat(60) }) as never)).status).toBe(200)
  })

  it('400 Invalid solve for a missing or malformed config', async () => {
    const bad = [
      undefined,
      null,
      'config',
      {},
      { ...CONFIG, board: new Array(6).fill(null) },
      { ...CONFIG, board: [{ v: 'A', s: 'x' }] },
      { ...CONFIG, oopSide: { kind: 'range', keys: [] } },
      { ...CONFIG, ipSide: { kind: 'hand', cards: [card('A', 's')] } },
      { ...CONFIG, spot: { ...CONFIG.spot, pot: -1 } },
      { ...CONFIG, spot: { ...CONFIG.spot, stack: 1e6 + 1 } },
      { ...CONFIG, spot: { ...CONFIG.spot, allIn: 'yes' } },
      { ...CONFIG, spot: { ...CONFIG.spot, betSizes: [{ id: 'b1', pct: 0, on: true }] } },
    ]
    for (const config of bad) {
      const res = await POST(req({ ...valid, config }) as never)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Invalid solve')
    }
  })

  it('400 Invalid summary for a missing or malformed summary', async () => {
    for (const summary of [undefined, null, 'ev', 42, [], { ev: { street: 'flop' } }, { ev: true }, { ev: [1] }]) {
      const res = await POST(req({ ...valid, summary }) as never)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Invalid summary')
    }
    expect((await POST(req({ ...valid, summary: {} }) as never)).status).toBe(200)
  })

  it('checks name, then config, then summary', async () => {
    expect((await (await POST(req({ name: '', config: null, summary: null }) as never)).json()).error).toBe('Invalid name')
    expect((await (await POST(req({ ...valid, config: null, summary: null }) as never)).json()).error).toBe('Invalid solve')
  })

  it('validates before it looks up the plan or counts rows', async () => {
    await POST(req({ ...valid, name: 42 }) as never)
    await POST(req({ ...valid, config: {} }) as never)
    await POST(req({ ...valid, summary: [] }) as never)
    expect(getPlan).not.toHaveBeenCalled()
    expect(count).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})

describe('solves POST cap', () => {
  it('409 once a free user holds three solves', async () => {
    count.mockResolvedValue(PLAN_LIMITS.free.solves)
    const res = await POST(req(valid) as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'Saved solve limit reached (3 on Free)',
      code: 'limit_reached',
      plan: 'free',
      cap: 3,
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('lets a free user save the third solve', async () => {
    count.mockResolvedValue(PLAN_LIMITS.free.solves - 1)
    expect((await POST(req(valid) as never)).status).toBe(200)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('409 once a pro user holds two hundred, naming the Pro cap', async () => {
    asMock(getPlan).mockResolvedValue(PRO)
    count.mockResolvedValue(PLAN_LIMITS.pro.solves)
    const res = await POST(req(valid) as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'Saved solve limit reached (200 on Pro)',
      code: 'limit_reached',
      plan: 'pro',
      cap: 200,
    })
  })

  it('lets a pro user past the free cap', async () => {
    asMock(getPlan).mockResolvedValue(PRO)
    count.mockResolvedValue(PLAN_LIMITS.pro.solves - 1)
    expect((await POST(req(valid) as never)).status).toBe(200)
  })

  it("reads the plan for, and counts, only the caller's rows", async () => {
    await POST(req(valid) as never)
    expect(getPlan).toHaveBeenCalledWith('user1')
    expect(count).toHaveBeenCalledWith({ where: { userId: 'user1' } })
  })
})

describe('solves POST create', () => {
  it('stores the row scoped to the user, returning the public columns', async () => {
    const res = await POST(req(valid) as never)
    expect(create).toHaveBeenCalledWith({
      data: { userId: 'user1', name: 'Ace-high flop', config: CONFIG, summary: SUMMARY },
      select: SELECT,
    })
    expect(await res.json()).toEqual({
      solve: { id: 's1', name: 'Ace-high flop', config: CONFIG, summary: SUMMARY, createdAt: AT.toISOString() },
    })
  })

  it('cleans and trims the name before storing it', async () => {
    await POST(req({ ...valid, name: '  Ace-high fl' + ZW + 'op  ' }) as never)
    expect(createData().name).toBe('Ace-high flop')
  })

  it('500 when the insert throws', async () => {
    create.mockRejectedValue(new Error('db down'))
    const res = await POST(req(valid) as never)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
  })

  it('500 when the cap count throws, without inserting', async () => {
    count.mockRejectedValue(new Error('db down'))
    expect((await POST(req(valid) as never)).status).toBe(500)
    expect(create).not.toHaveBeenCalled()
  })
})
