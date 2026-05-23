## Poker Odds Calculator
#### https://hold-em-calculator.vercel.app/
#### Calculates the win probabilites of players given their cards and/or the community cards

<img width="1287" height="717" alt="Screenshot 2025-07-28 at 2 16 54 PM" src="https://github.com/user-attachments/assets/3bb7a7bb-590c-422f-ae0b-ba9fa88cb93a" />

## Repo layout

```
.
├── frontend/   Vite + React app (the calculator UI)
└── backend/    Next.js app — NextAuth + Prisma (API, auth, DB)
```

## Quick start

```bash
# Frontend (Vite + React)
cd frontend
npm install
npm run dev          # http://localhost:5173

# Backend (Next.js, NextAuth, Prisma)
cd backend
npm install
npm run dev          # http://localhost:3000
```

See [`frontend/README.md`](./frontend/README.md) and [`backend/README.md`](./backend/README.md) for details, and [`backend/setup.md`](./backend/setup.md) for the auth/DB setup walkthrough.
