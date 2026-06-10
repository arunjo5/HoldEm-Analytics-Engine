import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/rateLimit', () => ({
  limit: vi.fn(async () => ({ ok: true, retryAfter: 0 })),
  getClientIp: vi.fn(() => '1.2.3.4'),
}))

import { POST } from '@/app/api/auth/signup/route'
import { prisma } from '@/lib/prisma'
import { limit } from '@/lib/rateLimit'

const CRED = { ok: 'password123', short: 'short' }

function req(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  const h: Record<string, string> = { 'content-length': String(Buffer.byteLength(json, 'utf8')), ...headers }
  return {
    headers: { get: (k: string) => h[k.toLowerCase()] ?? null },
    text: async () => json,
  } as unknown as Request
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(limit as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, retryAfter: 0 })
  ;(prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  ;(prisma.user.create as ReturnType<typeof vi.fn>).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'u1', ...data }))
})

describe('signup POST', () => {
  it('creates a user for valid input', async () => {
    const res = await POST(req({ username: 'newuser', password: CRED.ok, name: 'New User' }))
    expect(res.status).toBe(200)
    expect(prisma.user.create).toHaveBeenCalledTimes(1)
    expect((prisma.user.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.email).toBe('newuser')
  })

  it('rejects a too-short username', async () => {
    expect((await POST(req({ username: 'ab', password: CRED.ok }))).status).toBe(400)
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it('rejects invalid username characters', async () => {
    expect((await POST(req({ username: 'bad user!', password: CRED.ok }))).status).toBe(400)
  })

  it('rejects a too-short password', async () => {
    expect((await POST(req({ username: 'gooduser', password: CRED.short }))).status).toBe(400)
  })

  it('rejects a duplicate username', async () => {
    ;(prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'existing' })
    expect((await POST(req({ username: 'taken', password: CRED.ok }))).status).toBe(400)
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it('lowercases the username and cleans the display name', async () => {
    const res = await POST(req({ username: 'MixedCase', password: CRED.ok, name: 'Na' + String.fromCharCode(0x200b) + 'me' }))
    expect(res.status).toBe(200)
    const data = (prisma.user.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data
    expect(data.email).toBe('mixedcase')
    expect(data.name).toBe('Name')
  })

  it('returns 429 when rate limited', async () => {
    ;(limit as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, retryAfter: 60 })
    expect((await POST(req({ username: 'gooduser', password: CRED.ok }))).status).toBe(429)
  })
})

describe('signup limiters and boundaries', () => {
  const createData = (i = 0) => (prisma.user.create as ReturnType<typeof vi.fn>).mock.calls[i][0].data

  it('global signupAll limiter returns 429 busy before any db read', async () => {
    ;(limit as ReturnType<typeof vi.fn>).mockImplementation(async (kind: string) =>
      kind === 'signupAll' ? { ok: false, retryAfter: 600 } : { ok: true, retryAfter: 0 }
    )
    const res = await POST(req({ username: 'gooduser', password: CRED.ok }))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('600')
    expect((await res.json()).error).toMatch(/busy/i)
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('per-IP 429 carries the Retry-After header', async () => {
    ;(limit as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, retryAfter: 60 })
    const res = await POST(req({ username: 'gooduser', password: CRED.ok }))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
  })

  it('checks the per-IP limiter first, then the global one, with exact keys', async () => {
    await POST(req({ username: 'gooduser', password: CRED.ok }))
    expect((limit as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ['signup', '1.2.3.4'],
      ['signupAll', 'all'],
    ])
  })

  it('enforces username length boundaries (3–32)', async () => {
    expect((await POST(req({ username: 'a'.repeat(33), password: CRED.ok }))).status).toBe(400)
    expect((await POST(req({ username: 'a'.repeat(3), password: CRED.ok }))).status).toBe(200)
    expect((await POST(req({ username: 'a'.repeat(32), password: CRED.ok }))).status).toBe(200)
  })

  it('enforces password length boundaries (8–200)', async () => {
    expect((await POST(req({ username: 'gooduser', password: 'p'.repeat(201) }))).status).toBe(400)
    expect((await POST(req({ username: 'gooduser', password: 'p'.repeat(8) }))).status).toBe(200)
  })

  it('trims the username before validation and storage', async () => {
    expect((await POST(req({ username: '  spaced  ', password: CRED.ok }))).status).toBe(200)
    expect(createData().email).toBe('spaced')
  })

  it('display name falls back to the username and is capped at 80 chars', async () => {
    await POST(req({ username: 'plainuser', password: CRED.ok }))
    await POST(req({ username: 'capuser', password: CRED.ok, name: 'n'.repeat(100) }))
    expect(createData(0).name).toBe('plainuser')
    expect(createData(1).name).toBe('n'.repeat(80))
  })

  it('500 when create fails', async () => {
    ;(prisma.user.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'))
    expect((await POST(req({ username: 'gooduser', password: CRED.ok }))).status).toBe(500)
  })

  it('success body exposes only id/username/name, never the hash', async () => {
    const res = await POST(req({ username: 'newuser', password: CRED.ok, name: 'New User' }))
    const body = await res.json()
    expect(body).toEqual({ user: { id: 'u1', username: 'newuser', name: 'New User' } })
    expect(JSON.stringify(body)).not.toMatch(/password|\$2[aby]\$/)
  })

  it('cross-site signup is allowed (no sec-fetch-site guard on this route)', async () => {
    expect((await POST(req({ username: 'gooduser', password: CRED.ok }, { 'sec-fetch-site': 'cross-site' }))).status).toBe(200)
  })
})
