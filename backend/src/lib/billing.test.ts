import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type Stripe from 'stripe'

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn(), update: vi.fn() } } }))

import { syncSubscription } from '@/lib/billing'
import { prisma } from '@/lib/prisma'

const findUnique = prisma.user.findUnique as ReturnType<typeof vi.fn>
const update = prisma.user.update as ReturnType<typeof vi.fn>

const PERIOD_END = 1_800_000_000 // unix seconds
const ITEM = { current_period_end: PERIOD_END, price: { recurring: { interval: 'month' } } }

function sub(over: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    metadata: {},
    items: { data: [ITEM] },
    ...over,
  } as unknown as Stripe.Subscription
}

type Row = { id: string; stripeSubscriptionId: string | null }

// the source tries stripeCustomerId first, then the id hint; route each where-clause separately
function rows({ byCustomer = null, byId = null }: { byCustomer?: Row | null; byId?: Row | null }) {
  findUnique.mockImplementation(async ({ where }: { where: { stripeCustomerId?: string; id?: string } }) =>
    where.stripeCustomerId !== undefined ? byCustomer : byId
  )
}

const data = () => update.mock.calls[0][0].data

beforeEach(() => {
  vi.clearAllMocks()
  rows({})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('syncSubscription user lookup', () => {
  it('finds the user by stripeCustomerId', async () => {
    rows({ byCustomer: { id: 'u1', stripeSubscriptionId: null } })
    expect(await syncSubscription(sub())).toEqual({ userId: 'u1', plan: 'pro' })
    expect(findUnique).toHaveBeenCalledTimes(1)
    expect(findUnique.mock.calls[0][0].where).toEqual({ stripeCustomerId: 'cus_1' })
  })

  it('unwraps an expanded customer object', async () => {
    rows({ byCustomer: { id: 'u1', stripeSubscriptionId: null } })
    await syncSubscription(sub({ customer: { id: 'cus_9' } }))
    expect(findUnique.mock.calls[0][0].where).toEqual({ stripeCustomerId: 'cus_9' })
  })

  it('falls back to the hint when no row carries the customer id yet', async () => {
    rows({ byCustomer: null, byId: { id: 'u2', stripeSubscriptionId: null } })
    expect(await syncSubscription(sub(), 'u2')).toEqual({ userId: 'u2', plan: 'pro' })
    expect(findUnique).toHaveBeenCalledTimes(2)
    expect(findUnique.mock.calls[1][0].where).toEqual({ id: 'u2' })
  })

  it('uses metadata.userId when no hint is passed', async () => {
    rows({ byId: { id: 'u3', stripeSubscriptionId: null } })
    await syncSubscription(sub({ customer: null, metadata: { userId: 'u3' } }))
    expect(findUnique.mock.calls[0][0].where).toEqual({ id: 'u3' })
  })

  it('prefers the explicit hint over metadata.userId', async () => {
    rows({ byId: { id: 'u4', stripeSubscriptionId: null } })
    await syncSubscription(sub({ customer: null, metadata: { userId: 'u3' } }), 'u4')
    expect(findUnique.mock.calls[0][0].where).toEqual({ id: 'u4' })
  })

  it('skips the hint lookup entirely when there is nothing to look up', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await syncSubscription(sub({ customer: null }))).toBeNull()
    expect(findUnique).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('stripe: no user for subscription', 'sub_1')
  })

  it('returns null and warns when neither lookup matches', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await syncSubscription(sub(), 'nobody')).toBeNull()
    expect(update).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('stripe: no user for subscription', 'sub_1')
  })
})

describe('syncSubscription active statuses', () => {
  beforeEach(() => rows({ byCustomer: { id: 'u1', stripeSubscriptionId: null } }))

  it('writes the full pro row', async () => {
    await syncSubscription(sub())
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        plan: 'pro',
        planInterval: 'month',
        planExpiresAt: new Date(PERIOD_END * 1000),
      },
    })
  })

  it.each(['active', 'trialing', 'past_due'])('keeps %s on pro', async (status) => {
    expect(await syncSubscription(sub({ status }))).toEqual({ userId: 'u1', plan: 'pro' })
    expect(data().plan).toBe('pro')
  })

  it.each(['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'])(
    'drops %s to free',
    async (status) => {
      expect(await syncSubscription(sub({ status }))).toEqual({ userId: 'u1', plan: 'free' })
      expect(data()).toEqual({
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: null,
        plan: 'free',
        planInterval: null,
        planExpiresAt: null,
      })
    }
  )

  it('leaves stripeCustomerId untouched when the payload has no customer', async () => {
    rows({ byId: { id: 'u1', stripeSubscriptionId: null } })
    await syncSubscription(sub({ customer: null }), 'u1')
    expect(data().stripeCustomerId).toBeUndefined()
  })
})

describe('syncSubscription interval', () => {
  beforeEach(() => rows({ byCustomer: { id: 'u1', stripeSubscriptionId: null } }))

  it.each([
    ['month', 'month'],
    ['year', 'year'],
  ])('mirrors the %s interval', async (interval, expected) => {
    await syncSubscription(sub({ items: { data: [{ ...ITEM, price: { recurring: { interval } } }] } }))
    expect(data().planInterval).toBe(expected)
  })

  it('nulls an interval that is neither month nor year', async () => {
    await syncSubscription(sub({ items: { data: [{ ...ITEM, price: { recurring: { interval: 'week' } } }] } }))
    expect(data().planInterval).toBeNull()
  })

  it('nulls the interval when price or items are missing', async () => {
    await syncSubscription(sub({ items: { data: [{ current_period_end: PERIOD_END }] } }))
    expect(data().planInterval).toBeNull()
    update.mockClear()
    await syncSubscription(sub({ items: undefined }))
    expect(data().planInterval).toBeNull()
  })
})

describe('syncSubscription period end', () => {
  beforeEach(() => rows({ byCustomer: { id: 'u1', stripeSubscriptionId: null } }))

  it('prefers the item period over the subscription-level one', async () => {
    await syncSubscription(sub({ current_period_end: 1_700_000_000 }))
    expect(data().planExpiresAt).toEqual(new Date(PERIOD_END * 1000))
  })

  it('falls back to the subscription-level period on older payloads', async () => {
    await syncSubscription(
      sub({ items: { data: [{ price: { recurring: { interval: 'year' } } }] }, current_period_end: 1_700_000_000 })
    )
    expect(data().planExpiresAt).toEqual(new Date(1_700_000_000 * 1000))
  })

  it('nulls the expiry when neither level carries a period', async () => {
    await syncSubscription(sub({ items: { data: [{ price: { recurring: { interval: 'year' } } }] } }))
    expect(data().planExpiresAt).toBeNull()
  })

  it('ignores a non-numeric period', async () => {
    await syncSubscription(sub({ items: { data: [{ ...ITEM, current_period_end: '1800000000' }] } }))
    expect(data().planExpiresAt).toBeNull()
  })
})

describe('syncSubscription out-of-order deliveries', () => {
  it('will not let an ended older subscription downgrade the user', async () => {
    rows({ byCustomer: { id: 'u1', stripeSubscriptionId: 'sub_current' } })
    expect(await syncSubscription(sub({ id: 'sub_old', status: 'canceled' }))).toEqual({
      userId: 'u1',
      plan: 'pro',
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('downgrades when the ended subscription is the current one', async () => {
    rows({ byCustomer: { id: 'u1', stripeSubscriptionId: 'sub_1' } })
    expect(await syncSubscription(sub({ status: 'canceled' }))).toEqual({ userId: 'u1', plan: 'free' })
    expect(data().plan).toBe('free')
  })

  it('downgrades when the user has no subscription on file', async () => {
    rows({ byCustomer: { id: 'u1', stripeSubscriptionId: null } })
    expect(await syncSubscription(sub({ id: 'sub_old', status: 'canceled' }))).toEqual({
      userId: 'u1',
      plan: 'free',
    })
  })

  it('lets an active subscription with a new id take over', async () => {
    rows({ byCustomer: { id: 'u1', stripeSubscriptionId: 'sub_old' } })
    expect(await syncSubscription(sub({ id: 'sub_new' }))).toEqual({ userId: 'u1', plan: 'pro' })
    expect(data().stripeSubscriptionId).toBe('sub_new')
  })
})
