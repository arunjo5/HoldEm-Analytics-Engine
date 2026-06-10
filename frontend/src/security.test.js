// CSP/security-header regression checks for frontend/vercel.json, the inline
// script in index.html, and backend/vercel.json.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const html = read('../index.html');
const feVercel = JSON.parse(read('../vercel.json'));
const beVercel = JSON.parse(read('../../backend/vercel.json'));

const headerMap = (vercel) => {
  const rule = (vercel.headers || []).find((r) => r.source === '/(.*)');
  expect(rule).toBeDefined();
  return Object.fromEntries(rule.headers.map(({ key, value }) => [key, value]));
};

describe('frontend CSP inline-script hash', () => {
  it('has exactly one inline script for the CSP hash to cover', () => {
    const inlineTags = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)];
    expect(inlineTags).toHaveLength(1);
  });

  it('script-src pins the sha256 of the inline theme script body', () => {
    const body = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const hash = createHash('sha256').update(body, 'utf8').digest('base64');
    const csp = headerMap(feVercel)['Content-Security-Policy'];
    expect(csp).toContain(`script-src 'self' 'sha256-${hash}'`);
  });
});

describe('frontend vercel.json', () => {
  it('parses and rewrites /api/* to the pokerlab backend', () => {
    expect(() => JSON.parse(read('../vercel.json'))).not.toThrow();
    const rw = feVercel.rewrites.find((r) => r.source === '/api/:path*');
    expect(rw.destination).toBe('https://pokerlab-backend.vercel.app/api/:path*');
  });

  it('keeps the hardening headers on every path', () => {
    const h = headerMap(feVercel);
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains; preload');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()');
  });

  it('locks down the CSP fetch directives', () => {
    const csp = headerMap(feVercel)['Content-Security-Policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });
});

describe('backend vercel.json', () => {
  it('keeps its security headers', () => {
    const h = headerMap(beVercel);
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Content-Security-Policy']).toBe("frame-ancestors 'none'");
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains; preload');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()');
  });
});
