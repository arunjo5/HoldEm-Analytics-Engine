import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    shareLink: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))
vi.mock('@/lib/rateLimit', () => ({
  limit: vi.fn(async () => ({ ok: true, retryAfter: 0 })),
  getClientIp: vi.fn(() => '1.2.3.4'),
}))

import { GET, PATCH, DELETE } from '@/app/api/share/[code]/route'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { limit, getClientIp } from '@/lib/rateLimit'

const asMock = (f: unknown) => f as ReturnType<typeof vi.fn>
const findUnique = asMock(prisma.shareLink.findUnique)
const update = asMock(prisma.shareLink.update)
const updateMany = asMock(prisma.shareLink.updateMany)
const deleteMany = asMock(prisma.shareLink.deleteMany)

const CODE = 'aB3dEf7h'
const CREATED = new Date('2026-01-15T12:00:00.000Z')
const LINK = { kind: 'scenario', payload: '~N4IgzgpgTgLg', name: 'My spot', createdAt: CREATED }

const ctx = (code = CODE) => ({ params: { code } })

function req(body?: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body ?? {})
  const h: Record<string, string> = { 'content-length': String(Buffer.byteLength(json, 'utf8')), ...headers }
  return {
    headers: { get: (k: string) => h[k.toLowerCase()] ?? null },
    text: vi.fn(async () => json),
  } as unknown as Request
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  asMock(auth).mockResolvedValue({ user: { id: 'user1' } })
  asMock(limit).mockResolvedValue({ ok: true, retryAfter: 0 })
  asMock(getClientIp).mockReturnValue('1.2.3.4')
  findUnique.mockResolvedValue(LINK)
  update.mockResolvedValue({})
  updateMany.mockResolvedValue({ count: 1 })
  deleteMany.mockResolvedValue({ count: 1 })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('share [code] GET resolve', () => {
  it('serves anyone, without a session', async () => {
    asMock(auth).mockResolvedValue(null)
    const res = await GET(req() as never, ctx())
    expect(res.status).toBe(200)
    expect(auth).not.toHaveBeenCalled()
  })

  it('429 with Retry-After, keyed on the caller ip', async () => {
    asMock(limit).mockResolvedValue({ ok: false, retryAfter: 30 })
    const request = req()
    const res = await GET(request as never, ctx())
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(getClientIp).toHaveBeenCalledWith(request)
    expect(limit).toHaveBeenCalledWith('read', 'ip:1.2.3.4')
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('falls back to the unknown-ip bucket', async () => {
    asMock(getClientIp).mockReturnValue('unknown')
    await GET(req() as never, ctx())
    expect(limit).toHaveBeenCalledWith('read', 'ip:unknown')
  })

  it('404 without a lookup when the code is not code-shaped', async () => {
    for (const code of ['', 'abcde', 'a1B2c3D4e5F6g7H8i', 'abc-def', 'abc def', '../../etc/passwd', 'abcd%20ef']) {
      const res = await GET(req() as never, ctx(code))
      expect(res.status).toBe(404)
      expect((await res.json()).error).toBe('Link not found')
    }
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('404 for an unknown code, without bumping views', async () => {
    findUnique.mockResolvedValue(null)
    const res = await GET(req() as never, ctx())
    expect(res.status).toBe(404)
    expect(update).not.toHaveBeenCalled()
  })

  it('reads only the four public columns for that code', async () => {
    await GET(req() as never, ctx())
    expect(findUnique).toHaveBeenCalledWith({
      where: { code: CODE },
      select: { kind: true, payload: true, name: true, createdAt: true },
    })
  })

  it('returns the payload and nothing about the owner', async () => {
    const res = await GET(req() as never, ctx())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ ...LINK, createdAt: CREATED.toISOString() })
    expect(Object.keys(body).sort()).toEqual(['createdAt', 'kind', 'name', 'payload'])
  })

  it('keeps a null name in the body for an unnamed link', async () => {
    findUnique.mockResolvedValue({ ...LINK, name: null })
    expect(await (await GET(req() as never, ctx())).json()).toEqual({
      ...LINK,
      name: null,
      createdAt: CREATED.toISOString(),
    })
  })

  it('bumps the view counter for that code', async () => {
    await GET(req() as never, ctx())
    expect(update).toHaveBeenCalledWith({ where: { code: CODE }, data: { views: { increment: 1 } } })
  })

  it('still serves the link when the view bump fails', async () => {
    update.mockRejectedValue(new Error('db down'))
    const res = await GET(req() as never, ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ...LINK, createdAt: CREATED.toISOString() })
  })

  it('500 when the lookup throws', async () => {
    findUnique.mockRejectedValue(new Error('db down'))
    const res = await GET(req() as never, ctx())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
  })
})

describe('share [code] PATCH rename', () => {
  it('403 on a cross-site request, before any auth work', async () => {
    const res = await PATCH(req({ name: 'x' }, { 'sec-fetch-site': 'cross-site' }) as never, ctx())
    expect(res.status).toBe(403)
    expect(auth).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('401 when unauthenticated', async () => {
    asMock(auth).mockResolvedValue(null)
    expect((await PATCH(req({ name: 'x' }) as never, ctx())).status).toBe(401)
    expect(limit).not.toHaveBeenCalled()
  })

  it('429 with Retry-After on the save bucket', async () => {
    asMock(limit).mockResolvedValue({ ok: false, retryAfter: 5 })
    const res = await PATCH(req({ name: 'x' }) as never, ctx())
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('5')
    expect(limit).toHaveBeenCalledWith('save', 'user1')
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('413 past the 4KB body cap', async () => {
    expect((await PATCH(req({ name: 'x' }, { 'content-length': '5000' }) as never, ctx())).status).toBe(413)
  })

  it('400 on a non-JSON body', async () => {
    const bad = {
      headers: { get: (k: string) => (k.toLowerCase() === 'content-length' ? '5' : null) },
      text: async () => 'nope!',
    } as unknown as Request
    const res = await PATCH(bad as never, ctx())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid JSON')
  })

  it('400 Invalid name when it is missing, not a string or oversize', async () => {
    for (const body of [{}, { name: null }, { name: 42 }, { name: {} }, { name: 'x'.repeat(101) }]) {
      const res = await PATCH(req(body) as never, ctx())
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Invalid name')
    }
    expect(updateMany).not.toHaveBeenCalled()
    expect((await PATCH(req({ name: 'x'.repeat(100) }) as never, ctx())).status).toBe(200)
  })

  it('renames only rows the caller owns', async () => {
    const res = await PATCH(req({ name: '  New na' + String.fromCharCode(0x200b) + 'me  ' }) as never, ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(updateMany).toHaveBeenCalledWith({
      where: { code: CODE, userId: 'user1' },
      data: { name: 'New name' },
    })
  })

  it('clears the name when it is empty or only whitespace', async () => {
    await PATCH(req({ name: '' }) as never, ctx())
    await PATCH(req({ name: '   ' }) as never, ctx())
    await PATCH(req({ name: String.fromCharCode(0x200b) }) as never, ctx())
    for (const call of updateMany.mock.calls) expect(call[0].data.name).toBeNull()
  })

  it('404 when the code belongs to someone else or is gone', async () => {
    updateMany.mockResolvedValue({ count: 0 })
    const res = await PATCH(req({ name: 'x' }) as never, ctx())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Link not found')
  })

  it('lets the scoped update reject a junk code with a 404', async () => {
    updateMany.mockResolvedValue({ count: 0 })
    expect((await PATCH(req({ name: 'x' }) as never, ctx('../../etc'))).status).toBe(404)
    expect(updateMany.mock.calls[0][0].where).toEqual({ code: '../../etc', userId: 'user1' })
  })

  it('500 when the update throws', async () => {
    updateMany.mockRejectedValue(new Error('db down'))
    const res = await PATCH(req({ name: 'x' }) as never, ctx())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
  })
})

describe('share [code] DELETE', () => {
  it('403 on a cross-site request, before any auth work', async () => {
    const res = await DELETE(req(undefined, { 'sec-fetch-site': 'cross-site' }) as never, ctx())
    expect(res.status).toBe(403)
    expect(auth).not.toHaveBeenCalled()
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('401 when unauthenticated', async () => {
    asMock(auth).mockResolvedValue(null)
    expect((await DELETE(req() as never, ctx())).status).toBe(401)
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('429 with Retry-After on the save bucket', async () => {
    asMock(limit).mockResolvedValue({ ok: false, retryAfter: 8 })
    const res = await DELETE(req() as never, ctx())
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('8')
    expect(limit).toHaveBeenCalledWith('save', 'user1')
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('deletes only rows the caller owns', async () => {
    const res = await DELETE(req() as never, ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(deleteMany).toHaveBeenCalledWith({ where: { code: CODE, userId: 'user1' } })
  })

  it('404 when the code belongs to someone else or is gone', async () => {
    deleteMany.mockResolvedValue({ count: 0 })
    const res = await DELETE(req() as never, ctx())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Link not found')
  })

  it('never reads a body', async () => {
    const request = req()
    await DELETE(request as never, ctx())
    expect(request.text).not.toHaveBeenCalled()
  })

  it('500 when the delete throws', async () => {
    deleteMany.mockRejectedValue(new Error('db down'))
    const res = await DELETE(req() as never, ctx())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
  })
})
