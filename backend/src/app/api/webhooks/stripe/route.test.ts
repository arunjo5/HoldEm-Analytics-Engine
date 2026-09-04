import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Stripe from 'stripe'

// one mock of @/lib/stripe serves both halves of the file: `webhooks` is swapped for
// the real verifier in the signature suite below.
const h = vi.hoisted(() => {
  const constructEvent = vi.fn()
  const fake = { constructEvent }
  return { constructEvent, fake, retrieve: vi.fn(), state: { webhooks: fake as unknown } }
})

vi.mock('@/lib/stripe', () => ({
  stripe: () => ({ webhooks: h.state.webhooks, subscriptions: { retrieve: h.retrieve } }),
}))
vi.mock('@/lib/billing', () => ({ syncSubscription: vi.fn() }))

import { POST } from '@/app/api/webhooks/stripe/route'
import { syncSubscription } from '@/lib/billing'

const asMock = (f: unknown) => f as ReturnType<typeof vi.fn>
const SECRET = 'whsec_test_secret'

function req(body: string, headers: Record<string, string> = { 'stripe-signature': 't=1,v1=sig' }): Request {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => body,
  } as unknown as Request
}

const subPayload = (over: Record<string, unknown> = {}) => ({ id: 'sub_1', status: 'active', ...over })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET)
  h.state.webhooks = h.fake
  h.retrieve.mockResolvedValue(subPayload({ id: 'sub_retrieved' }))
  asMock(syncSubscription).mockResolvedValue({ userId: 'u1', plan: 'pro' })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('stripe webhook gates', () => {
  it('503 without STRIPE_WEBHOOK_SECRET', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', undefined)
    const res = await POST(req('{}') as never)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Webhook not configured' })
    expect(h.constructEvent).not.toHaveBeenCalled()
  })

  it('400 without a stripe-signature header', async () => {
    const res = await POST(req('{}', {}) as never)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Missing signature' })
    expect(h.constructEvent).not.toHaveBeenCalled()
  })

  it('400 when verification throws', async () => {
    h.constructEvent.mockImplementation(() => {
      throw new Error('no match for signature')
    })
    const res = await POST(req('{}') as never)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid signature' })
    expect(syncSubscription).not.toHaveBeenCalled()
  })

  it('verifies the raw body against the header and secret', async () => {
    h.constructEvent.mockReturnValue({ type: 'invoice.paid', data: { object: {} } })
    await POST(req('{"raw":true}', { 'stripe-signature': 'sig-header' }) as never)
    expect(h.constructEvent).toHaveBeenCalledWith('{"raw":true}', 'sig-header', SECRET)
  })
})

describe('stripe webhook checkout.session.completed', () => {
  const event = (session: Record<string, unknown>) => ({
    type: 'checkout.session.completed',
    data: { object: session },
  })

  it('retrieves the subscription and syncs with client_reference_id as the hint', async () => {
    h.constructEvent.mockReturnValue(
      event({ mode: 'subscription', subscription: 'sub_7', client_reference_id: 'u1', metadata: { userId: 'u2' } })
    )
    const res = await POST(req('{}') as never)
    expect(res.status).toBe(200)
    expect(h.retrieve).toHaveBeenCalledWith('sub_7')
    expect(syncSubscription).toHaveBeenCalledWith(subPayload({ id: 'sub_retrieved' }), 'u1')
  })

  it('falls back to metadata.userId when there is no client_reference_id', async () => {
    h.constructEvent.mockReturnValue(
      event({ mode: 'subscription', subscription: 'sub_7', client_reference_id: null, metadata: { userId: 'u2' } })
    )
    await POST(req('{}') as never)
    expect(asMock(syncSubscription).mock.calls[0][1]).toBe('u2')
  })

  it('unwraps an expanded subscription object', async () => {
    h.constructEvent.mockReturnValue(event({ mode: 'subscription', subscription: { id: 'sub_8' } }))
    await POST(req('{}') as never)
    expect(h.retrieve).toHaveBeenCalledWith('sub_8')
  })

  it('ignores one-off payment sessions', async () => {
    h.constructEvent.mockReturnValue(event({ mode: 'payment', subscription: 'sub_7' }))
    const res = await POST(req('{}') as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
    expect(h.retrieve).not.toHaveBeenCalled()
    expect(syncSubscription).not.toHaveBeenCalled()
  })

  it('ignores a subscription session with no subscription attached', async () => {
    h.constructEvent.mockReturnValue(event({ mode: 'subscription', subscription: null }))
    expect((await POST(req('{}') as never)).status).toBe(200)
    expect(syncSubscription).not.toHaveBeenCalled()
  })
})

describe('stripe webhook subscription events', () => {
  it.each(['customer.subscription.created', 'customer.subscription.updated'])(
    're-reads the subscription on %s',
    async (type) => {
      h.constructEvent.mockReturnValue({ type, data: { object: subPayload({ id: 'sub_stale', status: 'canceled' }) } })
      const res = await POST(req('{}') as never)
      expect(res.status).toBe(200)
      expect(h.retrieve).toHaveBeenCalledWith('sub_stale')
      // the freshly retrieved copy is what gets mirrored, not the delivered payload
      expect(syncSubscription).toHaveBeenCalledWith(subPayload({ id: 'sub_retrieved' }))
    }
  )

  it('syncs the delivered payload directly on deleted', async () => {
    const deleted = subPayload({ status: 'canceled' })
    h.constructEvent.mockReturnValue({ type: 'customer.subscription.deleted', data: { object: deleted } })
    const res = await POST(req('{}') as never)
    expect(res.status).toBe(200)
    expect(h.retrieve).not.toHaveBeenCalled()
    expect(syncSubscription).toHaveBeenCalledWith(deleted)
  })

  it('acks unknown events without syncing', async () => {
    h.constructEvent.mockReturnValue({ type: 'invoice.payment_failed', data: { object: {} } })
    const res = await POST(req('{}') as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
    expect(syncSubscription).not.toHaveBeenCalled()
    expect(h.retrieve).not.toHaveBeenCalled()
  })

  it('500 so stripe retries when the handler throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.constructEvent.mockReturnValue({ type: 'customer.subscription.deleted', data: { object: subPayload() } })
    asMock(syncSubscription).mockRejectedValue(new Error('db down'))
    const res = await POST(req('{}') as never)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Handler failed' })
  })

  it('500 when the retrieve throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.constructEvent.mockReturnValue({ type: 'customer.subscription.updated', data: { object: subPayload() } })
    h.retrieve.mockRejectedValue(new Error('stripe down'))
    expect((await POST(req('{}') as never)).status).toBe(500)
  })
})

// the suite above trusts a stubbed verifier; this one runs stripe's real HMAC check
describe('stripe webhook signature verification (real stripe sdk)', () => {
  const real = new Stripe('sk_test_x')
  const payload = JSON.stringify({
    id: 'evt_1',
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_1', status: 'canceled', customer: 'cus_1' } },
  })
  const sign = (body: string, secret: string) => real.webhooks.generateTestHeaderString({ payload: body, secret })

  beforeEach(() => {
    h.state.webhooks = real.webhooks
  })

  it('accepts a correctly signed payload and reaches the handler', async () => {
    const res = await POST(req(payload, { 'stripe-signature': sign(payload, SECRET) }) as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
    expect(syncSubscription).toHaveBeenCalledWith({ id: 'sub_1', status: 'canceled', customer: 'cus_1' })
  })

  it('400 when the body is tampered with after signing', async () => {
    const sig = sign(payload, SECRET)
    const tampered = payload.replace('"status":"canceled"', '"status":"active"')
    const res = await POST(req(tampered, { 'stripe-signature': sig }) as never)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid signature' })
    expect(syncSubscription).not.toHaveBeenCalled()
  })

  it('400 when signed with the wrong secret', async () => {
    const res = await POST(req(payload, { 'stripe-signature': sign(payload, 'whsec_attacker') }) as never)
    expect(res.status).toBe(400)
    expect(syncSubscription).not.toHaveBeenCalled()
  })

  it('400 on a garbage signature header', async () => {
    const res = await POST(req(payload, { 'stripe-signature': 'not-a-signature' }) as never)
    expect(res.status).toBe(400)
    expect(syncSubscription).not.toHaveBeenCalled()
  })
})
