# Hold'Em Analytics Engine — Frontend

Texas Hold'em analytics engine with Monte Carlo simulation, range analysis, and pot odds.

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
    ├── replayerEngine.js   betting/positions/frame logic for the replayer
    ├── Replayer.jsx        hand builder + step-through playback
    ├── Cards.jsx           PlayingCard, CardBack, EmptyCardSlot, SuitGlyph
    ├── Pickers.jsx         CardPicker (52-card grid) + RangePicker (13x13)
    └── Seat.jsx            PlayerSeat + RangeMini thumbnail
```
