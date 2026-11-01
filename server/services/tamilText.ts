
/**
 * Text hygiene for Tamil (and mixed Tamil/English) content. Used on book text, user text and model output.
 * It never rewrites words: it normalises encoding, removes printing furniture and measures how trustworthy a line is.
 */
/** Ill-formed Tamil sequences per 100 Tamil characters. */
export function illFormedTamil(t: string) {
  const tam = (t.match(/[\u0B80-\u0BFF]/g) ?? []).length || 1;
  const n = (t.match(/\uFFFD|(?:^|[\s\p{P}\d])[\u0BBE-\u0BCD]|[\u0BBE-\u0BCD]{3,}|[\u0BC6-\u0BC8][\u0BBE-\u0BCD]|்்/gu) ?? []).length;
  return (n / tam) * 100;
}
const TAMIL_RANGE = /[஀-௿]/g;

export { normalizeTamil, chunkText } from '../../shared/tamil';
import { normalizeTamil } from '../../shared/tamil';
export const tamilCount = (s: string) => (s.match(TAMIL_RANGE) ?? []).length;
export const tamilShare = (s: string) => { const letters = (s.match(/[\p{L}\p{M}]/gu) ?? []).length; return letters ? tamilCount(s) / letters : 0; };
export const hasTamil = (s: string) => tamilCount(s) > 0;

/** Lines that are print-production furniture, not teaching text (e.g. "8th Std Tamil CBSE - Unit 2.indd 27 … 23-01-2025 16:50:14"). */
export function isFurniture(line: string): boolean {
  const t = line.trim();
  return /\.(indd|qxd|pdf)\b/i.test(t) || /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{4}\s+\d{1,2}:\d{2}(:\d{2})?\b/.test(t) || /^[\s\d\p{P}]*$/u.test(t) || (/^[—–-]\s*[^\p{L}]*[A-Za-z&”"' ]{1,12}[^\p{L}]*\s*[—–-]$/u.test(t) && !hasTamil(t));
}

/** Is this line a trustworthy reading? Tamil lines must be well-formed Tamil; a line of stray Latin letters or malformed vowel signs is OCR noise. */
export function isCleanLine(line: string): boolean {
  const t = line.trim(); if (isFurniture(t)) return false;
  const words = t.split(/\s+/).filter(Boolean); if (!words.length) return false;
  if (!hasTamil(t)) return /[A-Za-z]{3}/.test(t) && !/[|@#~^]/.test(t); // an English line is fine when it looks like words
  if (illFormedTamil(t) > 3) return false;
  const latinWords = words.filter(w => /^[A-Za-z]{1,6}$/.test(w)).length; if (latinWords / words.length > 0.2 && tamilShare(t) < 0.9) return false;
  const stray = words.filter(w => tamilCount(w) === 1 && w.length === 1).length; if (stray > 1 && words.length < 8) return false;
  return true;
}
export type Cleaned = { text: string; kept: number; dropped: number; quality: number };
/** Keeps the clean lines of a block of text. `quality` is the share of non-empty lines kept (1 = nothing looked like noise). */
export function cleanLines(text: string): Cleaned {
  const lines = normalizeTamil(text).split('\n').map(l => l.trim()).filter(Boolean); let kept = 0; const out: string[] = [];
  for (const l of lines) { if (isCleanLine(l)) { out.push(l); kept++; } }
  return { text: out.join('\n'), kept, dropped: lines.length - kept, quality: lines.length ? kept / lines.length : 0 };
}

/** Words/numbers that a correction or translation to the same language must not change: digits, Latin words (names, units), currency amounts. */
export function protectedTokens(s: string): string[] {
  const digits = (s.replace(/[௦-௯]/g, c => String(c.charCodeAt(0) - 0x0BE6)).match(/\d[\d,.:/-]*\d|\d/g) ?? []).map(x => x.replace(/[,.:/-]+$/, ''));
  const latin = s.match(/[A-Za-z][A-Za-z0-9@._-]{1,}/g) ?? [];
  return [...new Set([...digits, ...latin.map(x => x.toLowerCase())])];
}
/** Returns the protected tokens of `source` that are missing from `result` (so a "grammar fix" cannot silently drop a date, amount or name). */
export function missingProtected(source: string, result: string): string[] {
  const out = result.replace(/[௦-௯]/g, c => String(c.charCodeAt(0) - 0x0BE6)).toLowerCase().replace(/,/g, '');
  return protectedTokens(source).filter(t => !out.includes(t.toLowerCase().replace(/,/g, '')));
}

