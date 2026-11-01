import { lookup } from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { BRAND } from '../../shared/brand';

export class UrlError extends Error { name = 'UrlError'; }
/** True for loopback, private, link-local, CGNAT, multicast, reserved and unspecified addresses (v4 + v6). */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::' || l.startsWith('fe8') || l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb') || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('ff')) return true;
    const m = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (m) return isPrivateIp(m[1]);
    return false;
  }
  const p = ip.split('.').map(Number); if (p.length !== 4 || p.some(n => !(n >= 0 && n <= 255))) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
export function validateUrlSyntax(raw: string): URL {
  let u: URL; try { u = new URL(raw); } catch { throw new UrlError('That does not look like a valid web address.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new UrlError('Only http and https links are supported.');
  if (u.username || u.password) throw new UrlError('Links with embedded credentials are not allowed.');
  if (u.port && !['80', '443'].includes(u.port)) throw new UrlError('Only standard web ports are allowed.');
  if (u.hostname === 'localhost' || u.hostname.endsWith('.local') || u.hostname.endsWith('.internal')) throw new UrlError('This address is not allowed.');
  return u;
}
async function resolveSafe(host: string): Promise<string> {
  const h = host.replace(/^\[|\]$/g, '');
  if (net.isIP(h)) { if (isPrivateIp(h)) throw new UrlError('This address is not allowed.'); return h; }
  const addrs = await lookup(h, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new UrlError('This address is not allowed.');
  return addrs[0].address;
}
const MAX_BYTES = 1_500_000, TIMEOUT = 8000;
export type Fetched = { url: string; contentType: string; body: string };
/** Fetches a public page: validates scheme/port, pins the DNS-validated IP, re-validates every redirect, limits size and time. */
export async function safeFetch(raw: string, hops = 0): Promise<Fetched> {
  if (hops > 3) throw new UrlError('Too many redirects.');
  const u = validateUrlSyntax(raw); const ip = await resolveSafe(u.hostname);
  return new Promise<Fetched>((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({ host: u.hostname.replace(/^\[|\]$/g, ''), port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: 'GET', servername: u.hostname, headers: { 'user-agent': `${BRAND.botName}/1.0 (+educational reader)`, accept: 'text/html,text/plain;q=0.9' }, timeout: TIMEOUT,
      lookup: (_h: string, _o: any, cb: any) => cb(null, ip, net.isIPv6(ip) ? 6 : 4) } as any, async res => {
      const loc = res.headers.location;
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) { res.resume(); await safeFetch(new URL(loc, u).toString(), hops + 1).then(resolve, reject); return; }
      if (!res.statusCode || res.statusCode >= 400) { res.resume(); return reject(new UrlError(`The website responded with an error (${res.statusCode}).`)); }
      const ct = String(res.headers['content-type'] ?? '');
      if (!/^text\/(html|plain)|application\/xhtml/i.test(ct)) { res.resume(); return reject(new UrlError('Only web pages and plain text can be read (not PDFs, videos or downloads).')); }
      const parts: Buffer[] = []; let n = 0;
      res.on('data', (c: Buffer) => { n += c.length; if (n > MAX_BYTES) { req.destroy(); reject(new UrlError('The page is too large to read.')); } else parts.push(c); });
      res.on('end', () => resolve({ url: u.toString(), contentType: ct, body: Buffer.concat(parts).toString('utf8') }));
    });
    req.on('timeout', () => { req.destroy(); reject(new UrlError('The website took too long to respond.')); });
    req.on('error', e => reject(e instanceof UrlError ? e : new UrlError('Could not reach that website.')));
    req.end();
  });
}
const ent: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
export function htmlToText(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '';
  const t = html.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, m => ent[m]).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return { title: title.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, m => ent[m]), text: t };
}
