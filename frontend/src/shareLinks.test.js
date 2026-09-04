import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readShareCodeFromUrl,
  shortLinkUrl,
  splitShareUrl,
  createShareLink,
  fetchShareLink,
  listShareLinks,
  deleteShareLink,
  renameShareLink,
} from './shareLinks.js';

const ok = (data) => ({ ok: true, status: 200, json: async () => data });
const bad = (status, data = {}) => ({ ok: false, status, json: async () => data });
const unparseable = (status = 200) => ({
  ok: status < 400, status, json: async () => { throw new SyntaxError('not json'); },
});

const mockFetch = (res) => {
  const fn = vi.fn(async () => (typeof res === 'function' ? res() : res));
  global.fetch = fn;
  return fn;
};
const lastCall = () => global.fetch.mock.calls[global.fetch.mock.calls.length - 1];

let realLocation;
function stubLocation(over) {
  realLocation = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'http://localhost:3000', pathname: '/', search: '', hash: '', ...over },
  });
}

afterEach(() => {
  if (realLocation) {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
    realLocation = null;
  }
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('readShareCodeFromUrl', () => {
  const at = (path) => { window.history.replaceState(null, '', path); return readShareCodeFromUrl(); };

  it('reads a 6–16 character alphanumeric code, with or without a trailing slash', () => {
    expect(at('/s/abcdef')).toBe('abcdef');                     // 6, the floor
    expect(at('/s/AbCdEf12')).toBe('AbCdEf12');
    expect(at('/s/1234567890123456')).toBe('1234567890123456'); // 16, the ceiling
    expect(at('/s/AbCdEf12/')).toBe('AbCdEf12');
  });

  it('ignores the query and the hash', () => {
    expect(at('/s/AbCdEf12?ref=x#y')).toBe('AbCdEf12');
  });

  it('rejects anything that is not exactly a share path', () => {
    expect(at('/')).toBeNull();
    expect(at('/s/abcde')).toBeNull();               // 5, too short
    expect(at('/s/12345678901234567')).toBeNull();   // 17, too long
    expect(at('/s/')).toBeNull();
    expect(at('/s/abc-def')).toBeNull();             // non-alphanumeric
    expect(at('/s/abc_def')).toBeNull();
    expect(at('/s/abcdef/more')).toBeNull();
    expect(at('/share/abcdef')).toBeNull();
    expect(at('/x/s/abcdef')).toBeNull();
  });

  it('survives a location with no pathname', () => {
    stubLocation({ pathname: undefined });
    expect(readShareCodeFromUrl()).toBeNull();
  });
});

describe('shortLinkUrl', () => {
  it('hangs the code off the current origin', () => {
    stubLocation({ origin: 'https://pokerlab.test' });
    expect(shortLinkUrl('AbCdEf12')).toBe('https://pokerlab.test/s/AbCdEf12');
  });
});

describe('splitShareUrl', () => {
  it('splits a scenario hash', () => {
    expect(splitShareUrl('http://x/#s=abc')).toEqual({ kind: 'scenario', payload: 'abc' });
  });

  it('splits a replay hash', () => {
    expect(splitShareUrl('http://x/?q=1#r=xyz')).toEqual({ kind: 'replay', payload: 'xyz' });
  });

  it('keeps everything after the first hash as the payload', () => {
    expect(splitShareUrl('http://x/#s=ab#cd')).toEqual({ kind: 'scenario', payload: 'ab#cd' });
  });

  it('allows an empty payload', () => {
    expect(splitShareUrl('http://x/#s=')).toEqual({ kind: 'scenario', payload: '' });
  });

  it('returns null for a url with no hash or an unknown hash', () => {
    expect(splitShareUrl('http://x/')).toBeNull();
    expect(splitShareUrl('http://x/#')).toBeNull();
    expect(splitShareUrl('http://x/#other=1')).toBeNull();
    expect(splitShareUrl('http://x/#s')).toBeNull();
    expect(splitShareUrl('')).toBeNull();
    expect(splitShareUrl(null)).toBeNull();
  });
});

describe('share link fetch wrappers', () => {
  beforeEach(() => { mockFetch(ok({})); });

  it('createShareLink POSTs json to /api/share', async () => {
    mockFetch(ok({ link: { code: 'AbCdEf12' } }));
    const res = await createShareLink({ kind: 'scenario', payload: 'p1', name: 'My spot' });
    const [url, opts] = lastCall();
    expect(url).toBe('/api/share');
    expect(opts.method).toBe('POST');
    expect(opts.credentials).toBe('include');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual({ kind: 'scenario', payload: 'p1', name: 'My spot' });
    expect(res).toEqual({ ok: true, link: { code: 'AbCdEf12' } });
  });

  it('createShareLink drops an absent name from the body', async () => {
    await createShareLink({ kind: 'replay', payload: 'p2' });
    expect(JSON.parse(lastCall()[1].body)).toEqual({ kind: 'replay', payload: 'p2' });
  });

  it('fetchShareLink GETs the code path', async () => {
    mockFetch(ok({ kind: 'replay', payload: 'p3' }));
    const res = await fetchShareLink('AbCdEf12');
    const [url, opts] = lastCall();
    expect(url).toBe('/api/share/AbCdEf12');
    expect(opts.method).toBeUndefined();
    expect(opts.credentials).toBe('include');
    expect(res).toEqual({ ok: true, kind: 'replay', payload: 'p3' });
  });

  it('fetchShareLink encodes a hostile code into the path', async () => {
    await fetchShareLink('../admin?x=1');
    expect(lastCall()[0]).toBe('/api/share/..%2Fadmin%3Fx%3D1');
  });

  it('listShareLinks GETs the collection', async () => {
    mockFetch(ok({ links: [{ code: 'AbCdEf12' }] }));
    const res = await listShareLinks();
    expect(lastCall()[0]).toBe('/api/share');
    expect(lastCall()[1].credentials).toBe('include');
    expect(res).toEqual({ ok: true, links: [{ code: 'AbCdEf12' }] });
  });

  it('deleteShareLink DELETEs the code path with no body', async () => {
    const res = await deleteShareLink('AbCdEf12');
    const [url, opts] = lastCall();
    expect(url).toBe('/api/share/AbCdEf12');
    expect(opts.method).toBe('DELETE');
    expect(opts.credentials).toBe('include');
    expect(opts.body).toBeUndefined();
    expect(res).toEqual({ ok: true });
  });

  it('renameShareLink PATCHes the name as json', async () => {
    await renameShareLink('AbCdEf12', 'Turn probe');
    const [url, opts] = lastCall();
    expect(url).toBe('/api/share/AbCdEf12');
    expect(opts.method).toBe('PATCH');
    expect(opts.credentials).toBe('include');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual({ name: 'Turn probe' });
  });
});

describe('share link error normalisation', () => {
  it('surfaces the server error and code on a non-ok response', async () => {
    mockFetch(bad(402, { error: 'Pro only', code: 'pro_required' }));
    expect(await createShareLink({ kind: 'scenario', payload: 'p' }))
      .toEqual({ ok: false, status: 402, error: 'Pro only', code: 'pro_required' });
  });

  it('falls back to a status-coded message when the body carries no error', async () => {
    mockFetch(bad(500));
    const res = await listShareLinks();
    expect(res).toEqual({ ok: false, status: 500, error: 'Request failed (500)' });
    expect(res.code).toBeUndefined();
  });

  it('treats an unreadable error body the same way', async () => {
    mockFetch(unparseable(404));
    expect(await fetchShareLink('AbCdEf12'))
      .toEqual({ ok: false, status: 404, error: 'Request failed (404)' });
  });

  it('treats an unreadable success body as an empty payload', async () => {
    mockFetch(unparseable(200));
    expect(await deleteShareLink('AbCdEf12')).toEqual({ ok: true });
  });

  it('reports a rejected fetch as a status-0 network error', async () => {
    mockFetch(() => { throw new TypeError('Failed to fetch'); });
    for (const call of [
      () => createShareLink({ kind: 'scenario', payload: 'p' }),
      () => fetchShareLink('AbCdEf12'),
      () => listShareLinks(),
      () => deleteShareLink('AbCdEf12'),
      () => renameShareLink('AbCdEf12', 'x'),
    ]) {
      expect(await call()).toEqual({ ok: false, status: 0, error: 'Network error' });
    }
  });
});
