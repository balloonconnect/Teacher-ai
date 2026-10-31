import { PATTERNS, TA } from './ta';

/**
 * Pure-Tamil mode. The interface is written in English; when the student picks தமிழ், every visible English phrase is replaced with its Tamil
 * from the dictionary in ta.ts (exact phrases, plus patterns for phrases with numbers or names). Anything not in the dictionary stays as it is,
 * and `npm test` has an audit that fails when an English phrase is still visible on a student screen in Tamil mode.
 */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const cache = new Map<string, string | null>();
function one(s: string): string | null {
  const hit = TA[s]; if (hit !== undefined) return hit;
  for (const [re, f] of PATTERNS) { const m = re.exec(s); if (m) return f(m, tr); }
  return null;
}
/** Translates a phrase; returns null when there is nothing to translate (already Tamil, a number, a name…). */
export function translate(text: string): string | null {
  const key = norm(text); if (!key || !/[A-Za-z]{2}/.test(key)) return null;
  if (cache.has(key)) return cache.get(key)!;
  let out = one(key);
  if (out === null && key.includes(' · ')) { // "Class 8 · English medium · 2026–2027": translate the parts that have a translation
    const parts = key.split(' · '); const t = parts.map(p => (/[A-Za-z]{2}/.test(p) ? one(p) ?? p : p)); if (t.some((p, i) => p !== parts[i])) out = t.join(' · ');
  }
  if (cache.size > 4000) cache.clear(); cache.set(key, out); return out;
}
/** Like translate() but returns the input when there is no translation (used inside patterns). */
export const tr = (s: string) => translate(s) ?? s;
