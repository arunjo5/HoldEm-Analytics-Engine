// compact v2 share codec — lz-string envelope + range bitmask
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

const V2 = '~';

export function packV2(obj) {
  return V2 + compressToEncodedURIComponent(JSON.stringify(obj));
}

export function unpackV2(str) {
  if (!str || str[0] !== V2) return undefined;
  try {
    const json = decompressFromEncodedURIComponent(str.slice(1));
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const RI = Object.fromEntries(RANKS.map((r, i) => [r, i]));

function cellKey(r, c) {
  const a = RANKS[r], b = RANKS[c];
  if (r === c) return a + a;
  if (r < c) return a + b + 's';
  return b + a + 'o';
}
function keyToIndex(key) {
  if (key.length === 2) { const r = RI[key[0]]; return r * 13 + r; }
  const hi = RI[key[0]], lo = RI[key[1]];
  return key[2] === 's' ? hi * 13 + lo : lo * 13 + hi;
}

export function rangeToMask(range) {
  const bytes = new Uint8Array(22);
  for (const key of range || []) {
    const i = keyToIndex(key);
    if (i >= 0 && i < 169) bytes[i >> 3] |= 1 << (i & 7);
  }
  return bytesToB64(bytes);
}
export function maskToRange(b64) {
  const bytes = b64ToBytes(b64);
  const out = [];
  for (let i = 0; i < 169; i++) {
    if (bytes[i >> 3] & (1 << (i & 7))) out.push(cellKey(Math.floor(i / 13), i % 13));
  }
  return out;
}

function bytesToB64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64ToBytes(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
