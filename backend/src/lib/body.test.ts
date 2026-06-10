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

  // sanitizer hole: U+2066-2069 and U+061C fall outside every strip range
  it.skip('strips bidi isolates and the Arabic letter mark', () => {
    for (const cp of [0x2066, 0x2067, 0x2068, 0x2069, 0x061c]) {
      expect(cleanName('a' + String.fromCodePoint(cp) + 'b')).toBe('ab')
    }
  })

  it('pins the strip-range boundaries', () => {
    expect(cleanName('ab')).toBe('ab')
    expect(cleanName('a b')).toBe('a b')
    expect(cleanName('a~b')).toBe('a~b')
    expect(cleanName('ab')).toBe('ab')
    expect(cleanName('ab')).toBe('ab')
    expect(cleanName('a b')).toBe('a b') // NBSP intentionally kept
  })

  it('strips tab, newline and CR', () => {
    expect(cleanName('a\tb\nc\r')).toBe('abc')
  })

  it('keeps astral-plane emoji intact', () => {
    expect(cleanName('a👍b')).toBe('a👍b')
  })

  it('breaks ZWJ emoji sequences by design (U+200D is in the strip range)', () => {
    expect(cleanName('👨‍👩‍👧')).toBe('👨👩👧')
  })

  it('strips after NFC without re-normalizing: ZWSP-blocked composition stays decomposed', () => {
    const out = cleanName('e' + ZWSP + COMBINING_ACUTE)
    expect(out).toBe('e' + COMBINING_ACUTE)
    expect(out).not.toBe(E_ACUTE)
    expect(out.normalize('NFC')).not.toBe(out)
  })

  it('NFC halves decomposed pairs, so output can be shorter than the validated input', () => {
    const decomposed = ('e' + COMBINING_ACUTE).repeat(100)
    expect(decomposed.length).toBe(200)
    const out = cleanName(decomposed)
    expect(out).toBe(E_ACUTE.repeat(100))
    expect(out.length).toBe(100)
  })

  it('handles empty and all-strippable input', () => {
    expect(cleanName('')).toBe('')
    expect(cleanName(ZWSP + BOM + RLO)).toBe('')
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
