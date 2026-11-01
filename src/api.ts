import { PREVIEW, previewApi, PErr } from './preview';
let csrf = '';
export const setCsrf = (t: string) => { csrf = t; };
export const getCsrf = () => csrf;
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  if (PREVIEW) { try { return await previewApi(method, url, body) as T; } catch (e) { if (e instanceof PErr) throw new ApiError(e.status, e.message); throw e; } }
  const headers: Record<string, string> = {}; let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body; else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
  // Unreliable networks: every request has a timeout; safe GETs retry twice with a short back-off. Writes are never retried automatically.
  const ms = method === 'GET' ? 15000 : 45000; const tries = method === 'GET' ? 3 : 1; let res: Response | undefined;
  for (let i = 0; i < tries && !res; i++) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
    try { res = await fetch(`/api${url}`, { method, headers, body: payload, credentials: 'same-origin', signal: ac.signal }); }
    catch { if (i < tries - 1) await new Promise(r => setTimeout(r, 600 * (i + 1))); }
    finally { clearTimeout(t); }
  }
  if (!res) throw new ApiError(0, typeof navigator !== 'undefined' && navigator.onLine === false ? 'You are offline. Reconnect and try again.' : 'Cannot reach the server or it is too slow. Check your connection and try again.');
  let data: any = null; const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('json')) { try { data = await res.json(); } catch { /* ignore */ } }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? (res.status >= 500 ? 'Something went wrong on our side. Please try again.' : 'Request failed.'));
  return data as T;
}
export const get = <T = any>(u: string) => api<T>('GET', u);
export const post = <T = any>(u: string, b?: unknown) => api<T>('POST', u, b ?? {});
export const put = <T = any>(u: string, b?: unknown) => api<T>('PUT', u, b ?? {});
export const patch = <T = any>(u: string, b?: unknown) => api<T>('PATCH', u, b ?? {});
export const del = <T = any>(u: string) => api<T>('DELETE', u);
export const msg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
