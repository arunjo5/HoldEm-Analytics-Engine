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

function req(body: unknown): Request {
  const json = JSON.stringify(body)
  const h: Record<string, string> = { 'content-length': String(Buffer.byteLength(json, 'utf8')) }
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
    const res = await POST(req({ username: 'newuser', password: 'password123', name: 'New User' }))
    expect(res.status).toBe(200)
    expect(prisma.user.create).toHaveBeenCalledTimes(1)
    expect((prisma.user.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.email).toBe('newuser')
  })

  it('rejects a too-short username', async () => {
    expect((await POST(req({ username: 'ab', password: 'password123' }))).status).toBe(400)
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it('rejects invalid username characters', async () => {
    expect((await POST(req({ username: 'bad user!', password: 'password123' }))).status).toBe(400)
  })

  it('rejects a too-short password', async () => {
    expect((await POST(req({ username: 'gooduser', password: 'short' }))).status).toBe(400)
  })

  it('rejects a duplicate username', async () => {
    ;(prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'existing' })
    expect((await POST(req({ username: 'taken', password: 'password123' }))).status).toBe(400)
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it('lowercases the username and cleans the display name', async () => {
    const res = await POST(req({ username: 'MixedCase', password: 'password123', name: 'Na' + String.fromCharCode(0x200b) + 'me' }))
    expect(res.status).toBe(200)
    const data = (prisma.user.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data
    expect(data.email).toBe('mixedcase')
    expect(data.name).toBe('Name')
  })

  it('returns 429 when rate limited', async () => {
    ;(limit as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, retryAfter: 60 })
    expect((await POST(req({ username: 'gooduser', password: 'password123' }))).status).toBe(429)
  })
})
