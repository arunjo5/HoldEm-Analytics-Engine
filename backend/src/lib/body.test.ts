import { describe, it, expect } from 'vitest'
import { cleanName, readJsonBody } from '@/lib/body'

const ZWSP = String.fromCharCode(0x200b)
const RLO = String.fromCharCode(0x202e)
const BELL = String.fromCharCode(0x0007)
const BOM = String.fromCharCode(0xfeff)
const COMBINING_ACUTE = String.fromCharCode(0x0301)
const E_ACUTE = String.fromCharCode(0x00e9)

function mockReq(body: string, contentLength?: string): Request {
  return {
    headers: {
      get: (k: string) =>
        k.toLowerCase() === 'content-length'
          ? contentLength ?? String(Buffer.byteLength(body, 'utf8'))
          : null,
    },
    text: async () => body,
  } as unknown as Request
}

describe('cleanName', () => {
  it('keeps ordinary text unchanged', () => {
    expect(cleanName('John Doe 123')).toBe('John Doe 123')
    expect(cleanName('Hero')).toBe('Hero')
  })

  it('strips zero-width, bidi, and control characters', () => {
    expect(cleanName('He' + ZWSP + 'ro')).toBe('Hero')
    expect(cleanName('A' + RLO + 'B')).toBe('AB')
    expect(cleanName('x' + BELL + 'yz')).toBe('xyz')
    expect(cleanName(BOM + 'name')).toBe('name')
  })

  it('NFC-normalizes combining marks', () => {
    expect(cleanName('e' + COMBINING_ACUTE)).toBe(E_ACUTE)
  })
})

describe('readJsonBody', () => {
  it('parses valid JSON', async () => {
    const r = await readJsonBody(mockReq('{"a":1,"b":"x"}'), 1024)
    expect(r.error).toBeUndefined()
    expect(r.data).toEqual({ a: 1, b: 'x' })
  })

  it('returns {} for an empty body', async () => {
    const r = await readJsonBody(mockReq(''), 1024)
    expect(r.data).toEqual({})
  })

  it('rejects when declared content-length exceeds the cap', async () => {
    const r = await readJsonBody(mockReq('{}', '999999'), 1024)
    expect(r.error).toBeDefined()
  })

  it('rejects oversize by actual byte length, not char count', async () => {
    const body = '"' + 'Z'.repeat(400) + String.fromCharCode(0x2713).repeat(300) + '"'
    expect(body.length).toBeLessThan(1024)
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(1024)
    const r = await readJsonBody(mockReq(body), 1024)
    expect(r.error).toBeDefined()
  })

  it('rejects invalid JSON', async () => {
    const r = await readJsonBody(mockReq('{bad json'), 1024)
    expect(r.error).toBeDefined()
  })
})
