import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const h = vi.hoisted(() => ({ portalCreate: vi.fn() }))

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }))
vi.mock('@/lib/rateLimit', () => ({ limit: vi.fn(async () => ({ ok: true, retryAfter: 0 })) }))
vi.mock('@/lib/stripe', () => ({
  stripe: () => ({ billingPortal: { sessions: { create: h.portalCreate } } }),
  appUrl: vi.fn(),
}))

import { POST } from '@/app/api/billing/portal/route'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { limit } from '@/lib/rateLimit'
import { appUrl } from '@/lib/stripe'

const asMock = (f: unknown) => f as ReturnType<typeof vi.fn>
const findUnique = asMock(prisma.user.findUnique)

function req(headers: Record<string, string> = {}): Request {
  return { headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as unknown as Request
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x')
  asMock(auth).mockResolvedValue({ user: { id: 'user1' } })
  asMock(limit).mockResolvedValue({ ok: true, retryAfter: 0 })
  asMock(appUrl).mockReturnValue('https://pokerlab.app')
  findUnique.mockResolvedValue({ stripeCustomerId: 'cus_1' })
  h.portalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/x' })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('portal POST gates', () => {
  it('403 on a cross-site request, before any auth work', async () => {
    const res = await POST(req({ 'sec-fetch-site': 'cross-site' }) as never)
    expect(res.status).toBe(403)
    expect(auth).not.toHaveBeenCalled()
    expect(h.portalCreate).not.toHaveBeenCalled()
  })

  it('401 when unauthenticated', async () => {
    asMock(auth).mockResolvedValue(null)
    expect((await POST(req() as never)).status).toBe(401)
    expect(limit).not.toHaveBeenCalled()
  })

  it('429 with Retry-After on the billing bucket', async () => {
    asMock(limit).mockResolvedValue({ ok: false, retryAfter: 17 })
    const res = await POST(req() as never)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('17')
    expect(limit).toHaveBeenCalledWith('billing', 'user1')
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('503 without a stripe secret key', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', undefined)
    const res = await POST(req() as never)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Billing is not configured' })
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('400 when the user has never checked out', async () => {
    findUnique.mockResolvedValue({ stripeCustomerId: null })
    const res = await POST(req() as never)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'No billing account yet' })
    expect(h.portalCreate).not.toHaveBeenCalled()
  })

  it('400 when the row is gone', async () => {
    findUnique.mockResolvedValue(null)
    expect((await POST(req() as never)).status).toBe(400)
  })
})

describe('portal POST session', () => {
  it('opens the portal for the session user and returns its url', async () => {
    const res = await POST(req() as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://billing.stripe.com/p/session/x' })
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'user1' }, select: { stripeCustomerId: true } })
    expect(h.portalCreate).toHaveBeenCalledWith({
      customer: 'cus_1',
      return_url: 'https://pokerlab.app/',
    })
  })

  it('builds the return url off appUrl', async () => {
    asMock(appUrl).mockReturnValue('http://localhost:5173')
    await POST(req() as never)
    expect(h.portalCreate.mock.calls[0][0].return_url).toBe('http://localhost:5173/')
  })

  it('500 when the portal call throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.portalCreate.mockRejectedValue(new Error('stripe down'))
    const res = await POST(req() as never)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
  })

  it('500 when the user lookup throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    findUnique.mockRejectedValue(new Error('db down'))
    expect((await POST(req() as never)).status).toBe(500)
  })
})
