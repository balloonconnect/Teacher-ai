const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
/** Shared by the browser and the server: Tamil text hygiene and chunking for speech. */
/** Unicode NFC, no zero-width or control characters (stray ZWNJ after a pulli is a common copy-paste artefact), tidy spaces; paragraph breaks and punctuation are kept. */
export function normalizeTamil(s: string): string {
  return String(s ?? '').normalize('NFC').replace(ZERO_WIDTH, '').replace(CONTROL, '').replace(/\r\n?/g, '\n').replace(/[ \t\u00A0]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
/** Splits long text into chunks of at most `max` characters at sentence ends (Tamil full stop, ?, !, newline), then at commas/spaces; never mid-word. */
export function chunkText(text: string, max = 280): string[] {
  const parts = normalizeTamil(text).split(/(?<=[.!?।])\s+|\n+/).map(s => s.trim()).filter(Boolean); const out: string[] = []; let cur = '';
  const push = (s: string) => { if (s) out.push(s); };
  for (const p of parts) {
    if (p.length > max) { push(cur); cur = ''; let rest = p; while (rest.length > max) { let cut = rest.lastIndexOf(', ', max - 2); if (cut < max * 0.4) cut = rest.lastIndexOf(' ', max - 1); const at = cut < 1 ? max : cut + 1; push(rest.slice(0, at).trim()); rest = rest.slice(at).trim(); } cur = rest; continue; }
    if ((cur + ' ' + p).trim().length > max) { push(cur); cur = p; } else cur = (cur + ' ' + p).trim();
  }
  push(cur); return out;
}
