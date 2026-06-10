import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { search: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() } },
}))
vi.mock('@/lib/rateLimit', () => ({ limit: vi.fn(async () => ({ ok: true, retryAfter: 0 })) }))

import { PATCH, DELETE } from '@/app/api/searches/[id]/route'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { limit } from '@/lib/rateLimit'

function req(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  const h: Record<string, string> = { 'content-length': String(Buffer.byteLength(json, 'utf8')), ...headers }
  return {
    headers: { get: (k: string) => h[k.toLowerCase()] ?? null },
    text: async () => json,
  } as unknown as Request
}
const ctx = (id: string) => ({ params: { id } })

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: 'user1' } })
  ;(limit as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, retryAfter: 0 })
  ;(prisma.search.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1', userId: 'user1' })
  ;(prisma.search.update as ReturnType<typeof vi.fn>).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 's1', ...data }))
  ;(prisma.search.delete as ReturnType<typeof vi.fn>).mockResolvedValue({})
})

describe('searches [id] PATCH', () => {
  it('401 when unauthenticated', async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await PATCH(req({ favorite: true }) as never, ctx('s1') as never)).status).toBe(401)
  })

  it('403 on a cross-site request', async () => {
    expect((await PATCH(req({ favorite: true }, { 'sec-fetch-site': 'cross-site' }) as never, ctx('s1') as never)).status).toBe(403)
  })

  it('404 for a search the user does not own', async () => {
    ;(prisma.search.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await PATCH(req({ favorite: true }) as never, ctx('other') as never)).status).toBe(404)
    expect(prisma.search.update).not.toHaveBeenCalled()
  })

  it('scopes the ownership check to id AND session user', async () => {
    await PATCH(req({ favorite: true }) as never, ctx('s1') as never)
    expect((prisma.search.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0].where).toEqual({ id: 's1', userId: 'user1' })
  })

  it('updates favorite for an owned search', async () => {
    const res = await PATCH(req({ favorite: true }) as never, ctx('s1') as never)
    expect(res.status).toBe(200)
    expect((prisma.search.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data.favorite).toBe(true)
  })
})

describe('searches [id] DELETE', () => {
  it('401 when unauthenticated', async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await DELETE(req({}) as never, ctx('s1') as never)).status).toBe(401)
  })

  it('403 on a cross-site request', async () => {
    expect((await DELETE(req({}, { 'sec-fetch-site': 'cross-site' }) as never, ctx('s1') as never)).status).toBe(403)
  })

  it('404 for a search the user does not own', async () => {
    ;(prisma.search.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await DELETE(req({}) as never, ctx('other') as never)).status).toBe(404)
    expect(prisma.search.delete).not.toHaveBeenCalled()
  })

  it('deletes an owned search', async () => {
    expect((await DELETE(req({}) as never, ctx('s1') as never)).status).toBe(200)
    expect(prisma.search.delete).toHaveBeenCalledTimes(1)
  })
})

describe('searches [id] PATCH fields', () => {
  const updateArg = () => (prisma.search.update as ReturnType<typeof vi.fn>).mock.calls[0][0]

  it('touch:true writes a fresh lastAccessedAt and nothing else', async () => {
    const before = Date.now()
    expect((await PATCH(req({ touch: true }) as never, ctx('s1') as never)).status).toBe(200)
    const { data } = updateArg()
    expect(Object.keys(data)).toEqual(['lastAccessedAt'])
    expect(data.lastAccessedAt).toBeInstanceOf(Date)
    expect(Math.abs(data.lastAccessedAt.getTime() - before)).toBeLessThan(5000)
  })

  it('touch combines with favorite and name in a single update', async () => {
    expect((await PATCH(req({ touch: true, favorite: false, name: 'renamed' }) as never, ctx('s1') as never)).status).toBe(200)
    const { data } = updateArg()
    expect(Object.keys(data).sort()).toEqual(['favorite', 'lastAccessedAt', 'name'])
    expect(data.favorite).toBe(false)
    expect(data.name).toBe('renamed')
    expect(data.lastAccessedAt).toBeInstanceOf(Date)
  })

  it('only touch === true counts', async () => {
    for (const touch of [false, 'yes', 1]) {
      expect((await PATCH(req({ touch }) as never, ctx('s1') as never)).status).toBe(400)
    }
    expect(prisma.search.update).not.toHaveBeenCalled()
  })

  it('400 on an empty body', async () => {
    const res = await PATCH(req({}) as never, ctx('s1') as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('No valid fields to update')
    expect(prisma.search.update).not.toHaveBeenCalled()
  })

  it('ignores a non-boolean favorite, leaving nothing to update', async () => {
    expect((await PATCH(req({ favorite: 'true' }) as never, ctx('s1') as never)).status).toBe(400)
  })

  it('ignores oversize or non-string names, leaving nothing to update', async () => {
    expect((await PATCH(req({ name: 'x'.repeat(201) }) as never, ctx('s1') as never)).status).toBe(400)
    expect((await PATCH(req({ name: 42 }) as never, ctx('s1') as never)).status).toBe(400)
    expect(prisma.search.update).not.toHaveBeenCalled()
  })

  it('cleans the name on PATCH', async () => {
    await PATCH(req({ name: 'Na' + String.fromCharCode(0x200b) + 'me' }) as never, ctx('s1') as never)
    expect(updateArg().data.name).toBe('Name')
  })

  it('updates by the route param id', async () => {
    await PATCH(req({ favorite: true }) as never, ctx('s9') as never)
    expect(updateArg().where).toEqual({ id: 's9' })
  })
})

describe('searches [id] rate limit and errors', () => {
  it('PATCH 429 with Retry-After before the ownership read', async () => {
    ;(limit as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, retryAfter: 45 })
    const res = await PATCH(req({ favorite: true }) as never, ctx('s1') as never)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('45')
    expect(limit).toHaveBeenCalledWith('save', 'user1')
    expect(prisma.search.findFirst).not.toHaveBeenCalled()
    expect(prisma.search.update).not.toHaveBeenCalled()
  })

  it('DELETE 429 with Retry-After before any delete', async () => {
    ;(limit as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, retryAfter: 45 })
    const res = await DELETE(req({}) as never, ctx('s1') as never)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('45')
    expect(prisma.search.delete).not.toHaveBeenCalled()
  })

  it('DELETE scopes the ownership check to id AND session user', async () => {
    await DELETE(req({}) as never, ctx('s1') as never)
    expect((prisma.search.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0].where).toEqual({ id: 's1', userId: 'user1' })
  })

  it('DELETE deletes by the route param id', async () => {
    await DELETE(req({}) as never, ctx('s7') as never)
    expect(prisma.search.delete).toHaveBeenCalledWith({ where: { id: 's7' } })
  })

  it('PATCH 500 when update fails', async () => {
    ;(prisma.search.update as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'))
    expect((await PATCH(req({ favorite: true }) as never, ctx('s1') as never)).status).toBe(500)
  })

  it('DELETE 500 when delete fails', async () => {
    ;(prisma.search.delete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'))
    expect((await DELETE(req({}) as never, ctx('s1') as never)).status).toBe(500)
  })
})

describe('searches [id] cross-site hardening', () => {
  it('cross-site PATCH and DELETE are rejected before any auth work', async () => {
    expect((await PATCH(req({ favorite: true }, { 'sec-fetch-site': 'cross-site' }) as never, ctx('s1') as never)).status).toBe(403)
    expect((await DELETE(req({}, { 'sec-fetch-site': 'cross-site' }) as never, ctx('s1') as never)).status).toBe(403)
    expect(auth).not.toHaveBeenCalled()
  })

  it('benign sec-fetch-site values pass through', async () => {
    for (const site of ['same-site', 'same-origin']) {
      expect((await PATCH(req({ favorite: true }, { 'sec-fetch-site': site }) as never, ctx('s1') as never)).status).toBe(200)
      expect((await DELETE(req({}, { 'sec-fetch-site': site }) as never, ctx('s1') as never)).status).toBe(200)
    }
  })
})
