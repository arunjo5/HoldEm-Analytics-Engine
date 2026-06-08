# PokerLab — Backend

Auth and persistence for PokerLab. Equity is computed client-side in the frontend; this service handles accounts, the saved-hand API, and rate limiting.

## Stack

- Next.js 14 (App Router) + TypeScript
- Auth.js (NextAuth v5): username/password (bcrypt) + optional Google, JWT sessions
- Prisma + PostgreSQL (Neon)
- Upstash Redis for rate limiting (in-memory fallback when unset)

## Setup

```bash
npm install
```

Create `.env.local`:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/pokerlab"
AUTH_SECRET="generate with: openssl rand -base64 32"
AUTH_URL="http://localhost:3000"

# Google sign-in (optional — omit both to run username/password only)
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
```

Then:

```bash
npx prisma migrate dev    # create the schema
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
│   ├── api/searches/             saved-hand list + create
│   ├── api/searches/[id]/        favorite or delete one
│   ├── layout.tsx · page.tsx · providers.tsx · theme.ts
│   └── globals.css
├── components/                   Header, auth (SignInButton, UserMenu), ColorModeToggle
├── contexts/AuthContext.tsx
├── lib/
│   ├── prisma.ts                 Prisma client
│   ├── rateLimit.ts              Upstash + in-memory limiter
│   └── body.ts                   JSON body parsing + input sanitizing
└── types/next-auth.d.ts
```

## API

- `POST /api/auth/signup` — create a username/password account
- `GET /api/searches` — list saved hands
- `POST /api/searches` — save a hand
- `PATCH /api/searches/[id]` — toggle favorite
- `DELETE /api/searches/[id]` — delete a hand

## License

MIT
