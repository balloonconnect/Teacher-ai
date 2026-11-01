import { Router } from 'express';
import { createHash } from 'node:crypto';
import { normalizeKey, renderSvg, VISUAL_IDS, Lng } from '../../shared/visuals';

/** Serves the original SVG diagrams. Public content (no student data), validated parameters, cacheable. */
export function visualRoutes() {
  const r = Router(); const cache = new Map<string, { svg: string; etag: string }>();
  r.get('/svg/:id', (req, res) => {
    const k = normalizeKey({ id: req.params.id, hl: req.query.hl, lvl: req.query.lvl, p: req.query.p });
    const lng = String(req.query.lang ?? 'both') as Lng;
    if (!k || !VISUAL_IDS.includes(k.id) || !['en', 'ta', 'both'].includes(lng)) { res.status(404).json({ error: 'That diagram is not available.' }); return; }
    const ck = JSON.stringify([k, lng]); let hit = cache.get(ck);
    if (!hit) { const svg = renderSvg(k, lng); if (!svg) { res.status(404).json({ error: 'That diagram is not available.' }); return; } hit = { svg, etag: `"${createHash('sha1').update(svg).digest('hex').slice(0, 16)}"` }; if (cache.size > 500) cache.clear(); cache.set(ck, hit); }
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8'); res.setHeader('Cache-Control', 'public, max-age=3600'); res.setHeader('ETag', hit.etag);
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'"); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers['if-none-match'] === hit.etag) { res.status(304).end(); return; }
    res.send(hit.svg);
  });
  return r;
}
