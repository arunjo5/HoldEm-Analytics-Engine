import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'

// past_due stays on pro: stripe retries the card and sends deleted if it gives up
const ACTIVE = new Set(['active', 'trialing', 'past_due'])

// newer api versions keep the period on the item, older ones on the subscription
function periodEnd(sub: Stripe.Subscription): Date | null {
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined
  const end = item?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end
  return typeof end === 'number' ? new Date(end * 1000) : null
}

function interval(sub: Stripe.Subscription): 'month' | 'year' | null {
  const i = sub.items?.data?.[0]?.price?.recurring?.interval
  return i === 'month' ? 'month' : i === 'year' ? 'year' : null
}

// mirror one subscription onto its user. userId is the checkout hint, used
// until the customer id is stored on the row.
export async function syncSubscription(sub: Stripe.Subscription, userId?: string | null) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
  const hint = userId || sub.metadata?.userId || null
  const select = { id: true, stripeSubscriptionId: true }
  const user =
    (customerId ? await prisma.user.findUnique({ where: { stripeCustomerId: customerId }, select }) : null) ??
    (hint ? await prisma.user.findUnique({ where: { id: hint }, select }) : null)
  if (!user) {
    console.warn('stripe: no user for subscription', sub.id)
    return null
  }
  const active = ACTIVE.has(sub.status)
  // an ended subscription that isn't the current one can't downgrade the user
  if (!active && user.stripeSubscriptionId && user.stripeSubscriptionId !== sub.id) {
    return { userId: user.id, plan: 'pro' as const }
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: active ? sub.id : null,
      plan: active ? 'pro' : 'free',
      planInterval: active ? interval(sub) : null,
      planExpiresAt: active ? periodEnd(sub) : null,
    },
  })
  return { userId: user.id, plan: active ? ('pro' as const) : ('free' as const) }
}
