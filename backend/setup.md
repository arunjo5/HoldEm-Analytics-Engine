# PokerLab — Setup Guide

## Prerequisites

- Node.js 18+
- A PostgreSQL database (e.g. Neon)
- A Google Cloud project — only if you want Google sign-in

## 1. Install

```bash
npm install
```

## 2. Environment variables

Create `.env.local`:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/pokerlab"

# Auth.js (NextAuth v5)
AUTH_SECRET="your-secret"          # openssl rand -base64 32
AUTH_URL="http://localhost:3000"   # your domain in production

# Google sign-in (optional — omit both to run username/password only)
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
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
4. Copy the Client ID and Secret into `.env.local`.

## 4. Database

```bash
npx prisma migrate dev    # apply the schema (prisma generate runs on install)
```

## 5. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Troubleshooting

- **Invalid redirect URI**: the Google redirect URI must match exactly.
- **Database connection error**: check `DATABASE_URL` and that the database exists.
- **Prisma client not initialized**: run `npx prisma generate`.

## Production

- Use a managed PostgreSQL (Neon) with production env values.
- Set `AUTH_URL` to your production domain and use a strong, unique `AUTH_SECRET`.
- Add the production domain to the Google OAuth redirect URIs.

## Security

- Never commit `.env.local`.
- Use strong secrets in production and rotate OAuth credentials periodically.
- API routes are rate-limited (Upstash Redis, with an in-memory fallback).
