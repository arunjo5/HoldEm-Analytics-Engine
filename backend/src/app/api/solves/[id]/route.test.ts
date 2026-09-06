import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { savedSolve: { updateMany: vi.fn(), deleteMany: vi.fn() } },
}))
vi.mock('@/lib/rateLimit', () => ({ limit: vi.fn(async () => ({ ok: true, retryAfter: 0 })) }))

import { PATCH, DELETE } from '@/app/api/solves/[id]/route'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { limit } from '@/lib/rateLimit'

const asMock = (f: unknown) => f as ReturnType<typeof vi.fn>
const updateMany = asMock(prisma.savedSolve.updateMany)
const deleteMany = asMock(prisma.savedSolve.deleteMany)

const ID = 's1'
const ZW = String.fromCharCode(0x200b)
const ctx = (id = ID) => ({ params: { id } })

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
  updateMany.mockResolvedValue({ count: 1 })
  deleteMany.mockResolvedValue({ count: 1 })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('solves [id] PATCH', () => {
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
    asMock(limit).mockResolvedValue({ ok: false, retryAfter: 7 })
    const res = await PATCH(req({ name: 'x' }) as never, ctx())
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('7')
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

  it('400 Invalid name when it is missing, wrong-typed, blank or oversize', async () => {
    for (const body of [{}, { name: null }, { name: 42 }, { name: {} }, { name: '' }, { name: '   ' }, { name: ZW }, { name: 'x'.repeat(61) }]) {
      const res = await PATCH(req(body) as never, ctx())
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Invalid name')
    }
    expect(updateMany).not.toHaveBeenCalled()
    expect((await PATCH(req({ name: 'x'.repeat(60) }) as never, ctx())).status).toBe(200)
  })

  it('renames only rows the caller owns, cleaning the name', async () => {
    const res = await PATCH(req({ name: '  New na' + ZW + 'me  ' }) as never, ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(updateMany).toHaveBeenCalledWith({ where: { id: ID, userId: 'user1' }, data: { name: 'New name' } })
  })

  it('ignores everything but the name', async () => {
    await PATCH(req({ name: 'Renamed', config: { board: [] }, summary: { ev: 9 } }) as never, ctx())
    expect(updateMany.mock.calls[0][0].data).toEqual({ name: 'Renamed' })
  })

  it('scopes the update to the id and the session user', async () => {
    await PATCH(req({ name: 'x' }) as never, ctx('someone-elses-id'))
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'someone-elses-id', userId: 'user1' })
  })

  it('404 when the solve belongs to someone else or is gone', async () => {
    updateMany.mockResolvedValue({ count: 0 })
    const res = await PATCH(req({ name: 'x' }) as never, ctx())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Solve not found')
  })

  it('500 when the update throws', async () => {
    updateMany.mockRejectedValue(new Error('db down'))
    const res = await PATCH(req({ name: 'x' }) as never, ctx())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
  })
})

describe('solves [id] DELETE', () => {
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
    asMock(limit).mockResolvedValue({ ok: false, retryAfter: 3 })
    const res = await DELETE(req() as never, ctx())
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('3')
    expect(limit).toHaveBeenCalledWith('save', 'user1')
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('deletes only rows the caller owns', async () => {
    const res = await DELETE(req() as never, ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: ID, userId: 'user1' } })
  })

  it('404 when the solve belongs to someone else or is gone', async () => {
    deleteMany.mockResolvedValue({ count: 0 })
    const res = await DELETE(req() as never, ctx())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Solve not found')
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
