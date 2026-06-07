import { describe, it, expect } from 'vitest'
import { getClientIp } from '@/lib/rateLimit'

function req(headers: Record<string, string>): Request {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as Request
}

describe('getClientIp', () => {
  it('prefers the platform x-real-ip over x-forwarded-for', () => {
    expect(
      getClientIp(req({ 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }))
    ).toBe('9.9.9.9')
  })

  it('falls back to the first x-forwarded-for entry when no x-real-ip', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }))).toBe('1.1.1.1')
  })

  it('trims surrounding whitespace', () => {
    expect(getClientIp(req({ 'x-real-ip': '  5.5.5.5  ' }))).toBe('5.5.5.5')
  })

  it('returns "unknown" when no ip headers are present', () => {
    expect(getClientIp(req({}))).toBe('unknown')
  })
})
