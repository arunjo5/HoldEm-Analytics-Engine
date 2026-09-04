# PokerLab — Setup Guide

## Prerequisites

- Node.js 18+
- A PostgreSQL database (e.g. Neon)
- A Google Cloud project — only if you want Google sign-in
- A Stripe account — only if you want the paid Pro plan

## 1. Install

```bash
npm install
```

## 2. Environment variables

Create `.env`:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/pokerlab"

# Auth.js (NextAuth v5)
AUTH_SECRET="your-secret"          # openssl rand -base64 32
AUTH_URL="http://localhost:3000"   # your domain in production

# Google sign-in (optional — omit both to run username/password only)
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# Pro plan via Stripe (optional — see section 6)
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_PRICE_MONTHLY="price_..."
STRIPE_PRICE_YEARLY="price_..."
APP_URL="http://localhost:5173"    # the frontend origin Stripe returns users to
```

Notes:
- Username/password sign-in works with no Google config.
- Locally `AUTH_URL` can be omitted (the app trusts the host); set it to your real domain in production.

## 3. Google OAuth (optional)

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. **APIs & Services → Credentials → Create Credentials → OAuth client ID**, type **Web application**.
3. Add authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google` (dev)
   - `https://yourdomain.com/api/auth/callback/google` (prod)
4. Copy the Client ID and Secret into `.env`.

## 4. Database

```bash
npx prisma db push        # apply the schema (prisma generate runs on install)
```

## 5. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## 6. Stripe billing (optional)

The Pro plan is hidden in the UI until `STRIPE_SECRET_KEY` and both price ids are set.

1. In the [Stripe Dashboard](https://dashboard.stripe.com/) (test mode) create a product **PokerLab Pro** with two recurring prices: monthly and yearly. Copy each price id into `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY`.
2. **Developers → API keys**: copy the secret key into `STRIPE_SECRET_KEY`.
3. **Settings → Billing → Customer portal**: enable cancelling and switching between the two prices, then save.
4. Locally, forward webhooks with the Stripe CLI and copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET`:

   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```

5. Set `APP_URL` to the frontend origin (`http://localhost:5173` in dev).

Test cards: `4242 4242 4242 4242`, any future expiry, any CVC.

## Troubleshooting

- **Invalid redirect URI**: the Google redirect URI must match exactly.
- **Database connection error**: check `DATABASE_URL` and that the database exists.
- **Prisma client not initialized**: run `npx prisma generate`.

## Production

- Use a managed PostgreSQL (Neon) with production env values.
- Set `AUTH_URL` to your production domain and use a strong, unique `AUTH_SECRET`.
- Add the production domain to the Google OAuth redirect URIs.
- Stripe: switch to live keys and prices, set `APP_URL` to the production frontend origin, and register a webhook endpoint at `https://<backend-domain>/api/webhooks/stripe` (events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`) with its signing secret in `STRIPE_WEBHOOK_SECRET`.

## Security

- Never commit `.env`.
- Use strong secrets in production and rotate OAuth credentials periodically.
- API routes are rate-limited (Upstash Redis, with an in-memory fallback).
