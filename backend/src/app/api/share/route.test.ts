import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    shareLink: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))
vi.mock('@/lib/rateLimit', () => ({
  limit: vi.fn(async () => ({ ok: true, retryAfter: 0 })),
  getClientIp: vi.fn(() => '1.2.3.4'),
}))
vi.mock('@/lib/plan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/plan')>()),
  getPlan: vi.fn(),
}))
// real everything except the code generator, so the collision retry is observable
vi.mock('@/lib/shareLinks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shareLinks')>()),
  newCode: vi.fn(),
}))

import { POST, GET } from '@/app/api/share/route'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { limit } from '@/lib/rateLimit'
import { getPlan, PLAN_LIMITS } from '@/lib/plan'
import { newCode, payloadHash, linkSelect } from '@/lib/shareLinks'

const asMock = (f: unknown) => f as ReturnType<typeof vi.fn>
const findFirst = asMock(prisma.shareLink.findFirst)
const count = asMock(prisma.shareLink.count)
const create = asMock(prisma.shareLink.create)
const findMany = asMock(prisma.shareLink.findMany)

const PRO = { plan: 'pro', interval: 'year', expiresAt: null, saveCap: 5000, hasCustomer: true }
const FREE = { plan: 'free', interval: null, expiresAt: null, saveCap: 25, hasCustomer: false }

const PAYLOAD = '~N4IgzgpgTgLgngBwFAA'
const valid = { kind: 'scenario', payload: PAYLOAD }
const CODES = ['code0001', 'code0002', 'code0003', 'code0004']
const CREATED = new Date('2026-01-15T12:00:00.000Z')

function req(body: unknown = {}, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  const h: Record<string, string> = { 'content-length': String(Buffer.byteLength(json, 'utf8')), ...headers }
  return {
    headers: { get: (k: string) => h[k.toLowerCase()] ?? null },
    text: async () => json,
  } as unknown as Request
}

const p2002 = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
const createData = (i = 0) => create.mock.calls[i][0].data

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  asMock(auth).mockResolvedValue({ user: { id: 'user1' } })
  asMock(limit).mockResolvedValue({ ok: true, retryAfter: 0 })
  asMock(getPlan).mockResolvedValue(PRO)
  findFirst.mockResolvedValue(null)
  count.mockResolvedValue(0)
  findMany.mockResolvedValue([])
  let n = 0
  asMock(newCode).mockImplementation(() => CODES[n++])
  create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    code: data.code,
    kind: data.kind,
    name: data.name,
    views: 0,
    createdAt: CREATED,
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('share POST gates', () => {
  it('403 on a cross-site request, before any auth work', async () => {
    const res = await POST(req(valid, { 'sec-fetch-site': 'cross-site' }) as never)
    expect(res.status).toBe(403)
    expect(auth).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('lets benign sec-fetch-site values through', async () => {
    for (const site of ['same-origin', 'same-site', 'none']) {
      expect((await POST(req(valid, { 'sec-fetch-site': site }) as never)).status).toBe(200)
    }
  })

  it('401 when unauthenticated', async () => {
    asMock(auth).mockResolvedValue(null)
    expect((await POST(req(valid) as never)).status).toBe(401)
    expect(limit).not.toHaveBeenCalled()
  })

  it('429 with Retry-After on the share bucket', async () => {
    asMock(limit).mockResolvedValue({ ok: false, retryAfter: 900 })
    const res = await POST(req(valid) as never)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('900')
    expect(limit).toHaveBeenCalledWith('share', 'user1')
    expect(getPlan).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('413 past the 64KB body cap', async () => {
    expect((await POST(req(valid, { 'content-length': '70000' }) as never)).status).toBe(413)
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

describe('share POST validation', () => {
  it('400 Invalid kind for anything but scenario or replay', async () => {
    for (const kind of [undefined, null, 'Scenario', 'spot', 42]) {
      const res = await POST(req({ ...valid, kind }) as never)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Invalid kind')
    }
  })

  it('400 Invalid payload for an empty, missing, non-string or off-charset payload', async () => {
    for (const payload of [undefined, null, '', 42, {}, 'has space', 'has#hash', 'has<lt']) {
      const res = await POST(req({ ...valid, payload }) as never)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Invalid payload')
    }
  })

  it('sizes the payload cap by kind', async () => {
    expect((await POST(req({ kind: 'scenario', payload: 'a'.repeat(16384) }) as never)).status).toBe(200)
    expect((await POST(req({ kind: 'scenario', payload: 'a'.repeat(16385) }) as never)).status).toBe(400)
    expect((await POST(req({ kind: 'replay', payload: 'a'.repeat(49152) }) as never)).status).toBe(200)
    expect((await POST(req({ kind: 'replay', payload: 'a'.repeat(49153) }) as never)).status).toBe(400)
  })

  it('400 Invalid name for a non-string or an oversize name', async () => {
    for (const name of [42, {}, true, 'x'.repeat(101)]) {
      const res = await POST(req({ ...valid, name }) as never)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Invalid name')
    }
    expect((await POST(req({ ...valid, name: 'x'.repeat(100) }) as never)).status).toBe(200)
  })

  it('checks the body before it looks up the plan', async () => {
    await POST(req({ kind: 'nope' }) as never)
    await POST(req({ ...valid, payload: 'bad payload' }) as never)
    await POST(req({ ...valid, name: 42 }) as never)
    expect(getPlan).not.toHaveBeenCalled()
    expect(findFirst).not.toHaveBeenCalled()
  })
})

describe('share POST plan gate', () => {
  it('403 pro_required for a free user, touching nothing', async () => {
    asMock(getPlan).mockResolvedValue(FREE)
    const res = await POST(req(valid) as never)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Short links are a Pro feature', code: 'pro_required' })
    expect(getPlan).toHaveBeenCalledWith('user1')
    expect(findFirst).not.toHaveBeenCalled()
    expect(count).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('lets a pro user create', async () => {
    expect((await POST(req(valid) as never)).status).toBe(200)
    expect(create).toHaveBeenCalledTimes(1)
  })
})

describe('share POST dedupe', () => {
  const existing = { code: 'old12345', kind: 'scenario', name: 'saved', views: 3, createdAt: CREATED }

  it('returns the existing link and skips the cap check and the insert', async () => {
    findFirst.mockResolvedValue(existing)
    const res = await POST(req(valid) as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ link: { ...existing, createdAt: CREATED.toISOString() }, existing: true })
    expect(count).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('looks the payload up by user and hash, returning only the public columns', async () => {
    await POST(req(valid) as never)
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'user1', payloadHash: payloadHash('scenario', PAYLOAD) },
      select: linkSelect,
    })
  })

  it('keys the hash on the kind, so the same payload shared twice differs', async () => {
    await POST(req({ kind: 'scenario', payload: PAYLOAD }) as never)
    await POST(req({ kind: 'replay', payload: PAYLOAD }) as never)
    expect(findFirst.mock.calls[1][0].where.payloadHash).toBe(payloadHash('replay', PAYLOAD))
    expect(findFirst.mock.calls[1][0].where.payloadHash).not.toBe(findFirst.mock.calls[0][0].where.payloadHash)
  })

  it('marks a fresh link as not existing', async () => {
    expect(await (await POST(req(valid) as never)).json()).toEqual({
      link: { code: 'code0001', kind: 'scenario', name: null, views: 0, createdAt: CREATED.toISOString() },
    })
  })
})

describe('share POST cap', () => {
  it('409 once the user holds the pro link limit', async () => {
    count.mockResolvedValue(PLAN_LIMITS.pro.shareLinks)
    const res = await POST(req(valid) as never)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Link limit reached. Delete some old links first.')
    expect(create).not.toHaveBeenCalled()
  })

  it('still creates one link below the limit', async () => {
    count.mockResolvedValue(PLAN_LIMITS.pro.shareLinks - 1)
    expect((await POST(req(valid) as never)).status).toBe(200)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('counts only that user\'s links', async () => {
    await POST(req(valid) as never)
    expect(count).toHaveBeenCalledWith({ where: { userId: 'user1' } })
  })
})

describe('share POST create', () => {
  it('stores the row scoped to the user with a fresh code and the public select', async () => {
    await POST(req({ ...valid, name: 'My spot' }) as never)
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'user1',
        kind: 'scenario',
        payload: PAYLOAD,
        payloadHash: payloadHash('scenario', PAYLOAD),
        name: 'My spot',
        code: 'code0001',
      },
      select: linkSelect,
    })
  })

  it('nulls a missing name', async () => {
    await POST(req(valid) as never)
    await POST(req({ ...valid, name: null }) as never)
    expect(createData(0).name).toBeNull()
    expect(createData(1).name).toBeNull()
  })

  it('cleans and trims the name, nulling one that is only whitespace', async () => {
    await POST(req({ ...valid, name: '  Na' + String.fromCharCode(0x200b) + 'me  ' }) as never)
    await POST(req({ ...valid, name: '   ' }) as never)
    await POST(req({ ...valid, name: String.fromCharCode(0x200b) }) as never)
    expect(createData(0).name).toBe('Name')
    expect(createData(1).name).toBeNull()
    expect(createData(2).name).toBeNull()
  })

  it('retries a code collision with a new code', async () => {
    create.mockRejectedValueOnce(p2002())
    const res = await POST(req(valid) as never)
    expect(res.status).toBe(200)
    expect(create).toHaveBeenCalledTimes(2)
    expect(createData(0).code).toBe('code0001')
    expect(createData(1).code).toBe('code0002')
    expect((await res.json()).link.code).toBe('code0002')
  })

  it('gives up after three collisions', async () => {
    create.mockRejectedValue(p2002())
    const res = await POST(req(valid) as never)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
    expect(create).toHaveBeenCalledTimes(3)
    expect(new Set(create.mock.calls.map((c) => c[0].data.code)).size).toBe(3)
  })

  it('500 without retrying on any other insert failure', async () => {
    create.mockRejectedValue(new Error('db down'))
    const res = await POST(req(valid) as never)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('500 when the dedupe lookup fails', async () => {
    findFirst.mockRejectedValue(new Error('db down'))
    expect((await POST(req(valid) as never)).status).toBe(500)
    expect(create).not.toHaveBeenCalled()
  })
})

describe('share GET', () => {
  it('401 when unauthenticated', async () => {
    asMock(auth).mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('429 with Retry-After on the read bucket', async () => {
    asMock(limit).mockResolvedValue({ ok: false, retryAfter: 12 })
    const res = await GET()
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('12')
    expect(limit).toHaveBeenCalledWith('read', 'user1')
    expect(findMany).not.toHaveBeenCalled()
  })

  it('lists the caller\'s links newest first, without the payloads', async () => {
    await GET()
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user1' },
      orderBy: { createdAt: 'desc' },
      select: linkSelect,
    })
  })

  it('returns the rows under links', async () => {
    const rows = [{ code: 'code0001', kind: 'replay', name: null, views: 2, createdAt: CREATED }]
    findMany.mockResolvedValue(rows)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ links: [{ ...rows[0], createdAt: CREATED.toISOString() }] })
  })

  it('500 when the list query fails', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    expect((await GET()).status).toBe(500)
  })
})
