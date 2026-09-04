import Stripe from 'stripe'

let client: Stripe | null = null

export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  if (!client) client = new Stripe(key)
  return client
}

export type Interval = 'month' | 'year'

export function priceId(interval: Interval): string | undefined {
  return interval === 'year' ? process.env.STRIPE_PRICE_YEARLY : process.env.STRIPE_PRICE_MONTHLY
}

export function billingEnabled(): boolean {
  return !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_MONTHLY && process.env.STRIPE_PRICE_YEARLY)
}

// where checkout/portal send the user back: APP_URL, else the request origin
export function appUrl(request: Request): string {
  const base = process.env.APP_URL || new URL(request.url).origin
  return base.replace(/\/+$/, '')
}
