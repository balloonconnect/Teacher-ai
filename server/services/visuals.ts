import { validateUrlSyntax, isPrivateIp, UrlError } from './ssrf';
import net from 'node:net';
import type { Visual } from '../../shared/visuals';

/**
 * Seam for external image sources (textbook illustrations, licensed repositories, AI-generated images).
 * NONE is implemented: the app only serves original SVG diagrams drawn in code (shared/visuals.ts).
 * A future provider must return `Visual`s whose `url` passes `safeImageUrl`, with real licence and attribution text.
 */
export interface ImageProvider { name: string; priority: 1 | 2 | 4; find(q: { text: string; classLevel: number; subjectId: string | null }): Promise<Visual[]>; }
export const imageProviders: ImageProvider[] = [];

/**
 * Validates an image URL before it is ever stored, shown or fetched: https only, no credentials or odd ports,
 * no IP literals or private/loopback addresses, and the host must be on the operator's allow-list (VISUAL_IMAGE_HOSTS).
 * DNS is not resolved here, so a fetcher must also use the pinned-IP `safeFetch` approach before downloading.
 */
export function safeImageUrl(raw: string, allowHosts: string[] = (process.env.VISUAL_IMAGE_HOSTS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)): URL {
  const u = validateUrlSyntax(raw);
  if (u.protocol !== 'https:') throw new UrlError('Images must use https.');
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIP(h)) { if (isPrivateIp(h)) throw new UrlError('This address is not allowed.'); throw new UrlError('Images must come from a named, approved host.'); }
  if (!allowHosts.some(a => h === a || h.endsWith('.' + a))) throw new UrlError('This image host is not on the approved list.');
  return u;
}
