import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { search: { count: vi.fn(async () => 0) } } }))
vi.mock('@/lib/rateLimit', () => ({
  limit: vi.fn(async () => ({ ok: true, retryAfter: 0 })),
  getClientIp: vi.fn(() => '1.2.3.4'),
}))
// keep the real PLAN_LIMITS so the anonymous payload is checked against the shipped cap
vi.mock('@/lib/plan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/plan')>()),
  getPlan: vi.fn(),
}))
vi.mock('@/lib/stripe', () => ({ billingEnabled: vi.fn(() => false) }))

import { GET } from '@/app/api/billing/status/route'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { limit } from '@/lib/rateLimit'
import { getPlan, PLAN_LIMITS } from '@/lib/plan'
import { billingEnabled } from '@/lib/stripe'

const asMock = (f: unknown) => f as ReturnType<typeof vi.fn>
const count = asMock(prisma.search.count)

function req(): Request {
  return { headers: { get: () => null } } as unknown as Request
}

const PRO = {
  plan: 'pro',
  interval: 'year',
  expiresAt: '2027-01-15T12:00:00.000Z',
  saveCap: 5000,
  hasCustomer: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  asMock(auth).mockResolvedValue({ user: { id: 'user1' } })
  asMock(limit).mockResolvedValue({ ok: true, retryAfter: 0 })
  asMock(billingEnabled).mockReturnValue(false)
  asMock(getPlan).mockResolvedValue(PRO)
  count.mockResolvedValue(0)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('status GET anonymous', () => {
  beforeEach(() => asMock(auth).mockResolvedValue(null))

  it('returns the free defaults without touching the db', async () => {
    const res = await GET(req() as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      plan: 'free',
      interval: null,
      expiresAt: null,
      saveCap: 25,
      hasCustomer: false,
      saved: 0,
      billingEnabled: false,
      limits: PLAN_LIMITS,
    })
    expect(getPlan).not.toHaveBeenCalled()
    expect(count).not.toHaveBeenCalled()
  })

  it('rate limits anonymous callers by ip', async () => {
    await GET(req() as never)
    expect(limit).toHaveBeenCalledWith('read', 'ip:1.2.3.4')
  })

  it('still reports billing as available', async () => {
    asMock(billingEnabled).mockReturnValue(true)
    expect((await (await GET(req() as never)).json()).billingEnabled).toBe(true)
  })
})

describe('status GET signed in', () => {
  it('merges the plan info with the saved count', async () => {
    asMock(billingEnabled).mockReturnValue(true)
    count.mockResolvedValue(7)
    const res = await GET(req() as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ...PRO, saved: 7, billingEnabled: true, limits: PLAN_LIMITS })
    expect(getPlan).toHaveBeenCalledWith('user1')
    expect(count).toHaveBeenCalledWith({ where: { userId: 'user1' } })
  })

  it('rate limits by user id, not ip', async () => {
    await GET(req() as never)
    expect(limit).toHaveBeenCalledWith('read', 'user1')
  })
})

describe('status GET failures', () => {
  it('429 with Retry-After before any lookup', async () => {
    asMock(limit).mockResolvedValue({ ok: false, retryAfter: 5 })
    const res = await GET(req() as never)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('5')
    expect(getPlan).not.toHaveBeenCalled()
    expect(count).not.toHaveBeenCalled()
  })

  it('500 when the plan lookup throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    asMock(getPlan).mockRejectedValue(new Error('db down'))
    const res = await GET(req() as never)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
  })

  it('500 when the count throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    count.mockRejectedValue(new Error('db down'))
    expect((await GET(req() as never)).status).toBe(500)
  })
})
