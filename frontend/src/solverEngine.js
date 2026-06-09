// Heads-up river CFR+ solver over a discretized bet tree. Returns per-node,
// per-combo strategies + EV + exploitability (% pot). Amounts in big blinds.

import { cardToId, evaluate7 } from './pokerEngine.js';

const RANK_ORDER = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const SUITS = ['s', 'h', 'd', 'c'];
export const CAT_NAME = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Quads', 'Straight flush'];

export function rangeKey(r, c) {
  const a = RANK_ORDER[r], b = RANK_ORDER[c];
  if (r === c) return a + b;
  if (r < c) return a + b + 's';
  return b + a + 'o';
}

export function comboCardsFor(key) {
  const out = [];
  if (key.length === 2) {
    const v = key[0];
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) out.push([{ v, s: SUITS[i] }, { v, s: SUITS[j] }]);
    return out;
  }
  const hi = key[0], lo = key[1], suited = key[2] === 's';
  if (suited) for (const s of SUITS) out.push([{ v: hi, s }, { v: lo, s }]);
  else for (const s1 of SUITS) for (const s2 of SUITS) if (s1 !== s2) out.push([{ v: hi, s: s1 }, { v: lo, s: s2 }]);
  return out;
}

// One side's live combos on the board (board removal + optional hand restrict).
function buildCombos(rangeKeys, board, restrictIds) {
  const bIds = board.map(cardToId);
  const boardSet = new Set(board.map((c) => c.v + c.s));
  const out = [];
  for (const hkey of rangeKeys) {
    for (const cc of comboCardsFor(hkey)) {
      const a = cc[0].v + cc[0].s, b = cc[1].v + cc[1].s;
      if (restrictIds && !restrictIds.has(a + b) && !restrictIds.has(b + a)) continue;
      if (boardSet.has(a) || boardSet.has(b)) continue;
      const c0 = cardToId(cc[0]), c1 = cardToId(cc[1]);
      const score = evaluate7(c0, c1, bIds[0], bIds[1], bIds[2], bIds[3], bIds[4]);
      out.push({
        id: a + b, hkey, cards: cc, score, cat: score >>> 20,
        lo: ((c0 < 32 ? (1 << c0) : 0) | (c1 < 32 ? (1 << c1) : 0)) >>> 0,
        hi: ((c0 >= 32 ? (1 << (c0 - 32)) : 0) | (c1 >= 32 ? (1 << (c1 - 32)) : 0)) >>> 0,
      });
    }
  }
  return out;
}

// HU river betting tree; terminals resolve by showdown or fold.
function buildTree(spot) {
  const onSizes = spot.betSizes.filter((b) => b.on);
  const S = spot.stack;

  let repId = null, repPct = 75, bestD = Infinity;
  for (const b of onSizes) { const d = Math.abs(b.pct - 75); if (d < bestD) { bestD = d; repId = b.id; repPct = b.pct; } }

  function showdown(pot, inv) { return { terminal: true, type: 'showdown', pot, inv }; }
  function foldT(pot, inv, winner) { return { terminal: true, type: 'fold', pot, inv, winner }; }
  function dec(player, actions, children) { return { terminal: false, player, actions, children }; }

  // Options when `toAct` faces no bet: check + each distinct bet/all-in amount.
  function betOptions(pot, inv, toAct) {
    const rem = S - inv[toAct];
    const acts = [], amts = [];
    const seen = new Set();
    for (const b of onSizes) {
      let amt = Math.round(pot * b.pct / 100);
      if (amt <= 0) continue;
      if (amt >= rem) amt = rem;
      if (seen.has(amt)) continue;
      seen.add(amt);
      acts.push({ id: b.id, kind: 'bet', pct: b.pct }); amts.push(amt);
    }
    if (spot.allIn && rem > 0 && !seen.has(rem)) { acts.push({ id: 'allin', kind: 'bet', pct: 999 }); amts.push(rem); }
    return { acts, amts };
  }

  // No bet pending. afterCheck = the other player already checked to us.
  function buildOpen(toAct, pot, inv, afterCheck) {
    const { acts, amts } = betOptions(pot, inv, toAct);
    const actions = [{ id: 'check', kind: 'check' }, ...acts];
    const children = [];
    // check
    children.push(afterCheck ? showdown(pot, inv.slice()) : buildOpen(1 - toAct, pot, inv.slice(), true));
    // bets
    for (let i = 0; i < acts.length; i++) {
      const amt = amts[i];
      const ninv = inv.slice(); ninv[toAct] += amt;
      children.push(buildFacing(1 - toAct, pot + amt, ninv, { toCall: amt, agg: toAct, depth: 0 }));
    }
    return dec(toAct, actions, children);
  }

  // Facing a bet/raise: fold / call / (raise|all-in by depth).
  function buildFacing(toAct, pot, inv, st) {
    const rem = S - inv[toAct];
    const toCall = Math.min(st.toCall, rem);
    const actions = [{ id: 'fold', kind: 'fold' }, { id: 'call', kind: 'call' }];
    const children = [foldT(pot, inv.slice(), st.agg)];
    const cinv = inv.slice(); cinv[toAct] += toCall;
    children.push(showdown(pot + toCall, cinv));
    // raise (depth 0) → pot-sized raise; all-in (depth 1) → shove; depth 2 → none
    if (st.depth < 2 && rem > toCall) {
      let add;
      if (st.depth === 0) add = Math.min(toCall + (pot + toCall), rem);  // pot-sized raise
      else add = rem;                                                     // re-raise = all-in
      const rinv = inv.slice(); rinv[toAct] += add;
      const newCall = rinv[toAct] - inv[1 - toAct];
      actions.push(st.depth === 0 ? { id: 'raise', kind: 'raise' } : { id: 'allin', kind: 'raise' });
      children.push(buildFacing(1 - toAct, pot + add, rinv, { toCall: newCall, agg: toAct, depth: st.depth + 1 }));
    }
    return dec(toAct, actions, children);
  }

  const root = buildOpen(0, spot.pot, [0, 0], false);                  // OOP first
  const ipVsCheck = root.children[0];                                   // OOP checked → IP
  const repIdx = root.actions.findIndex((a) => a.id === repId);
  const ipVsBet = repIdx > 0 ? root.children[repIdx] : null;            // OOP bet rep → IP faces
  const repIdx2 = ipVsCheck.actions ? ipVsCheck.actions.findIndex((a) => a.id === repId) : -1;
  const oopVsBet = repIdx2 > 0 ? ipVsCheck.children[repIdx2] : null;    // check, IP bet rep → OOP faces

  return { root, repPct, display: { oop_first: root, ip_vs_check: ipVsCheck, ip_vs_bet: ipVsBet, oop_vs_bet: oopVsBet } };
}

// Attach CFR storage to every decision node, sized by the acting player's combos.
function initNodes(node, nOOP, nIP) {
  if (node.terminal) return;
  const N = node.player === 0 ? nOOP : nIP;
  const A = node.actions.length;
  node.N = N; node.A = A;
  node.regret = new Float64Array(N * A);
  node.strat = new Float64Array(N * A);  // accumulated (linear-weighted) strategy
  for (const ch of node.children) initNodes(ch, nOOP, nIP);
}

// Regret-matching+ strategy for one combo into `out` (length A).
function strategyOf(node, i, out) {
  const A = node.A, base = i * A;
  let sum = 0;
  for (let a = 0; a < A; a++) { const r = node.regret[base + a]; out[a] = r > 0 ? r : 0; sum += out[a]; }
  if (sum > 0) { for (let a = 0; a < A; a++) out[a] /= sum; }
  else { const u = 1 / A; for (let a = 0; a < A; a++) out[a] = u; }
}

export function solve(board, oopKeys, ipKeys, spot, opts = {}, onProgress) {
  const iters = opts.iterations || 256;
  const oop = buildCombos(oopKeys, board, opts.oopRestrict);
  const ip = buildCombos(ipKeys, board, opts.ipRestrict);
  const nO = oop.length, nI = ip.length;
  const sides = [oop, ip];

  // typed arrays for the hot showdown loop
  const sc = [new Int32Array(nO), new Int32Array(nI)];
  const lo = [new Uint32Array(nO), new Uint32Array(nI)];
  const hi = [new Uint32Array(nO), new Uint32Array(nI)];
  for (let p = 0; p < 2; p++) for (let i = 0; i < sides[p].length; i++) { sc[p][i] = sides[p][i].score; lo[p][i] = sides[p][i].lo; hi[p][i] = sides[p][i].hi; }

  const tree = buildTree(spot);
  initNodes(tree.root, nO, nI);

  // number of valid (oop,ip) deals — normaliser for EV / exploitability
  let Z = 0;
  for (let i = 0; i < nO; i++) for (let j = 0; j < nI; j++) if (!((lo[0][i] & lo[1][j]) || (hi[0][i] & hi[1][j]))) Z++;
  if (Z === 0 || nO === 0 || nI === 0) {
    return { empty: true, oopCount: nO, ipCount: nI };
  }

  // showdown counterfactual values for traverser p's combos, given opp reach.
  function showdownCFV(p, terminal, reachOpp, out) {
    const me = p, opp = 1 - p, msc = sc[me], olo = lo[opp], ohi = hi[opp], osc = sc[opp];
    const mlo = lo[me], mhi = hi[me], no = sides[opp].length, nm = sides[me].length;
    const inv = terminal.inv, pot = terminal.pot;
    const winPay = pot - inv[me], tiePay = pot / 2 - inv[me], losePay = -inv[me];
    for (let i = 0; i < nm; i++) {
      const si = msc[i], pl = mlo[i], ph = mhi[i];
      let w = 0, t = 0, l = 0;
      for (let j = 0; j < no; j++) {
        if ((pl & olo[j]) || (ph & ohi[j])) continue;
        const rj = reachOpp[j]; if (rj === 0) continue;
        const sj = osc[j];
        if (si > sj) w += rj; else if (si === sj) t += rj; else l += rj;
      }
      out[i] = winPay * w + tiePay * t + losePay * l;
    }
  }
  function foldCFV(p, terminal, reachOpp, out) {
    const me = p, opp = 1 - p, olo = lo[opp], ohi = hi[opp], mlo = lo[me], mhi = hi[me];
    const no = sides[opp].length, nm = sides[me].length, inv = terminal.inv, pot = terminal.pot;
    const pay = terminal.winner === me ? (pot - inv[me]) : (-inv[me]);
    for (let i = 0; i < nm; i++) {
      const pl = mlo[i], ph = mhi[i];
      let s = 0;
      for (let j = 0; j < no; j++) { if ((pl & olo[j]) || (ph & ohi[j])) continue; s += reachOpp[j]; }
      out[i] = pay * s;
    }
  }

  // vector CFR (alternating): returns counterfactual values for p's combos.
  const tmpStrat = new Float64Array(16);
  function cfr(node, p, reachP, reachOpp, iterW) {
    if (node.terminal) {
      const out = new Float64Array(sides[p].length);
      if (node.type === 'showdown') showdownCFV(p, node, reachOpp, out);
      else foldCFV(p, node, reachOpp, out);
      return out;
    }
    const A = node.A, N = node.N;
    if (node.player === p) {
      const nodeCFV = new Float64Array(N);
      const childCFV = [];
      const strat = new Float64Array(N * A);
      for (let i = 0; i < N; i++) { strategyOf(node, i, tmpStrat); for (let a = 0; a < A; a++) strat[i * A + a] = tmpStrat[a]; }
      for (let a = 0; a < A; a++) {
        const rp = new Float64Array(N);
        for (let i = 0; i < N; i++) rp[i] = reachP[i] * strat[i * A + a];
        childCFV[a] = cfr(node.children[a], p, rp, reachOpp, iterW);
        for (let i = 0; i < N; i++) nodeCFV[i] += strat[i * A + a] * childCFV[a][i];
      }
      // regret (CFR+) + linear strategy accumulation
      for (let i = 0; i < N; i++) {
        const base = i * A, rpi = reachP[i];
        for (let a = 0; a < A; a++) {
          let r = node.regret[base + a] + (childCFV[a][i] - nodeCFV[i]);
          if (r < 0) r = 0;
          node.regret[base + a] = r;
          node.strat[base + a] += iterW * rpi * strat[base + a];
        }
      }
      return nodeCFV;
    }
    // opponent acts: split opp reach by their strategy, sum child values
    const cfv = new Float64Array(sides[p].length);
    for (let a = 0; a < A; a++) {
      const ro = new Float64Array(N);
      for (let j = 0; j < N; j++) { strategyOf(node, j, tmpStrat); ro[j] = reachOpp[j] * tmpStrat[a]; }
      const c = cfr(node.children[a], p, reachP, ro, iterW);
      for (let i = 0; i < c.length; i++) cfv[i] += c[i];
    }
    return cfv;
  }

  // value of p's avg strategy vs opp avg strategy (or best response if br===p)
  function evalValue(node, p, reachP, reachOpp, br) {
    if (node.terminal) {
      const out = new Float64Array(sides[p].length);
      if (node.type === 'showdown') showdownCFV(p, node, reachOpp, out);
      else foldCFV(p, node, reachOpp, out);
      return out;
    }
    const A = node.A, N = node.N;
    if (node.player === p) {
      const childCFV = [];
      for (let a = 0; a < A; a++) {
        const rp = new Float64Array(N);
        const useAvg = br !== p;
        for (let i = 0; i < N; i++) rp[i] = reachP[i] * (useAvg ? avgStrat(node, i, a) : 1);
        childCFV[a] = evalValue(node.children[a], p, rp, reachOpp, br);
      }
      const out = new Float64Array(N);
      if (br === p) { // best response: max over actions per combo
        for (let i = 0; i < N; i++) { let m = -Infinity; for (let a = 0; a < A; a++) if (childCFV[a][i] > m) m = childCFV[a][i]; out[i] = m; }
      } else {
        for (let i = 0; i < N; i++) { let v = 0; for (let a = 0; a < A; a++) v += avgStrat(node, i, a) * childCFV[a][i]; out[i] = v; }
      }
      return out;
    }
    const cfv = new Float64Array(sides[p].length);
    for (let a = 0; a < A; a++) {
      const ro = new Float64Array(N);
      for (let j = 0; j < N; j++) ro[j] = reachOpp[j] * avgStrat(node, j, a);
      const c = evalValue(node.children[a], p, reachP, ro, br);
      for (let i = 0; i < c.length; i++) cfv[i] += c[i];
    }
    return cfv;
  }
  function avgStrat(node, i, a) {
    const A = node.A, base = i * A;
    let sum = 0; for (let x = 0; x < A; x++) sum += node.strat[base + x];
    return sum > 0 ? node.strat[base + a] / sum : 1 / A;
  }
  function rootValue(p, br) {
    const reachP = new Float64Array(sides[p].length).fill(1);
    const reachOpp = new Float64Array(sides[1 - p].length).fill(1);
    const cfv = evalValue(tree.root, p, reachP, reachOpp, br);
    let s = 0; for (let i = 0; i < cfv.length; i++) s += cfv[i];
    return s / Z;
  }
  function exploitabilityPctPot() {
    const evO = rootValue(0, -1), evI = rootValue(1, -1);
    const brO = rootValue(0, 0), brI = rootValue(1, 1);
    const ev = ((brO - evO) + (brI - evI)) / 2;
    return { evOOP: evO, evIP: evI, exploit: Math.max(0, ev) / spot.pot * 100, brO, brI };
  }

  // ── run CFR+ ──
  const trace = [];
  const traceEvery = Math.max(1, Math.floor(iters / 32));
  for (let t = 1; t <= iters; t++) {
    const w = t; // linear averaging
    cfr(tree.root, 0, new Float64Array(nO).fill(1), new Float64Array(nI).fill(1), w);
    cfr(tree.root, 1, new Float64Array(nI).fill(1), new Float64Array(nO).fill(1), w);
    if (t % traceEvery === 0 || t === iters) {
      const e = exploitabilityPctPot();
      trace.push(e.exploit);
      if (onProgress) onProgress({ iter: t, total: iters, exploit: e.exploit, pct: t / iters });
    }
  }

  const fin = exploitabilityPctPot();
  const sizeCount = onSizesCount(spot);

  // ── format per display node into the UI contract ──
  function nodeMeta(id) {
    const node = tree.display[id];
    if (!node) return null;
    const actor = node.player === 0 ? 'OOP' : 'IP';
    const facing = node.actions.some((a) => a.kind === 'fold') ? 'bet' : null;
    let label;
    if (id === 'oop_first') label = 'OOP — first to act';
    else if (id === 'ip_vs_check') label = 'IP — facing check';
    else if (id === 'ip_vs_bet') label = `IP — facing OOP bet ${tree.repPct}%`;
    else label = `OOP — facing IP bet ${tree.repPct}%`;
    return { id, actor, facing, label, actions: node.actions.map((a) => actionMeta(a)) };
  }
  function buildNodeSolve(id, restrictIds) {
    const node = tree.display[id];
    if (!node) return null;
    const p = node.player, side = sides[p], A = node.A;
    const combosOut = [];
    // strength percentile across this actor's live combos
    const order = side.map((_, i) => i).sort((a, b) => side[a].score - side[b].score);
    const strRank = new Float64Array(side.length);
    order.forEach((idx, k) => { strRank[idx] = side.length > 1 ? k / (side.length - 1) : 0.5; });
    for (let i = 0; i < side.length; i++) {
      const cmb = side[i];
      if (restrictIds && !restrictIds.has(cmb.id)) continue;
      const weights = {};
      for (let a = 0; a < A; a++) weights[node.actions[a].id] = avgStrat(node, i, a);
      combosOut.push({ id: cmb.id, hkey: cmb.hkey, cards: cmb.cards, cat: cmb.cat, str: strRank[i], weights });
    }
    const byKey = {};
    for (const c of combosOut) {
      let g = byKey[c.hkey];
      if (!g) g = byKey[c.hkey] = { hkey: c.hkey, combos: [], agg: {}, count: 0 };
      g.combos.push(c); g.count++;
      for (const aid in c.weights) g.agg[aid] = (g.agg[aid] || 0) + c.weights[aid];
    }
    for (const k in byKey) {
      const g = byKey[k];
      for (const aid in g.agg) g.agg[aid] /= g.count;
      let best = null, bv = -1; for (const aid in g.agg) if (g.agg[aid] > bv) { bv = g.agg[aid]; best = aid; }
      g.dominant = best;
      g.combos.sort((a, b) => b.cat - a.cat || 0);
    }
    return { byKey, combos: combosOut, count: combosOut.length };
  }

  const nodes = ['oop_first', 'ip_vs_check', 'ip_vs_bet', 'oop_vs_bet'].map(nodeMeta).filter(Boolean);
  const nodeSolves = {};
  for (const n of nodes) nodeSolves[n.id] = buildNodeSolve(n.id, n.actor === 'OOP' ? opts.oopRestrict : opts.ipRestrict);

  return {
    nodes,
    nodeSolves,
    meta: {
      potBb: spot.pot, evOOP: fin.evOOP, evIP: fin.evIP,
      exploitPctPot: fin.exploit, iterations: iters, sizeCount, repBetPct: tree.repPct,
    },
    trace,
    oopCount: nO, ipCount: nI,
  };
}

function onSizesCount(spot) { return spot.betSizes.filter((b) => b.on).length + (spot.allIn ? 1 : 0); }

function actionMeta(a) {
  if (a.kind === 'check') return { id: 'check', kind: 'check', label: 'Check' };
  if (a.kind === 'fold') return { id: 'fold', kind: 'fold', label: 'Fold' };
  if (a.kind === 'call') return { id: 'call', kind: 'call', label: 'Call' };
  if (a.kind === 'raise') return { id: a.id, kind: 'raise', label: a.id === 'allin' ? 'All-in' : 'Raise' };
  // bet
  if (a.pct >= 999) return { id: 'allin', kind: 'bet', sizePct: 999, label: 'All-in' };
  return { id: a.id, kind: 'bet', sizePct: a.pct, label: `Bet ${a.pct}%` };
}

// Action color convention (matches the handoff).
export function actionColor(a) {
  if (a.kind === 'check') return '#57b98c';
  if (a.kind === 'call') return '#3f9e96';
  if (a.kind === 'fold') return '#6b9cdf';
  if (a.kind === 'raise') return '#b3322b';
  const p = a.sizePct;
  if (p >= 999) return '#7c1d18';
  if (p <= 40) return '#e69a8f';
  if (p <= 80) return '#d8463e';
  if (p <= 150) return '#bb352c';
  return '#9a2922';
}

// ── side helpers + pre-solve equity (runs live on the main thread) ──
const VAL = { A: 14, K: 13, Q: 12, J: 11, T: 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 };
export function cardsToKey(c1, c2) {
  if (!c1 || !c2) return null;
  if (c1.v === c2.v) return c1.v + c2.v;
  const hi = VAL[c1.v] >= VAL[c2.v] ? c1 : c2, lo = VAL[c1.v] >= VAL[c2.v] ? c2 : c1;
  return hi.v + lo.v + (c1.s === c2.s ? 's' : 'o');
}
export function sideToRangeKeys(side) {
  if (!side) return [];
  if (side.kind === 'hand') { const k = side.cards && side.cards.length === 2 ? cardsToKey(side.cards[0], side.cards[1]) : null; return k ? [k] : []; }
  return side.keys || [];
}
export function comboCount(key) { return key.length === 2 ? 6 : (key.endsWith('s') ? 4 : 12); }
export function combosFromKeys(keys) { let n = 0; for (const k of keys || []) n += comboCount(k); return n; }

function sideCombos(side, blockIds) {
  if (!side) return [];
  if (side.kind === 'hand') {
    const cs = (side.cards || []).filter(Boolean);
    if (cs.length !== 2) return [];
    if (blockIds.has(cs[0].v + cs[0].s) || blockIds.has(cs[1].v + cs[1].s)) return [];
    return [cs];
  }
  const out = [];
  for (const k of side.keys || []) for (const cc of comboCardsFor(k)) {
    if (blockIds.has(cc[0].v + cc[0].s) || blockIds.has(cc[1].v + cc[1].s)) continue;
    out.push(cc);
  }
  return out;
}
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ALL_VALS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const cid = (c) => c.v + c.s;

// hero vs villain (hand or range), blocker-aware: exact on a full board, else MC.
export function equityMatchup(heroSide, villainSide, board) {
  const live = (board || []).filter(Boolean);
  const boardIds = new Set(live.map(cid));
  const bIds = live.map(cardToId);
  const hero = sideCombos(heroSide, boardIds), vill = sideCombos(villainSide, boardIds);
  const hc = hero.length, vc = vill.length;
  if (!hc || !vc) return { hero: null, villain: null, heroCount: hc, villCount: vc, method: 'exact', samples: 0 };
  let win = 0, tie = 0, loss = 0, total = 0;
  if (live.length === 5) {
    const pairs = hc * vc, cap = 200000, sample = pairs > cap, rng = mulberry32(0x5e7);
    const hs = hero.map((h) => evaluate7(cardToId(h[0]), cardToId(h[1]), bIds[0], bIds[1], bIds[2], bIds[3], bIds[4]));
    const trials = sample ? cap : pairs;
    for (let n = 0; n < trials; n++) {
      let hi, vi; if (sample) { hi = (rng() * hc) | 0; vi = (rng() * vc) | 0; } else { hi = (n / vc) | 0; vi = n % vc; }
      const h = hero[hi], v = vill[vi];
      if (cid(v[0]) === cid(h[0]) || cid(v[0]) === cid(h[1]) || cid(v[1]) === cid(h[0]) || cid(v[1]) === cid(h[1])) continue;
      const vs = evaluate7(cardToId(v[0]), cardToId(v[1]), bIds[0], bIds[1], bIds[2], bIds[3], bIds[4]);
      if (hs[hi] > vs) win++; else if (hs[hi] === vs) tie++; else loss++; total++;
    }
    return finalizeEq(win, tie, loss, total, hc, vc, 'exact', total);
  }
  const rng = mulberry32(0x1234 + live.length), need = 5 - live.length, deck = [], MC = 20000;
  for (const v of ALL_VALS) for (const s of SUITS) deck.push({ v, s });
  for (let n = 0; n < MC; n++) {
    const h = hero[(rng() * hc) | 0], v = vill[(rng() * vc) | 0];
    const used = new Set([...boardIds, cid(h[0]), cid(h[1])]);
    if (used.has(cid(v[0])) || used.has(cid(v[1]))) continue;
    used.add(cid(v[0])); used.add(cid(v[1]));
    const run = []; let g = 0;
    while (run.length < need && g < 400) { const c = deck[(rng() * 52) | 0]; if (!used.has(cid(c))) { used.add(cid(c)); run.push(c); } g++; }
    if (run.length < need) continue;
    const full = [...live, ...run].map(cardToId);
    const hs = evaluate7(cardToId(h[0]), cardToId(h[1]), full[0], full[1], full[2], full[3], full[4]);
    const vs = evaluate7(cardToId(v[0]), cardToId(v[1]), full[0], full[1], full[2], full[3], full[4]);
    if (hs > vs) win++; else if (hs === vs) tie++; else loss++; total++;
  }
  return finalizeEq(win, tie, loss, total, hc, vc, 'simulated', total);
}
function finalizeEq(win, tie, loss, total, hc, vc, method, samples) {
  const t = total || 1;
  return {
    hero: { win: win / t * 100, tie: tie / t * 100, equity: (win + tie / 2) / t * 100 },
    villain: { win: loss / t * 100, tie: tie / t * 100, equity: (loss + tie / 2) / t * 100 },
    heroCount: hc, villCount: vc, method, samples,
  };
}
