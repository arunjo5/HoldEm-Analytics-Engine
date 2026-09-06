import { apiCall as call, jsonBody as json } from './api.js';
// pro short links: /s/<code> carries the same payload as a #s= / #r= link
const PATH_RE = /^\/s\/([A-Za-z0-9]{6,16})\/?$/;

export function readShareCodeFromUrl() {
  const m = (window.location.pathname || '').match(PATH_RE);
  return m ? m[1] : null;
}

export function shortLinkUrl(code) {
  return `${window.location.origin}/s/${code}`;
}

// kind + payload out of a long share url
export function splitShareUrl(url) {
  const i = String(url).indexOf('#');
  if (i < 0) return null;
  const h = String(url).slice(i);
  if (h.startsWith('#s=')) return { kind: 'scenario', payload: h.slice(3) };
  if (h.startsWith('#r=')) return { kind: 'replay', payload: h.slice(3) };
  return null;
}

export const createShareLink = ({ kind, payload, name }) => call('/api/share', { method: 'POST', ...json({ kind, payload, name }) });
export const fetchShareLink = (code) => call(`/api/share/${encodeURIComponent(code)}`);
export const listShareLinks = () => call('/api/share');
export const deleteShareLink = (code) => call(`/api/share/${encodeURIComponent(code)}`, { method: 'DELETE' });
export const renameShareLink = (code, name) => call(`/api/share/${encodeURIComponent(code)}`, { method: 'PATCH', ...json({ name }) });
