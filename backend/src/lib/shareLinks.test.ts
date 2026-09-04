import { describe, it, expect, beforeEach, vi } from 'vitest'

// keep the real sha256, but let a test pin the bytes newCode draws
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>()
  return { ...actual, randomBytes: vi.fn(actual.randomBytes) }
})

import { randomBytes } from 'crypto'
import {
  isShareKind,
  validPayload,
  payloadHash,
  newCode,
  CODE_RE,
  MAX_LINK_NAME,
  linkSelect,
} from '@/lib/shareLinks'

const rb = randomBytes as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isShareKind', () => {
  it('accepts the two kinds', () => {
    expect(isShareKind('scenario')).toBe(true)
    expect(isShareKind('replay')).toBe(true)
  })

  it('rejects anything else', () => {
    for (const k of ['Scenario', 'REPLAY', 'spot', '', ' scenario', 'scenario ', null, undefined, 0, 1, {}, ['replay']]) {
      expect(isShareKind(k)).toBe(false)
    }
  })
})

describe('validPayload', () => {
  it('accepts the lz-string envelope and legacy base64url shapes', () => {
    expect(validPayload('scenario', '~N4IgzgpgTgLg')).toBe(true)
    expect(validPayload('replay', '~N4IgzgpgTgLg')).toBe(true)
    expect(validPayload('scenario', 'eyJhIjoxfQ==')).toBe(true)
    expect(validPayload('scenario', 'a-b_c.d+e$f=g~9')).toBe(true)
    expect(validPayload('scenario', 'A')).toBe(true)
  })

  it('rejects an empty string and non-strings', () => {
    expect(validPayload('scenario', '')).toBe(false)
    for (const p of [null, undefined, 42, {}, ['abc'], true]) {
      expect(validPayload('scenario', p)).toBe(false)
    }
  })

  it('rejects characters outside the charset', () => {
    for (const bad of ['ab c', 'a#b', 'a<b', 'a/b', 'a%b', 'a\\b', 'a"b', 'a\tb', 'a\nb', 'abc\n', 'a\u200bb', 'a🙂b', '{}']) {
      expect(validPayload('scenario', bad)).toBe(false)
    }
  })

  it('takes a scenario payload of exactly 16384 chars but not one more', () => {
    expect(validPayload('scenario', 'a'.repeat(16384))).toBe(true)
    expect(validPayload('scenario', 'a'.repeat(16385))).toBe(false)
  })

  it('takes a replay payload of exactly 49152 chars but not one more', () => {
    expect(validPayload('replay', 'a'.repeat(49152))).toBe(true)
    expect(validPayload('replay', 'a'.repeat(49153))).toBe(false)
  })

  it('sizes the cap per kind', () => {
    const mid = 'a'.repeat(20000)
    expect(validPayload('scenario', mid)).toBe(false)
    expect(validPayload('replay', mid)).toBe(true)
  })
})

describe('payloadHash', () => {
  it('is a stable sha256 of kind + ":" + payload', () => {
    expect(payloadHash('scenario', 'abc')).toBe('cadca634dbda7afa5dcb740c55cbadebded57f0facff4db0071b7477a83dca34')
    expect(payloadHash('replay', 'abc')).toBe('b4e900ae9aef31f364275a6572071c1927b73b50fa6e3f5bad427ea5d86c0d2f')
  })

  it('repeats itself for the same input', () => {
    expect(payloadHash('scenario', '~N4Igzg')).toBe(payloadHash('scenario', '~N4Igzg'))
  })

  it('separates the two kinds', () => {
    expect(payloadHash('scenario', '~N4Igzg')).not.toBe(payloadHash('replay', '~N4Igzg'))
  })

  it('changes on a one-character payload edit', () => {
    expect(payloadHash('scenario', 'abc')).not.toBe(payloadHash('scenario', 'abd'))
  })

  it('is 64 lowercase hex chars', () => {
    expect(payloadHash('replay', 'abc')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('newCode', () => {
  it('defaults to 8 base62 chars that CODE_RE accepts', () => {
    const code = newCode()
    expect(code).toHaveLength(8)
    expect(code).toMatch(/^[A-Za-z0-9]{8}$/)
    expect(CODE_RE.test(code)).toBe(true)
  })

  it('honours an explicit length and draws one byte per char', () => {
    for (const len of [6, 12, 16]) {
      rb.mockClear()
      const code = newCode(len)
      expect(code).toHaveLength(len)
      expect(code).toMatch(/^[A-Za-z0-9]+$/)
      expect(rb).toHaveBeenCalledWith(len)
    }
  })

  it('maps each byte through the alphabet, wrapping past 61', () => {
    rb.mockReturnValueOnce(Buffer.from([0, 1, 25, 26, 51, 52, 61, 62]))
    expect(newCode()).toBe('ABZaz09A')
    rb.mockReturnValueOnce(Buffer.from([255, 124, 63, 0, 0, 0]))
    expect(newCode(6)).toBe('HABAAA')
  })

  it('draws fresh randomness on every call', () => {
    const codes = new Set(Array.from({ length: 200 }, () => newCode()))
    expect(codes.size).toBe(200)
  })
})

describe('CODE_RE', () => {
  it('accepts 6 to 16 alphanumerics', () => {
    for (const c of ['abcdef', 'ABCDEF', '123456', 'aB3dEf7h', 'a1B2c3D4e5F6g7H8']) {
      expect(CODE_RE.test(c)).toBe(true)
    }
  })

  it('rejects the wrong length, punctuation and whitespace', () => {
    for (const c of ['', 'abcde', 'a1B2c3D4e5F6g7H8i', 'abc-def', 'abc_def', 'abc def', 'abcde.', 'abcdef\n', '../../etc', 'abcdéf']) {
      expect(CODE_RE.test(c)).toBe(false)
    }
  })
})

describe('link constants', () => {
  it('caps names at 100 chars', () => {
    expect(MAX_LINK_NAME).toBe(100)
  })

  it('selects only the columns a link owner needs', () => {
    expect(linkSelect).toEqual({ code: true, kind: true, name: true, views: true, createdAt: true })
  })

  it('never selects the payload or anything identifying', () => {
    for (const col of ['payload', 'payloadHash', 'userId', 'id', 'user']) {
      expect(Object.keys(linkSelect)).not.toContain(col)
    }
  })
})
