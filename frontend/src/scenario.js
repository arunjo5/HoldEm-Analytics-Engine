// Encode/decode a calculator scenario into a URL-safe base64 string,
// so it can be shared via link. The decode is intentionally tolerant —
// anything malformed yields null and the app just stays empty.

/** @typedef {{ kind:'hand', hand: Array<{v:string,s:string}> } | { kind:'range', range:string[] }} Player */

export function encodeScenario({ players, board, playerNames, pot, callAmt }) {
  const p = (players || []).map(pl => {
    if (!pl) return 0;
    if (pl.kind === 'hand') return ['h', (pl.hand || []).map(c => c.v + c.s).join('')];
    return ['r', pl.range || []];
  });
  const b = (board || []).map(c => c.v + c.s).join('');
  const n = (playerNames || Array(9).fill(null)).map(x => x || '');
  const payload = { p, b, n, po: pot || '', ca: callAmt || '' };
  const json = JSON.stringify(payload);
  // URL-safe base64
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function decodeScenario(str) {
  try {
    let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const json = decodeURIComponent(escape(atob(s)));
    const obj = JSON.parse(json);
    const players = (obj.p || []).map(pl => {
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

    const playerNames = (obj.n || []).map(x => x || null);
    while (playerNames.length < 9) playerNames.push(null);

    return {
      players,
      board,
      playerNames,
      pot: obj.po || '',
      callAmt: obj.ca || '',
    };
  } catch {
    return null;
  }
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
