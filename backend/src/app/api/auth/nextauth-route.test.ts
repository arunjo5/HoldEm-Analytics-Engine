import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/auth', () => ({
  handlers: { GET: vi.fn(), POST: vi.fn(async () => ({ ok: true })) },
}))
vi.mock('@/lib/rateLimit', () => ({
  limit: vi.fn(async () => ({ ok: true, retryAfter: 0 })),
  getClientIp: vi.fn(() => '1.2.3.4'),
}))

import { GET, POST } from '@/app/api/auth/[...nextauth]/route'
import { handlers } from '@/auth'
import { limit } from '@/lib/rateLimit'

const req = (url: string) =>
  ({ url, headers: { get: () => null } }) as unknown as Request

beforeEach(() => {
  vi.clearAllMocks()
  ;(limit as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, retryAfter: 0 })
})

describe('[...nextauth] login throttle wrapper', () => {
  it('429 with Retry-After on a throttled credentials callback, without reaching next-auth', async () => {
    ;(limit as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, retryAfter: 120 })
    const res = await POST(req('https://app.test/api/auth/callback/credentials') as never)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('120')
    expect(handlers.POST).not.toHaveBeenCalled()
  })

  it('passes the original request through when within limits, keyed on login/ip', async () => {
    const r = req('https://app.test/api/auth/callback/credentials?provider=x')
    const out = await POST(r as never)
    expect(limit).toHaveBeenCalledWith('login', '1.2.3.4')
    expect(handlers.POST).toHaveBeenCalledTimes(1)
    expect((handlers.POST as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(r)
    expect(out).toEqual({ ok: true })
  })

  it('never throttles non-credentials POSTs', async () => {
    await POST(req('https://app.test/api/auth/signout') as never)
    await POST(req('https://app.test/api/auth/callback/google') as never)
    expect(limit).not.toHaveBeenCalled()
    expect(handlers.POST).toHaveBeenCalledTimes(2)
  })

  it('GET is the untouched next-auth handler', () => {
    expect(GET).toBe(handlers.GET)
  })
})
