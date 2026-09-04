import { prisma } from '@/lib/prisma'

export type Plan = 'free' | 'pro'

export const PLAN_LIMITS: Record<Plan, { saveCap: number; shareLinks: number }> = {
  free: { saveCap: 25, shareLinks: 0 },
  // sold as unlimited; the ceilings just bound one account's rows
  pro: { saveCap: 5000, shareLinks: 500 },
}

// a missed renewal webhook shouldn't drop a paying user mid-cycle
const GRACE_MS = 3 * 24 * 60 * 60 * 1000

export function effectivePlan(u: { plan: string | null; planExpiresAt: Date | null }): Plan {
  if (u.plan !== 'pro') return 'free'
  if (u.planExpiresAt && u.planExpiresAt.getTime() + GRACE_MS < Date.now()) return 'free'
  return 'pro'
}

export type PlanInfo = {
  plan: Plan
  interval: 'month' | 'year' | null
  expiresAt: string | null
  saveCap: number
  hasCustomer: boolean
}

export async function getPlan(userId: string): Promise<PlanInfo> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, planInterval: true, planExpiresAt: true, stripeCustomerId: true },
  })
  const plan: Plan = u ? effectivePlan(u) : 'free'
  const interval = u?.planInterval === 'month' || u?.planInterval === 'year' ? u.planInterval : null
  return {
    plan,
    interval: plan === 'pro' ? interval : null,
    expiresAt: plan === 'pro' && u?.planExpiresAt ? u.planExpiresAt.toISOString() : null,
    saveCap: PLAN_LIMITS[plan].saveCap,
    hasCustomer: !!u?.stripeCustomerId,
  }
}
