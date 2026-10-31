// Tiny API client for the command-line tools (Node 22+, no dependencies). Keeps the session cookie and the CSRF token.
export function apiClient(base) {
  base = base.replace(/\/+$/, ''); let cookie = ''; let csrf = '';
  async function call(method, path, body) {
    const headers = {}; let payload;
    if (body instanceof FormData) payload = body; else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    if (cookie) headers.cookie = cookie; if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
    const res = await fetch(`${base}/api${path}`, { method, headers, body: payload });
    const set = res.headers.getSetCookie?.() ?? []; if (set.length) cookie = set.map(c => c.split(';')[0]).join('; ');
    let data = null; try { data = await res.json(); } catch { /* not json */ }
    if (!res.ok) { const e = new Error(`${method} ${path} -> ${res.status} ${data?.error ?? ''}`.trim()); e.status = res.status; throw e; }
    return data;
  }
  return { get: p => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b), del: p => call('DELETE', p),
    async login(email, password) { const d = await call('POST', '/auth/login', { email, password }); csrf = d.csrf; return d; },
    setCsrf: t => { csrf = t; } };
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
