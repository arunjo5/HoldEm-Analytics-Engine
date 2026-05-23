// Poker engine: deck, 7-card hand evaluation, Monte Carlo equity.

export const SUITS = ['s', 'h', 'd', 'c'];
export const VALUES = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
export const RANK = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14 };

function cardId(c) { return c.v + c.s; }

export function makeDeck() {
  const d = [];
  for (const v of VALUES) for (const s of SUITS) d.push({ v, s });
  return d;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Evaluate up to 7 cards into an integer score (higher wins).
// Layout: rank(4 bits) << 20 | tiebreakers.
function evaluate(cards) {
  const vcount = new Array(15).fill(0);
  const scount = { s:0,h:0,d:0,c:0 };
  const sCards = { s:[],h:[],d:[],c:[] };
  for (const c of cards) {
    const r = RANK[c.v];
    vcount[r]++;
    scount[c.s]++;
    sCards[c.s].push(r);
  }
  let flushSuit = null;
  for (const s of SUITS) if (scount[s] >= 5) { flushSuit = s; break; }
  if (flushSuit) {
    const ranks = [...new Set(sCards[flushSuit])].sort((a,b)=>b-a);
    if (ranks.includes(14)) ranks.push(1); // wheel
    for (let i = 0; i <= ranks.length - 5; i++) {
      if (ranks[i] - ranks[i+4] === 4) return (8 << 20) | (ranks[i] << 16);
    }
  }
  const groups = [];
  for (let r = 14; r >= 2; r--) if (vcount[r]) groups.push([vcount[r], r]);
  groups.sort((a,b)=> b[0]-a[0] || b[1]-a[1]);
  if (groups[0][0] === 4) {
    const quad = groups[0][1];
    let kicker = 0;
    for (let r = 14; r >= 2; r--) if (r !== quad && vcount[r]) { kicker = r; break; }
    return (7 << 20) | (quad << 16) | (kicker << 12);
  }
  if (groups[0][0] === 3 && groups[1] && groups[1][0] >= 2) {
    return (6 << 20) | (groups[0][1] << 16) | (groups[1][1] << 12);
  }
  if (flushSuit) {
    const top = sCards[flushSuit].sort((a,b)=>b-a).slice(0,5);
    return (5 << 20) | (top[0]<<16) | (top[1]<<12) | (top[2]<<8) | (top[3]<<4) | top[4];
  }
  const distinct = [];
  for (let r = 14; r >= 2; r--) if (vcount[r]) distinct.push(r);
  if (distinct.includes(14)) distinct.push(1);
  for (let i = 0; i <= distinct.length - 5; i++) {
    if (distinct[i] - distinct[i+4] === 4) return (4 << 20) | (distinct[i] << 16);
  }
  if (groups[0][0] === 3) {
    const trip = groups[0][1];
    const kickers = [];
    for (let r = 14; r >= 2 && kickers.length < 2; r--) if (r !== trip && vcount[r]) kickers.push(r);
    return (3 << 20) | (trip << 16) | (kickers[0] << 12) | (kickers[1] << 8);
  }
  if (groups[0][0] === 2 && groups[1] && groups[1][0] === 2) {
    const p1 = groups[0][1], p2 = groups[1][1];
    let kicker = 0;
    for (let r = 14; r >= 2; r--) if (r !== p1 && r !== p2 && vcount[r]) { kicker = r; break; }
    return (2 << 20) | (p1 << 16) | (p2 << 12) | (kicker << 8);
  }
  if (groups[0][0] === 2) {
    const pair = groups[0][1];
    const k = [];
    for (let r = 14; r >= 2 && k.length < 3; r--) if (r !== pair && vcount[r]) k.push(r);
    return (1 << 20) | (pair << 16) | (k[0] << 12) | (k[1] << 8) | (k[2] << 4);
  }
  const high = [];
  for (let r = 14; r >= 2 && high.length < 5; r--) if (vcount[r]) high.push(r);
  return (0 << 20) | (high[0]<<16) | (high[1]<<12) | (high[2]<<8) | (high[3]<<4) | high[4];
}

// Expand a range key (AKs, QQ, T9o) into a list of 2-card combos.
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

// players: [{ kind, hand?, range? }]
// board: Card[]
// Returns raw counts so caller can aggregate (e.g. across workers).
export function simulate(players, board, sims) {
  const active = [];
  players.forEach((p, idx) => {
    if (!p) return;
    if (p.kind === 'hand' && p.hand && p.hand.length === 2) {
      active.push({ idx, kind: 'hand', hand: p.hand });
    } else if (p.kind === 'range' && p.range && p.range.length > 0) {
      active.push({ idx, kind: 'range', combos: expandRange(p.range) });
    }
  });
  if (active.length === 0) return { wins: {}, ties: {}, valid: 0 };

  const wins = {}, ties = {};
  active.forEach(a => { wins[a.idx] = 0; ties[a.idx] = 0; });

  const boardSet = new Set(board.map(cardId));
  const deck = makeDeck();

  let valid = 0;
  let safety = 0;
  while (valid < sims && safety < sims * 50) {
    safety++;
    const used = new Set(boardSet);
    const playerHands = [];
    let ok = true;
    for (const a of active) {
      if (a.kind === 'hand') {
        const ids = a.hand.map(cardId);
        if (ids.some(id => used.has(id))) { ok = false; break; }
        used.add(ids[0]); used.add(ids[1]);
        playerHands.push({ idx: a.idx, hand: a.hand });
      } else {
        let tries = 0, picked = null;
        while (tries < 20) {
          const c = a.combos[(Math.random() * a.combos.length) | 0];
          const ids = c.map(cardId);
          if (!used.has(ids[0]) && !used.has(ids[1])) { picked = c; break; }
          tries++;
        }
        if (!picked) { ok = false; break; }
        used.add(cardId(picked[0])); used.add(cardId(picked[1]));
        playerHands.push({ idx: a.idx, hand: picked });
      }
    }
    if (!ok) continue;

    const remaining = deck.filter(c => !used.has(cardId(c)));
    shuffle(remaining);
    const fullBoard = [...board];
    while (fullBoard.length < 5) fullBoard.push(remaining.pop());

    let best = -1;
    const scores = playerHands.map(ph => {
      const s = evaluate([...ph.hand, ...fullBoard]);
      if (s > best) best = s;
      return s;
    });
    const winners = [];
    for (let i = 0; i < scores.length; i++) if (scores[i] === best) winners.push(playerHands[i].idx);
    if (winners.length === 1) wins[winners[0]]++;
    else for (const w of winners) ties[w]++;
    valid++;
  }

  return { wins, ties, valid };
}

// Convenience: run sims on the calling thread and return percentages.
// Workers call `simulate` directly so counts can be aggregated.
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
