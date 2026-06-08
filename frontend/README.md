# PokerLab — Frontend

Texas Hold'em analytics: Monte Carlo equity, range analysis, pot odds/MDF, and a hand replayer.

## Stack

- Vite + React 18 (JavaScript)
- The poker engine runs in-browser (Monte Carlo in a Web Worker). Accounts and saved hands talk to the backend over `/api`.

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

`npm run lint` (ESLint) and `npm run test` (Vitest) cover linting and tests.

## Project structure

```
frontend/
├── index.html              entry HTML, loads /src/main.jsx
├── vite.config.js
└── src/
    ├── main.jsx            ReactDOM.createRoot
    ├── App.jsx             top-level layout, state, modals
    ├── styles.css          all styles (dark + light via .light class)
    ├── pokerEngine.js      deck, 7-card evaluator, Monte Carlo equity
    ├── equityWorker.js     runs the simulation off the main thread
    ├── replayerEngine.js   betting/positions/frame logic
    ├── Replayer.jsx        hand replayer + step-through playback
    ├── pokernowImport.js   parse PokerNow exports into replayable hands
    ├── scenario.js         scenario <-> URL state
    ├── shareCodec.js       compact share-link encoding (lz-string)
    ├── replayShare.js      share encoding for replays
    ├── Cards.jsx           card chips and glyphs
    ├── Pickers.jsx         CardPicker (52-card grid) + RangePicker (13x13)
    ├── Seat.jsx            PlayerSeat + range thumbnail
    ├── HistoryDrawer.jsx   saved-hand history panel
    ├── ShareModal.jsx      share-link modal
    ├── UploadModal.jsx     PokerNow log import
    └── AuthContext.jsx     session state from the backend
```
