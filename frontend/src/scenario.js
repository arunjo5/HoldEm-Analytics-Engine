// scenario share codec (still reads old v1 links + rows)
import { cardToId, idToCard } from './pokerEngine.js';
import { packV2, unpackV2, rangeToMask, maskToRange } from './shareCodec.js';

/** @typedef {{ kind:'hand', hand: Array<{v:string,s:string}> } | { kind:'range', range:string[] }} Player */

export function encodeScenario({ players, board, playerNames, pot, callAmt }) {
  const p = (players || []).map((pl) => {
    if (!pl) return 0;
    if (pl.kind === 'hand') return (pl.hand || []).map(cardToId);
    return rangeToMask(pl.range || []);
  });
  while (p.length && p[p.length - 1] === 0) p.pop();
  const n = (playerNames || []).map((x) => x || '');
  while (n.length && n[n.length - 1] === '') n.pop();
  return packV2({
    p,
    b: (board || []).map(cardToId),
    n,
    po: pot || '',
    ca: callAmt || '',
  });
}

function expandScenarioV2(o) {
  const players = (o.p || []).map((pl) => {
    if (!pl || pl === 0) return null;
    if (Array.isArray(pl)) return { kind: 'hand', hand: pl.map(idToCard) };
    return { kind: 'range', range: maskToRange(pl) };
  });
  while (players.length < 9) players.push(null);
  const playerNames = (o.n || []).map((x) => x || null);
  while (playerNames.length < 9) playerNames.push(null);
  return {
    players,
    board: (o.b || []).map(idToCard),
    playerNames,
    pot: o.po || '',
    callAmt: o.ca || '',
  };
}

function decodeScenarioV1(str) {
  try {
    let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const obj = JSON.parse(decodeURIComponent(escape(atob(s))));
    const players = (obj.p || []).map((pl) => {
      if (!pl || pl === 0) return null;
      if (pl[0] === 'h') {
        const cs = pl[1] || '';
        const hand = [];
        for (let i = 0; i < cs.length; i += 2) hand.push({ v: cs[i], s: cs[i + 1] });
        return { kind: 'hand', hand };
      }
      return { kind: 'range', range: pl[1] || [] };
    });
    while (players.length < 9) players.push(null);
    const board = [];
    const bs = obj.b || '';
    for (let i = 0; i < bs.length; i += 2) board.push({ v: bs[i], s: bs[i + 1] });
    const playerNames = (obj.n || []).map((x) => x || null);
    while (playerNames.length < 9) playerNames.push(null);
    return { players, board, playerNames, pot: obj.po || '', callAmt: obj.ca || '' };
  } catch {
    return null;
  }
}

export function decodeScenario(str) {
  const v2 = unpackV2(str);
  if (v2 !== undefined) {
    if (v2 === null) return null;
    try { return expandScenarioV2(v2); } catch { return null; }
  }
  return decodeScenarioV1(str);
}

export function readScenarioFromUrl() {
  const hash = window.location.hash || '';
  if (hash.startsWith('#s=')) return decodeScenario(hash.slice(3));
  return null;
}

export function buildShareUrl({ players, board, playerNames, pot, callAmt }) {
  const enc = encodeScenario({ players, board, playerNames, pot, callAmt });
  return window.location.origin + window.location.pathname + '#s=' + enc;
}
