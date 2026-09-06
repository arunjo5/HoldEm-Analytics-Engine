import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiCall, jsonBody } from './api.js';
import {
  listRanges,
  createRange,
  updateRange,
  deleteRange,
  listSolves,
  createSolve,
  renameSolve,
  deleteSolve,
} from './library.js';

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

afterEach(() => { vi.restoreAllMocks(); });

describe('apiCall', () => {
  it('sends cookies by default and spreads the json body into an ok result', async () => {
    mockFetch(ok({ ranges: [{ id: 'r1' }] }));
    const res = await apiCall('/api/ranges');
    const [url, opts] = lastCall();
    expect(url).toBe('/api/ranges');
    expect(opts.credentials).toBe('include');
    expect(opts.method).toBeUndefined();
    expect(res).toEqual({ ok: true, ranges: [{ id: 'r1' }] });
  });

  it('merges caller options over the defaults', async () => {
    mockFetch(ok({}));
    await apiCall('/api/ranges', { method: 'POST', credentials: 'omit', headers: { 'X-Test': '1' } });
    const [, opts] = lastCall();
    expect(opts.method).toBe('POST');
    expect(opts.credentials).toBe('omit');
    expect(opts.headers).toEqual({ 'X-Test': '1' });
  });

  it('carries error, code, cap and plan off a non-ok response', async () => {
    mockFetch(bad(403, { error: 'Range limit reached', code: 'limit_reached', cap: 3, plan: 'free' }));
    expect(await apiCall('/api/ranges', { method: 'POST' })).toEqual({
      ok: false, status: 403, error: 'Range limit reached', code: 'limit_reached', cap: 3, plan: 'free',
    });
  });

  it('falls back to a status-coded message when the error body is empty or unreadable', async () => {
    mockFetch(bad(500));
    expect(await apiCall('/api/ranges')).toEqual({
      ok: false, status: 500, error: 'Request failed (500)', code: undefined, cap: undefined, plan: undefined,
    });
    mockFetch(unparseable(404));
    expect(await apiCall('/api/ranges')).toMatchObject({ ok: false, status: 404, error: 'Request failed (404)' });
  });

  it('treats an unreadable success body as an empty payload', async () => {
    mockFetch(unparseable(200));
    expect(await apiCall('/api/ranges')).toEqual({ ok: true });
  });

  it('reports a rejected fetch as a status-0 network error', async () => {
    mockFetch(() => { throw new TypeError('Failed to fetch'); });
    expect(await apiCall('/api/ranges')).toEqual({ ok: false, status: 0, error: 'Network error' });
  });
});

describe('jsonBody', () => {
  it('serialises the body and sets the json content type', () => {
    expect(jsonBody({ name: 'BTN open' })).toEqual({
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"BTN open"}',
    });
  });
});

describe('saved range wrappers', () => {
  beforeEach(() => { mockFetch(ok({})); });

  it('listRanges GETs the collection', async () => {
    mockFetch(ok({ ranges: [{ id: 'r1', name: 'BTN open', keys: ['AA'] }] }));
    const res = await listRanges();
    const [url, opts] = lastCall();
    expect(url).toBe('/api/ranges');
    expect(opts.method).toBeUndefined();
    expect(opts.credentials).toBe('include');
    expect(res).toEqual({ ok: true, ranges: [{ id: 'r1', name: 'BTN open', keys: ['AA'] }] });
  });

  it('createRange POSTs the name and keys as json', async () => {
    mockFetch(ok({ range: { id: 'r1' } }));
    const res = await createRange({ name: 'BTN open', keys: ['AA', 'AKs'] });
    const [url, opts] = lastCall();
    expect(url).toBe('/api/ranges');
    expect(opts.method).toBe('POST');
    expect(opts.credentials).toBe('include');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual({ name: 'BTN open', keys: ['AA', 'AKs'] });
    expect(res).toEqual({ ok: true, range: { id: 'r1' } });
  });

  it('updateRange PATCHes just the given fields', async () => {
    await updateRange('r1', { name: 'CO open' });
    const [url, opts] = lastCall();
    expect(url).toBe('/api/ranges/r1');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ name: 'CO open' });
    await updateRange('r1', { keys: ['QQ'] });
    expect(JSON.parse(lastCall()[1].body)).toEqual({ keys: ['QQ'] });
  });

  it('deleteRange DELETEs the id path with no body', async () => {
    const res = await deleteRange('r1');
    const [url, opts] = lastCall();
    expect(url).toBe('/api/ranges/r1');
    expect(opts.method).toBe('DELETE');
    expect(opts.credentials).toBe('include');
    expect(opts.body).toBeUndefined();
    expect(res).toEqual({ ok: true });
  });

  it('encodes a hostile id into the path', async () => {
    await updateRange('../admin?x=1', { name: 'n' });
    expect(lastCall()[0]).toBe('/api/ranges/..%2Fadmin%3Fx%3D1');
    await deleteRange('../admin?x=1');
    expect(lastCall()[0]).toBe('/api/ranges/..%2Fadmin%3Fx%3D1');
  });
});

describe('saved solve wrappers', () => {
  beforeEach(() => { mockFetch(ok({})); });

  it('listSolves GETs the collection', async () => {
    mockFetch(ok({ solves: [{ id: 's1' }] }));
    const res = await listSolves();
    expect(lastCall()[0]).toBe('/api/solves');
    expect(lastCall()[1].credentials).toBe('include');
    expect(res).toEqual({ ok: true, solves: [{ id: 's1' }] });
  });

  it('createSolve POSTs the name, config and summary as json', async () => {
    mockFetch(ok({ solve: { id: 's1' } }));
    const config = { board: [{ v: 'A', s: 's' }], spot: { pot: 20 } };
    const summary = { exploit: 0.42, sizes: 4 };
    const res = await createSolve({ name: 'River jam', config, summary });
    const [url, opts] = lastCall();
    expect(url).toBe('/api/solves');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual({ name: 'River jam', config, summary });
    expect(res).toEqual({ ok: true, solve: { id: 's1' } });
  });

  it('renameSolve PATCHes only the name', async () => {
    await renameSolve('s1', 'Turn probe');
    const [url, opts] = lastCall();
    expect(url).toBe('/api/solves/s1');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ name: 'Turn probe' });
  });

  it('deleteSolve DELETEs the id path with no body', async () => {
    const res = await deleteSolve('s1');
    const [url, opts] = lastCall();
    expect(url).toBe('/api/solves/s1');
    expect(opts.method).toBe('DELETE');
    expect(opts.body).toBeUndefined();
    expect(res).toEqual({ ok: true });
  });

  it('encodes a hostile id into the path', async () => {
    await renameSolve('a/b c', 'n');
    expect(lastCall()[0]).toBe('/api/solves/a%2Fb%20c');
    await deleteSolve('a/b c');
    expect(lastCall()[0]).toBe('/api/solves/a%2Fb%20c');
  });
});

describe('library error normalisation', () => {
  it('surfaces a limit_reached refusal with its cap and plan', async () => {
    mockFetch(bad(403, { error: 'Free accounts keep 3 saved ranges.', code: 'limit_reached', cap: 3, plan: 'free' }));
    expect(await createRange({ name: 'n', keys: ['AA'] })).toEqual({
      ok: false, status: 403, error: 'Free accounts keep 3 saved ranges.', code: 'limit_reached', cap: 3, plan: 'free',
    });
  });

  it('reports a 401 with the server message', async () => {
    mockFetch(bad(401, { error: 'Sign in required' }));
    expect(await listSolves()).toMatchObject({ ok: false, status: 401, error: 'Sign in required' });
  });

  it('reports a rejected fetch as a status-0 network error for every wrapper', async () => {
    mockFetch(() => { throw new TypeError('Failed to fetch'); });
    for (const call of [
      () => listRanges(),
      () => createRange({ name: 'n', keys: [] }),
      () => updateRange('r1', { name: 'n' }),
      () => deleteRange('r1'),
      () => listSolves(),
      () => createSolve({ name: 'n', config: {}, summary: {} }),
      () => renameSolve('s1', 'n'),
      () => deleteSolve('s1'),
    ]) {
      expect(await call()).toEqual({ ok: false, status: 0, error: 'Network error' });
    }
  });
});
