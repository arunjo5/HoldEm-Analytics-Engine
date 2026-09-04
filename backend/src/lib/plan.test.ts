import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }))

import { PLAN_LIMITS, effectivePlan, getPlan } from '@/lib/plan'
import { prisma } from '@/lib/prisma'

const findUnique = prisma.user.findUnique as ReturnType<typeof vi.fn>
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0)
const GRACE = 3 * 24 * 60 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  findUnique.mockResolvedValue(null)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PLAN_LIMITS', () => {
  it('caps free at 25 saves and pro at 5000', () => {
    expect(PLAN_LIMITS).toEqual({ free: { saveCap: 25 }, pro: { saveCap: 5000 } })
  })
})

describe('effectivePlan', () => {
  it('treats a null or non-pro plan as free', () => {
    expect(effectivePlan({ plan: null, planExpiresAt: null })).toBe('free')
    expect(effectivePlan({ plan: 'free', planExpiresAt: null })).toBe('free')
    expect(effectivePlan({ plan: 'trial', planExpiresAt: null })).toBe('free')
  })

  it('keeps pro when there is no expiry or the expiry is ahead', () => {
    expect(effectivePlan({ plan: 'pro', planExpiresAt: null })).toBe('pro')
    expect(effectivePlan({ plan: 'pro', planExpiresAt: new Date(NOW + DAY) })).toBe('pro')
  })

  it('keeps pro right up to the end of the 3-day grace', () => {
    expect(effectivePlan({ plan: 'pro', planExpiresAt: new Date(NOW - GRACE + 1) })).toBe('pro')
    // grace end exactly: the check is strictly-less-than, so this is still pro
    expect(effectivePlan({ plan: 'pro', planExpiresAt: new Date(NOW - GRACE) })).toBe('pro')
  })

  it('drops to free one ms past the grace', () => {
    expect(effectivePlan({ plan: 'pro', planExpiresAt: new Date(NOW - GRACE - 1) })).toBe('free')
    expect(effectivePlan({ plan: 'pro', planExpiresAt: new Date(NOW - 30 * DAY) })).toBe('free')
  })

  it('an expired non-pro row is still free', () => {
    expect(effectivePlan({ plan: 'free', planExpiresAt: new Date(NOW + DAY) })).toBe('free')
  })
})

describe('getPlan', () => {
  it('reads only the billing columns for that user', async () => {
    await getPlan('u1')
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { plan: true, planInterval: true, planExpiresAt: true, stripeCustomerId: true },
    })
  })

  it('falls back to free when the row is gone', async () => {
    expect(await getPlan('u1')).toEqual({
      plan: 'free', interval: null, expiresAt: null, saveCap: 25, hasCustomer: false,
    })
  })

  it('reports a monthly pro subscription', async () => {
    const expires = new Date(NOW + 10 * DAY)
    findUnique.mockResolvedValue({
      plan: 'pro', planInterval: 'month', planExpiresAt: expires, stripeCustomerId: 'cus_1',
    })
    expect(await getPlan('u1')).toEqual({
      plan: 'pro',
      interval: 'month',
      expiresAt: expires.toISOString(),
      saveCap: 5000,
      hasCustomer: true,
    })
  })

  it('reports a yearly pro subscription', async () => {
    findUnique.mockResolvedValue({
      plan: 'pro', planInterval: 'year', planExpiresAt: null, stripeCustomerId: null,
    })
    expect(await getPlan('u1')).toEqual({
      plan: 'pro', interval: 'year', expiresAt: null, saveCap: 5000, hasCustomer: false,
    })
  })

  it('nulls an interval that is neither month nor year', async () => {
    for (const planInterval of ['week', 'day', '', null]) {
      findUnique.mockResolvedValue({ plan: 'pro', planInterval, planExpiresAt: null, stripeCustomerId: null })
      expect((await getPlan('u1')).interval).toBeNull()
    }
  })

  it('hides interval and expiry from a free row that still has leftovers', async () => {
    findUnique.mockResolvedValue({
      plan: 'free', planInterval: 'month', planExpiresAt: new Date(NOW + DAY), stripeCustomerId: 'cus_1',
    })
    expect(await getPlan('u1')).toEqual({
      plan: 'free', interval: null, expiresAt: null, saveCap: 25, hasCustomer: true,
    })
  })

  it('still serves pro inside the grace window', async () => {
    const expires = new Date(NOW - GRACE + 1000)
    findUnique.mockResolvedValue({
      plan: 'pro', planInterval: 'month', planExpiresAt: expires, stripeCustomerId: 'cus_1',
    })
    expect(await getPlan('u1')).toEqual({
      plan: 'pro', interval: 'month', expiresAt: expires.toISOString(), saveCap: 5000, hasCustomer: true,
    })
  })

  it('downgrades past the grace but keeps hasCustomer for the portal link', async () => {
    findUnique.mockResolvedValue({
      plan: 'pro', planInterval: 'month', planExpiresAt: new Date(NOW - GRACE - 1), stripeCustomerId: 'cus_1',
    })
    expect(await getPlan('u1')).toEqual({
      plan: 'free', interval: null, expiresAt: null, saveCap: 25, hasCustomer: true,
    })
  })
})
