// fetch wrapper for /api: { ok: true, ...json } or { ok: false, status, error, code }
export async function apiCall(url, opts) {
  try {
    const r = await fetch(url, { credentials: 'include', ...opts });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: data.error || `Request failed (${r.status})`, code: data.code, cap: data.cap, plan: data.plan };
    return { ok: true, ...data };
  } catch {
    return { ok: false, status: 0, error: 'Network error' };
  }
}

export const jsonBody = (body) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
