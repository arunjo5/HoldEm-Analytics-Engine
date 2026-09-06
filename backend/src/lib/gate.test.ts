import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({ limit: vi.fn(async () => ({ ok: true, retryAfter: 0 })) }))

import { userGate } from '@/lib/gate'
import { auth } from '@/auth'
import { limit } from '@/lib/rateLimit'

const asMock = (f: unknown) => f as ReturnType<typeof vi.fn>

function req(headers: Record<string, string> = {}) {
  return { headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  asMock(auth).mockResolvedValue({ user: { id: 'user1' } })
  asMock(limit).mockResolvedValue({ ok: true, retryAfter: 0 })
})

describe('userGate csrf', () => {
  it('403 Forbidden on a cross-site request', async () => {
    const gate = await userGate(req({ 'sec-fetch-site': 'cross-site' }), 'save')
    expect(gate.error?.status).toBe(403)
    expect(await gate.error?.json()).toEqual({ error: 'Forbidden' })
    expect(gate.userId).toBeUndefined()
  })

  it('checks the header before it does any auth or rate-limit work', async () => {
    await userGate(req({ 'sec-fetch-site': 'cross-site' }), 'save')
    expect(auth).not.toHaveBeenCalled()
    expect(limit).not.toHaveBeenCalled()
  })

  it('lets benign sec-fetch-site values and a missing header through', async () => {
    for (const site of ['same-origin', 'same-site', 'none']) {
      expect((await userGate(req({ 'sec-fetch-site': site }), 'save')).userId).toBe('user1')
    }
    expect((await userGate(req(), 'save')).userId).toBe('user1')
  })
})

describe('userGate session', () => {
  it('401 when there is no session at all', async () => {
    asMock(auth).mockResolvedValue(null)
    const gate = await userGate(req(), 'save')
    expect(gate.error?.status).toBe(401)
    expect(await gate.error?.json()).toEqual({ error: 'Unauthorized' })
  })

  it('401 when the session carries no user id', async () => {
    for (const session of [{}, { user: null }, { user: {} }, { user: { id: '' } }]) {
      asMock(auth).mockResolvedValue(session)
      expect((await userGate(req(), 'save')).error?.status).toBe(401)
    }
  })

  it('checks the session before the rate limit', async () => {
    asMock(auth).mockResolvedValue(null)
    await userGate(req(), 'save')
    expect(limit).not.toHaveBeenCalled()
  })
})

describe('userGate rate limit', () => {
  it('429 with Retry-After from the limiter', async () => {
    asMock(limit).mockResolvedValue({ ok: false, retryAfter: 42 })
    const gate = await userGate(req(), 'save')
    expect(gate.error?.status).toBe(429)
    expect(gate.error?.headers.get('Retry-After')).toBe('42')
    expect(await gate.error?.json()).toEqual({ error: 'Too many requests' })
    expect(gate.userId).toBeUndefined()
  })

  it('keys the bucket on the session user, under the kind it was given', async () => {
    for (const kind of ['save', 'read', 'share', 'billing'] as const) {
      await userGate(req(), kind)
      expect(limit).toHaveBeenLastCalledWith(kind, 'user1')
    }
  })
})

describe('userGate pass', () => {
  it('hands back the session user id and no error', async () => {
    asMock(auth).mockResolvedValue({ user: { id: 'other-user' } })
    const gate = await userGate(req({ 'sec-fetch-site': 'same-origin' }), 'save')
    expect(gate).toEqual({ userId: 'other-user' })
  })
})
