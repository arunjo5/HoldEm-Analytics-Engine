import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { syncSubscription } from '@/lib/billing'

// stripe posts here directly, not through the frontend proxy; the signature is the auth
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }
  const sig = request.headers.get('stripe-signature')
  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    // verify against the raw body; any re-serialisation would break the signature
    event = stripe().webhooks.constructEvent(await request.text(), sig, secret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session
        if (s.mode === 'subscription' && s.subscription) {
          const id = typeof s.subscription === 'string' ? s.subscription : s.subscription.id
          const sub = await stripe().subscriptions.retrieve(id)
          await syncSubscription(sub, s.client_reference_id || s.metadata?.userId)
        }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        // re-read so an out-of-order delivery can't roll state backwards
        const sub = await stripe().subscriptions.retrieve((event.data.object as Stripe.Subscription).id)
        await syncSubscription(sub)
        break
      }
      case 'customer.subscription.deleted':
        await syncSubscription(event.data.object as Stripe.Subscription)
        break
    }
  } catch (error) {
    console.error('stripe webhook failed:', event.type, error)
    // a non-2xx makes stripe retry the delivery
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }
  return NextResponse.json({ received: true })
}
