import { createHash, randomBytes } from 'crypto'

export type ShareKind = 'scenario' | 'replay'

// same charset as the #s= / #r= link payloads
const PAYLOAD_RE = /^[A-Za-z0-9~+\-_$=.]+$/
const MAX_PAYLOAD: Record<ShareKind, number> = { scenario: 16384, replay: 49152 }
export const MAX_LINK_NAME = 100
export const CODE_RE = /^[A-Za-z0-9]{6,16}$/

export function isShareKind(k: unknown): k is ShareKind {
  return k === 'scenario' || k === 'replay'
}

export function validPayload(kind: ShareKind, payload: unknown): payload is string {
  return typeof payload === 'string' && payload.length > 0 && payload.length <= MAX_PAYLOAD[kind] && PAYLOAD_RE.test(payload)
}

export function payloadHash(kind: ShareKind, payload: string): string {
  return createHash('sha256').update(kind + ':' + payload).digest('hex')
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

// unguessable, not secret
export function newCode(len = 8): string {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

export const linkSelect = { code: true, kind: true, name: true, views: true, createdAt: true } as const
