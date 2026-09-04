# PokerLab — Backend

Auth and persistence for PokerLab. Equity is computed client-side in the frontend; this service handles accounts, the saved-hand API (LRU-capped per user, by plan), Pro billing, and rate limiting.

## Stack

- Next.js 14 (App Router) + TypeScript
- Auth.js (NextAuth v5): username/password (bcrypt) + optional Google, JWT sessions
- Prisma + PostgreSQL (Neon)
- Upstash Redis for rate limiting (in-memory fallback when unset)
- Stripe Checkout, Customer Portal, and webhooks for the Pro plan (optional)

## Setup

```bash
npm install
```

Create `.env`:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/pokerlab"
AUTH_SECRET="generate with: openssl rand -base64 32"
AUTH_URL="http://localhost:3000"

# Google sign-in (optional — omit both to run username/password only)
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""

# Pro plan via Stripe (optional — Pro stays hidden in the UI until all four are set)
STRIPE_SECRET_KEY=""
STRIPE_WEBHOOK_SECRET=""
STRIPE_PRICE_MONTHLY=""
STRIPE_PRICE_YEARLY=""
APP_URL="http://localhost:5173"   # where Stripe sends users back
```

Then:

```bash
npx prisma db push        # create the schema
npm run dev               # http://localhost:3000
```

See [setup.md](./setup.md) for the full auth/DB walkthrough (Google OAuth, Neon, production).

## Scripts

- `npm run dev` / `npm run build` / `npm run start`
- `npm run lint` — next lint
- `npm run test` — Vitest

## Structure

```
src/
├── auth.ts                       Auth.js config (Credentials + Google, JWT)
├── app/
│   ├── api/auth/[...nextauth]/   NextAuth handlers
│   ├── api/auth/signup/          username/password signup
│   ├── api/searches/             saved-hand list + create (LRU-capped)
│   ├── api/searches/[id]/        favorite, rename, touch, or delete one
│   ├── api/billing/              status, Stripe Checkout + Customer Portal sessions
│   ├── api/webhooks/stripe/      signed webhook that mirrors subscriptions onto users
│   ├── layout.tsx · page.tsx · providers.tsx · theme.ts
│   └── globals.css
├── components/                   Header, auth (SignInButton, UserMenu), ColorModeToggle
├── contexts/AuthContext.tsx
├── lib/
│   ├── prisma.ts                 Prisma client
│   ├── rateLimit.ts              Upstash + in-memory limiter
│   ├── body.ts                   JSON body parsing + input sanitizing
│   ├── plan.ts                   plan limits + effective plan lookup
│   ├── stripe.ts                 Stripe client, price ids, return URL
│   └── billing.ts                subscription → user sync used by the webhook
└── types/next-auth.d.ts
```

## API

- `POST /api/auth/signup` — create a username/password account
- `GET /api/searches` — list saved hands
- `POST /api/searches` — save a hand (prunes least-recently-used non-favorites past the per-user cap)
- `PATCH /api/searches/[id]` — toggle favorite, rename, or touch (mark recently used)
- `DELETE /api/searches/[id]` — delete a hand
- `GET /api/billing/status` — current plan, save cap, and usage
- `POST /api/billing/checkout` — start a Stripe Checkout session (`{ interval: "month" | "year" }`)
- `POST /api/billing/portal` — open the Stripe Customer Portal
- `POST /api/webhooks/stripe` — Stripe webhook (signature-verified)

## License

MIT
