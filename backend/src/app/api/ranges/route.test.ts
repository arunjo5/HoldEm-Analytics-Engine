import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { savedRange: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/rateLimit', () => ({ limit: vi.fn(async () => ({ ok: true, retryAfter: 0 })) }))
vi.mock('@/lib/plan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/plan')>()),
  getPlan: vi.fn(),
}))

import { GET, POST } from '@/app/api/ranges/route'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { limit } from '@/lib/rateLimit'
import { getPlan, PLAN_LIMITS } from '@/lib/plan'
import { RANGE_KEYS } from '@/lib/library'

const asMock = (f: unknown) => f as ReturnType<typeof vi.fn>
const findMany = asMock(prisma.savedRange.findMany)
const count = asMock(prisma.savedRange.count)
const create = asMock(prisma.savedRange.create)

const SELECT = { id: true, name: true, keys: true, createdAt: true, updatedAt: true }
const FREE = { plan: 'free', interval: null, expiresAt: null, saveCap: 25, limits: PLAN_LIMITS.free, hasCustomer: false }
const PRO = { plan: 'pro', interval: 'year', expiresAt: null, saveCap: 5000, limits: PLAN_LIMITS.pro, hasCustomer: true }

const AT = new Date('2026-01-15T12:00:00.000Z')
const ZW = String.fromCharCode(0x200b)
const valid = { name: 'Button open', keys: ['AA', 'AKs'] }

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
    id: 'r1',
    name: data.name,
    keys: data.keys,
    createdAt: AT,
    updatedAt: AT,
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ranges GET', () => {
  it('401 when unauthenticated', async () => {
    asMock(auth).mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('429 with Retry-After on the read bucket', async () => {
    asMock(limit).mockResolvedValue({ ok: false, retryAfter: 17 })
    const res = await GET()
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('17')
    expect(limit).toHaveBeenCalledWith('read', 'user1')
    expect(findMany).not.toHaveBeenCalled()
  })

  it("lists only the caller's ranges, most recently touched first", async () => {
    await GET()
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user1' },
      orderBy: { updatedAt: 'desc' },
      select: SELECT,
    })
  })

  it('returns the rows under ranges', async () => {
    const rows = [{ id: 'r1', name: 'Button open', keys: ['AA'], createdAt: AT, updatedAt: AT }]
    findMany.mockResolvedValue(rows)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ranges: [{ ...rows[0], createdAt: AT.toISOString(), updatedAt: AT.toISOString() }],
    })
  })

  it('500 when the list query fails', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    const res = await GET()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
  })
})

describe('ranges POST gates', () => {
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
    asMock(limit).mockResolvedValue({ ok: false, retryAfter: 9 })
    const res = await POST(req(valid) as never)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('9')
    expect(limit).toHaveBeenCalledWith('save', 'user1')
    expect(getPlan).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('413 past the 8KB body cap', async () => {
    expect((await POST(req(valid, { 'content-length': '9000' }) as never)).status).toBe(413)
    expect((await POST(req({ ...valid, name: 'x'.repeat(8193) }) as never)).status).toBe(413)
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

describe('ranges POST validation', () => {
  it('400 Invalid name when it is missing, wrong-typed, blank or oversize', async () => {
    for (const name of [undefined, null, 42, {}, true, '', '   ', ZW, 'x'.repeat(61)]) {
      const res = await POST(req({ ...valid, name }) as never)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Invalid name')
    }
    expect((await POST(req({ ...valid, name: 'x'.repeat(60) }) as never)).status).toBe(200)
  })

  it('400 Invalid range for an empty, wrong-typed, unknown or oversize selection', async () => {
    for (const keys of [undefined, null, [], 'AA', {}, ['AA', 'XX'], ['AA', 42], new Array(170).fill('AA')]) {
      const res = await POST(req({ ...valid, keys }) as never)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Invalid range')
    }
    expect((await POST(req({ ...valid, keys: Array.from(RANGE_KEYS) }) as never)).status).toBe(200)
  })

  it('reports the name first when both are bad', async () => {
    const res = await POST(req({ name: '', keys: [] }) as never)
    expect((await res.json()).error).toBe('Invalid name')
  })

  it('validates before it looks up the plan or counts rows', async () => {
    await POST(req({ ...valid, name: 42 }) as never)
    await POST(req({ ...valid, keys: ['XX'] }) as never)
    expect(getPlan).not.toHaveBeenCalled()
    expect(count).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})

describe('ranges POST cap', () => {
  it('409 once a free user holds three ranges', async () => {
    count.mockResolvedValue(PLAN_LIMITS.free.ranges)
    const res = await POST(req(valid) as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'Saved range limit reached (3 on Free)',
      code: 'limit_reached',
      plan: 'free',
      cap: 3,
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('lets a free user save the third range', async () => {
    count.mockResolvedValue(PLAN_LIMITS.free.ranges - 1)
    expect((await POST(req(valid) as never)).status).toBe(200)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('409 once a pro user holds two hundred, naming the Pro cap', async () => {
    asMock(getPlan).mockResolvedValue(PRO)
    count.mockResolvedValue(PLAN_LIMITS.pro.ranges)
    const res = await POST(req(valid) as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'Saved range limit reached (200 on Pro)',
      code: 'limit_reached',
      plan: 'pro',
      cap: 200,
    })
  })

  it('lets a pro user past the free cap', async () => {
    asMock(getPlan).mockResolvedValue(PRO)
    count.mockResolvedValue(PLAN_LIMITS.pro.ranges - 1)
    expect((await POST(req(valid) as never)).status).toBe(200)
  })

  it("reads the plan for, and counts, only the caller's rows", async () => {
    await POST(req(valid) as never)
    expect(getPlan).toHaveBeenCalledWith('user1')
    expect(count).toHaveBeenCalledWith({ where: { userId: 'user1' } })
  })
})

describe('ranges POST create', () => {
  it('stores the row scoped to the user, returning the public columns', async () => {
    const res = await POST(req(valid) as never)
    expect(create).toHaveBeenCalledWith({
      data: { userId: 'user1', name: 'Button open', keys: ['AA', 'AKs'] },
      select: SELECT,
    })
    expect(await res.json()).toEqual({
      range: { id: 'r1', name: 'Button open', keys: ['AA', 'AKs'], createdAt: AT.toISOString(), updatedAt: AT.toISOString() },
    })
  })

  it('cleans and trims the name before storing it', async () => {
    await POST(req({ ...valid, name: '  Butt' + ZW + 'on open  ' }) as never)
    expect(createData().name).toBe('Button open')
  })

  it('dedupes the keys, keeping first-seen order', async () => {
    await POST(req({ ...valid, keys: ['AKs', 'AA', 'AKs', 'T9o'] }) as never)
    expect(createData().keys).toEqual(['AKs', 'AA', 'T9o'])
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
