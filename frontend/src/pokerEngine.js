export const SUITS = ['s', 'h', 'd', 'c'];
export const VALUES = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
export const RANK = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14 };

const SUIT_INDEX = { s:0, h:1, d:2, c:3 };
const VALUE_INDEX = { '2':0,'3':1,'4':2,'5':3,'6':4,'7':5,'8':6,'9':7,'T':8,'J':9,'Q':10,'K':11,'A':12 };

export function cardToId(c) {
  return VALUE_INDEX[c.v] * 4 + SUIT_INDEX[c.s];
}

export function makeDeck() {
  const d = [];
  for (const v of VALUES) for (const s of SUITS) d.push({ v, s });
  return d;
}

export function expandRangeKey(key) {
  const a = key[0], b = key[1];
  const combos = [];
  if (a === b) {
    for (let i = 0; i < SUITS.length; i++)
      for (let j = i+1; j < SUITS.length; j++)
        combos.push([{v:a,s:SUITS[i]},{v:b,s:SUITS[j]}]);
  } else if (key[2] === 's') {
    for (const s of SUITS) combos.push([{v:a,s},{v:b,s}]);
  } else if (key[2] === 'o') {
    for (let i = 0; i < SUITS.length; i++)
      for (let j = 0; j < SUITS.length; j++)
        if (i !== j) combos.push([{v:a,s:SUITS[i]},{v:b,s:SUITS[j]}]);
  }
  return combos;
}

export function expandRange(keys) {
  const all = [];
  for (const k of keys) all.push(...expandRangeKey(k));
  return all;
}

const MAX_PLAYERS = 9;
const VCOUNT = new Uint8Array(15);
const SCOUNT = new Uint8Array(4);
const SUIT_MASKS = new Uint16Array(4);
const REMAINING = new Uint8Array(52);
const FULL_BOARD = new Uint8Array(5);
const PLAYER_C0 = new Uint8Array(MAX_PLAYERS);
const PLAYER_C1 = new Uint8Array(MAX_PLAYERS);
const PLAYER_IDX = new Int8Array(MAX_PLAYERS);
const SCORES = new Int32Array(MAX_PLAYERS);

export function evaluate7(c0, c1, c2, c3, c4, c5, c6) {
  VCOUNT.fill(0);
  SCOUNT.fill(0);
  SUIT_MASKS.fill(0);

  let r, s;
  r = (c0 >>> 2) + 2; s = c0 & 3; VCOUNT[r]++; SCOUNT[s]++; SUIT_MASKS[s] |= (1 << r);
  r = (c1 >>> 2) + 2; s = c1 & 3; VCOUNT[r]++; SCOUNT[s]++; SUIT_MASKS[s] |= (1 << r);
  r = (c2 >>> 2) + 2; s = c2 & 3; VCOUNT[r]++; SCOUNT[s]++; SUIT_MASKS[s] |= (1 << r);
  r = (c3 >>> 2) + 2; s = c3 & 3; VCOUNT[r]++; SCOUNT[s]++; SUIT_MASKS[s] |= (1 << r);
  r = (c4 >>> 2) + 2; s = c4 & 3; VCOUNT[r]++; SCOUNT[s]++; SUIT_MASKS[s] |= (1 << r);
  r = (c5 >>> 2) + 2; s = c5 & 3; VCOUNT[r]++; SCOUNT[s]++; SUIT_MASKS[s] |= (1 << r);
  r = (c6 >>> 2) + 2; s = c6 & 3; VCOUNT[r]++; SCOUNT[s]++; SUIT_MASKS[s] |= (1 << r);

  let flushSuit = -1;
  for (let i = 0; i < 4; i++) if (SCOUNT[i] >= 5) { flushSuit = i; break; }

  if (flushSuit >= 0) {
    let mask = SUIT_MASKS[flushSuit];
    if (mask & (1 << 14)) mask |= (1 << 1);
    for (let high = 14; high >= 5; high--) {
      const need = 0b11111 << (high - 4);
      if ((mask & need) === need) return (8 << 20) | (high << 16);
    }
  }

  let quad = 0, trip = 0, secondTrip = 0, pair1 = 0, pair2 = 0;
  for (let rr = 14; rr >= 2; rr--) {
    const cc = VCOUNT[rr];
    if (cc === 4) quad = rr;
    else if (cc === 3) {
      if (!trip) trip = rr;
      else if (!secondTrip) secondTrip = rr;
    } else if (cc === 2) {
      if (!pair1) pair1 = rr;
      else if (!pair2) pair2 = rr;
    }
  }

  if (quad) {
    let kicker = 0;
    for (let rr = 14; rr >= 2; rr--) if (rr !== quad && VCOUNT[rr]) { kicker = rr; break; }
    return (7 << 20) | (quad << 16) | (kicker << 12);
  }

  if (trip) {
    let secondary = secondTrip;
    if (pair1 > secondary) secondary = pair1;
    if (secondary) return (6 << 20) | (trip << 16) | (secondary << 12);
  }

  if (flushSuit >= 0) {
    const mask = SUIT_MASKS[flushSuit];
    let result = (5 << 20);
    let count = 0;
    for (let rr = 14; rr >= 2 && count < 5; rr--) {
      if (mask & (1 << rr)) {
        result |= (rr << (16 - count * 4));
        count++;
      }
    }
    return result;
  }

  let rankMask = 0;
  for (let rr = 2; rr <= 14; rr++) if (VCOUNT[rr]) rankMask |= (1 << rr);
  if (rankMask & (1 << 14)) rankMask |= (1 << 1);
  for (let high = 14; high >= 5; high--) {
    const need = 0b11111 << (high - 4);
    if ((rankMask & need) === need) return (4 << 20) | (high << 16);
  }

  if (trip) {
    let k0 = 0, k1 = 0;
    for (let rr = 14; rr >= 2; rr--) {
      if (rr === trip || !VCOUNT[rr]) continue;
      if (!k0) k0 = rr;
      else { k1 = rr; break; }
    }
    return (3 << 20) | (trip << 16) | (k0 << 12) | (k1 << 8);
  }

  if (pair1 && pair2) {
    let kicker = 0;
    for (let rr = 14; rr >= 2; rr--) {
      if (rr === pair1 || rr === pair2 || !VCOUNT[rr]) continue;
      kicker = rr;
      break;
    }
    return (2 << 20) | (pair1 << 16) | (pair2 << 12) | (kicker << 8);
  }

  if (pair1) {
    let k0 = 0, k1 = 0, k2 = 0;
    for (let rr = 14; rr >= 2; rr--) {
      if (rr === pair1 || !VCOUNT[rr]) continue;
      if (!k0) k0 = rr;
      else if (!k1) k1 = rr;
      else { k2 = rr; break; }
    }
    return (1 << 20) | (pair1 << 16) | (k0 << 12) | (k1 << 8) | (k2 << 4);
  }

  let h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0;
  for (let rr = 14; rr >= 2; rr--) {
    if (!VCOUNT[rr]) continue;
    if (!h0) h0 = rr;
    else if (!h1) h1 = rr;
    else if (!h2) h2 = rr;
    else if (!h3) h3 = rr;
    else { h4 = rr; break; }
  }
  return (h0 << 16) | (h1 << 12) | (h2 << 8) | (h3 << 4) | h4;
}

export function simulate(players, board, sims) {
  const active = [];
  for (let idx = 0; idx < players.length; idx++) {
    const p = players[idx];
    if (!p) continue;
    if (p.kind === 'hand' && p.hand && p.hand.length === 2) {
      active.push({ idx, kind: 'hand', c0: cardToId(p.hand[0]), c1: cardToId(p.hand[1]) });
    } else if (p.kind === 'range' && p.range && p.range.length > 0) {
      const combos = expandRange(p.range);
      const flat = new Uint8Array(combos.length * 2);
      for (let i = 0; i < combos.length; i++) {
        flat[i * 2] = cardToId(combos[i][0]);
        flat[i * 2 + 1] = cardToId(combos[i][1]);
      }
      active.push({ idx, kind: 'range', combos: flat, comboCount: combos.length });
    }
  }
  const numActive = active.length;
  if (numActive === 0) return { wins: {}, ties: {}, valid: 0 };

  for (let pi = 0; pi < numActive; pi++) PLAYER_IDX[pi] = active[pi].idx;

  const boardLen = board.length;
  let boardMask0 = 0, boardMask1 = 0;
  for (let i = 0; i < boardLen; i++) {
    const id = cardToId(board[i]);
    FULL_BOARD[i] = id;
    if (id < 32) boardMask0 |= (1 << id);
    else boardMask1 |= (1 << (id - 32));
  }
  const k = 5 - boardLen;

  const wins = {}, ties = {};
  for (let pi = 0; pi < numActive; pi++) {
    wins[active[pi].idx] = 0;
    ties[active[pi].idx] = 0;
  }

  let valid = 0;
  let safety = 0;
  const maxSafety = sims * 50;

  while (valid < sims && safety < maxSafety) {
    safety++;

    let used0 = boardMask0, used1 = boardMask1;
    let ok = 1;

    for (let pi = 0; pi < numActive; pi++) {
      const a = active[pi];
      let c0 = 0, c1 = 0;

      if (a.kind === 'hand') {
        c0 = a.c0; c1 = a.c1;
        const cf0 = c0 < 32 ? (used0 & (1 << c0)) : (used1 & (1 << (c0 - 32)));
        const cf1 = c1 < 32 ? (used0 & (1 << c1)) : (used1 & (1 << (c1 - 32)));
        if (cf0 || cf1) { ok = 0; break; }
      } else {
        const cc = a.comboCount;
        const combos = a.combos;
        let tries = 0, found = 0;
        while (tries < 20) {
          const ci = (Math.random() * cc) | 0;
          const x0 = combos[ci * 2], x1 = combos[ci * 2 + 1];
          const cf0 = x0 < 32 ? (used0 & (1 << x0)) : (used1 & (1 << (x0 - 32)));
          const cf1 = x1 < 32 ? (used0 & (1 << x1)) : (used1 & (1 << (x1 - 32)));
          if (!cf0 && !cf1) { c0 = x0; c1 = x1; found = 1; break; }
          tries++;
        }
        if (!found) { ok = 0; break; }
      }

      if (c0 < 32) used0 |= (1 << c0); else used1 |= (1 << (c0 - 32));
      if (c1 < 32) used0 |= (1 << c1); else used1 |= (1 << (c1 - 32));
      PLAYER_C0[pi] = c0;
      PLAYER_C1[pi] = c1;
    }
    if (!ok) continue;

    let remCount = 0;
    for (let id = 0; id < 32; id++) {
      if (!(used0 & (1 << id))) REMAINING[remCount++] = id;
    }
    for (let id = 32; id < 52; id++) {
      if (!(used1 & (1 << (id - 32)))) REMAINING[remCount++] = id;
    }

    const stop = remCount - k;
    for (let i = remCount - 1; i >= stop; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const tmp = REMAINING[i];
      REMAINING[i] = REMAINING[j];
      REMAINING[j] = tmp;
    }

    for (let i = 0; i < k; i++) FULL_BOARD[boardLen + i] = REMAINING[remCount - 1 - i];

    let best = -1;
    for (let pi = 0; pi < numActive; pi++) {
      const s = evaluate7(
        PLAYER_C0[pi], PLAYER_C1[pi],
        FULL_BOARD[0], FULL_BOARD[1], FULL_BOARD[2], FULL_BOARD[3], FULL_BOARD[4]
      );
      SCORES[pi] = s;
      if (s > best) best = s;
    }

    let winnerCount = 0, singleWinner = -1;
    for (let pi = 0; pi < numActive; pi++) {
      if (SCORES[pi] === best) {
        if (winnerCount === 0) singleWinner = pi;
        winnerCount++;
      }
    }
    if (winnerCount === 1) {
      wins[PLAYER_IDX[singleWinner]]++;
    } else {
      for (let pi = 0; pi < numActive; pi++) {
        if (SCORES[pi] === best) ties[PLAYER_IDX[pi]]++;
      }
    }

    valid++;
  }

  return { wins, ties, valid };
}

export function calculate(players, board, opts = {}) {
  const sims = opts.sims || 100000;
  const { wins, ties, valid } = simulate(players, board, sims);
  const perPlayer = {};
  for (const idx of Object.keys(wins)) {
    perPlayer[idx] = {
      win: valid ? (wins[idx] / valid) * 100 : 0,
      tie: valid ? (ties[idx] / valid) * 100 : 0,
      equity: valid ? ((wins[idx] + ties[idx] * 0.5) / valid) * 100 : 0,
    };
  }
  return { perPlayer, sims: valid };
}
