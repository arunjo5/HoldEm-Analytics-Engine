import { describe, it, expect, afterEach, vi } from 'vitest'
import { priceId, billingEnabled, appUrl } from '@/lib/stripe'

// stripe.ts memoises its client at module scope, so those tests import a fresh copy
async function load() {
  vi.resetModules()
  return await import('@/lib/stripe')
}

function req(url: string): Request {
  return { url } as unknown as Request
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('stripe()', () => {
  it('throws when STRIPE_SECRET_KEY is unset', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', undefined)
    const { stripe } = await load()
    expect(() => stripe()).toThrow('STRIPE_SECRET_KEY is not set')
  })

  it('throws on an empty key too', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    const { stripe } = await load()
    expect(() => stripe()).toThrow('STRIPE_SECRET_KEY is not set')
  })

  it('builds a client and reuses the same instance', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x')
    const { stripe } = await load()
    const a = stripe()
    expect(a.checkout.sessions).toBeTruthy()
    expect(stripe()).toBe(a)
  })
})

describe('priceId', () => {
  it('maps each interval to its env price', () => {
    vi.stubEnv('STRIPE_PRICE_MONTHLY', 'price_m')
    vi.stubEnv('STRIPE_PRICE_YEARLY', 'price_y')
    expect(priceId('month')).toBe('price_m')
    expect(priceId('year')).toBe('price_y')
  })

  it('is undefined when the price is not configured', () => {
    vi.stubEnv('STRIPE_PRICE_MONTHLY', undefined)
    vi.stubEnv('STRIPE_PRICE_YEARLY', undefined)
    expect(priceId('month')).toBeUndefined()
    expect(priceId('year')).toBeUndefined()
  })
})

describe('billingEnabled', () => {
  const ENV = ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_MONTHLY', 'STRIPE_PRICE_YEARLY'] as const

  it('needs the key and both prices', () => {
    for (const k of ENV) vi.stubEnv(k, 'set')
    expect(billingEnabled()).toBe(true)
  })

  it.each(ENV)('is false without %s', (missing) => {
    for (const k of ENV) vi.stubEnv(k, k === missing ? undefined : 'set')
    expect(billingEnabled()).toBe(false)
  })

  it('is false when nothing is configured', () => {
    for (const k of ENV) vi.stubEnv(k, undefined)
    expect(billingEnabled()).toBe(false)
  })
})

describe('appUrl', () => {
  it('prefers APP_URL over the request origin', () => {
    vi.stubEnv('APP_URL', 'https://pokerlab.app')
    expect(appUrl(req('https://api.internal/api/billing/checkout'))).toBe('https://pokerlab.app')
  })

  it('strips trailing slashes from APP_URL', () => {
    vi.stubEnv('APP_URL', 'https://pokerlab.app/')
    expect(appUrl(req('https://api.internal/x'))).toBe('https://pokerlab.app')
    vi.stubEnv('APP_URL', 'https://pokerlab.app///')
    expect(appUrl(req('https://api.internal/x'))).toBe('https://pokerlab.app')
  })

  it('falls back to the request origin, dropping path and query', () => {
    vi.stubEnv('APP_URL', undefined)
    expect(appUrl(req('https://pokerlab.app/api/billing/portal?x=1'))).toBe('https://pokerlab.app')
  })

  it('keeps a non-default port from the request origin', () => {
    vi.stubEnv('APP_URL', undefined)
    expect(appUrl(req('http://localhost:3000/api/billing/status'))).toBe('http://localhost:3000')
  })

  it('treats an empty APP_URL as unset', () => {
    vi.stubEnv('APP_URL', '')
    expect(appUrl(req('https://pokerlab.app/api/x'))).toBe('https://pokerlab.app')
  })
})
