# Equity Engine, Frontend

Texas Hold'em equity calculator with Monte Carlo simulation, range analysis, and pot odds.

## Stack

- Vite + React 18
- No backend dependencies. The poker engine runs entirely in-browser.

## Run locally

```bash
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173.

## Build for production

```bash
npm run build      # outputs to dist/
npm run preview    # serves the production build locally
```

## Project structure

```
frontend/
├── index.html              entry HTML, loads /src/main.jsx
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx            ReactDOM.createRoot
    ├── App.jsx             top-level layout, state, picker modals
    ├── styles.css          all styles (dark + light themes via .light class)
    ├── pokerEngine.js      deck, 7-card evaluator, Monte Carlo equity
    ├── Cards.jsx           PlayingCard, CardBack, EmptyCardSlot, SuitGlyph
    ├── Pickers.jsx         CardPicker (52-card grid) + RangePicker (13x13)
    └── Seat.jsx            PlayerSeat + RangeMini thumbnail
```

## Adding authentication later

The current app is fully client-side. Options for adding user accounts and persistence:

- Supabase: drop-in OAuth (Google, GitHub, etc.) plus a Postgres database with row-level security.
- Clerk or Auth0: if you only need auth, not a database.
- Storing user hand histories or saved ranges would live behind a `/api/*` route. Vercel / Netlify edge functions or a small Node service both work.
