import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// In-memory fallback, used when Upstash isn't configured or is down.
// Per-instance and is process-local, so best-effort only.

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now()

  // Cheap memory bound: occasionally drop expired buckets.
  if (buckets.size > 5000) {
    buckets.forEach((b, k) => { if (now > b.resetAt) buckets.delete(k) })
  }

  const b = buckets.get(key)
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, retryAfter: 0 }
  }
  if (b.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) }
  }
  b.count++
  return { ok: true, retryAfter: 0 }
}

export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'unknown'
}

// Upstash sliding window — shared across instances. Activates when the env
// vars are set, otherwise falls back to the in-memory limiter above.

const hasUpstash = !!(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
)
const redis = hasUpstash ? Redis.fromEnv() : null

const LIMITS = {
  login: { n: 10, window: '5 m', ms: 5 * 60_000 },
  signup: { n: 8, window: '60 m', ms: 60 * 60_000 },
  // keyed by userId; well above normal auto-save volume
  save: { n: 60, window: '1 m', ms: 60_000 },
} as const

type Kind = keyof typeof LIMITS

const limiters = redis
  ? (Object.fromEntries(
      (Object.keys(LIMITS) as Kind[]).map((k) => [
        k,
        new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(LIMITS[k].n, LIMITS[k].window),
          prefix: `rl:${k}`,
          analytics: false,
        }),
      ])
    ) as Record<Kind, Ratelimit>)
  : null

export async function limit(
  kind: Kind,
  identifier: string
): Promise<{ ok: boolean; retryAfter: number }> {
  if (limiters) {
    try {
      const { success, reset } = await limiters[kind].limit(identifier)
      return { ok: success, retryAfter: Math.max(0, Math.ceil((reset - Date.now()) / 1000)) }
    } catch {
      // redis down — fall through to in-memory
    }
  }
  const cfg = LIMITS[kind]
  return rateLimit(`${kind}:${identifier}`, cfg.n, cfg.ms)
}
