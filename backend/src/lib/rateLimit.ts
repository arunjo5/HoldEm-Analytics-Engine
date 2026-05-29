// Best-effort in-memory rate limiter. NOTE: on serverless this is per-warm-
// instance and is process-local — it throttles casual bursts but is not
// a hard guarantee. Swap for a DB/Upstash limiter if abuse becomes real.

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
