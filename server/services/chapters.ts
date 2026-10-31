import { tokens } from './retrieval';

/**
 * Finds a book's chapters (lessons) from its printed contents page.
 *
 * A contents page lists "title … printed page number". We (1) find the contents pages near the front, (2) read the entries, (3) work out the offset
 * between printed page numbers and PDF page numbers by checking where the titles really appear, (4) keep entries that are consistent with that
 * (page numbers must increase), and (5) give each chapter an end page. Books with no contents page get no chapters — nothing is invented.
 */
export type Chapter = { title: string; startPage: number; endPage: number; verified: boolean };
export type PageText = { page: number; text: string };

const TOC_WORDS = /contents|table of contents|பொருளடக்கம்|உள்ளடக்கம்|பொருள்\s*அடக்கம்|பொருளடக்கம்/i;
const MONTHS = /^(?:ஜூன்|ஜூலை|ஆகஸ்ட்|செப்டம்பர்|அக்டோபர்|நவம்பர்|டிசம்பர்|ஜனவரி|பிப்ரவரி|மார்ச்|ஏப்ரல்|மே|june|july|august|september|october|november|december|january|february|march|april|may)[,.]?$/i;
const NOISE_ONLY = /^[^\p{L}]*$/u; // no letters at all
/** Tamil digits (௦-௯) to ASCII, since OCR sometimes returns them. */
const asciiDigits = (s: string) => s.replace(/[௦-௯]/g, c => String(c.charCodeAt(0) - 0x0BE6));

/** Entries "title … number" found on contents pages. Page numbers are printed ones. */
export function parseContents(text: string): { title: string; printed: number }[] {
  const out: { title: string; printed: number }[] = [];
  for (const raw of asciiDigits(text).split(/\n+/)) {
    let line = raw.replace(/(?:[.·…_]\s*){2,}/g, ' ').replace(/[*†‡]+/g, ' ').replace(/\s+/g, ' ').trim(); if (line.length < 4 || NOISE_ONLY.test(line)) continue;
    // drop month names that sit after the number
    const words = line.split(' '); while (words.length > 2 && MONTHS.test(words[words.length - 1])) words.pop(); line = words.join(' ');
    // the last number, then at most two stray tokens (a month, a unit name, OCR specks)
    const m = line.match(/^(.*[\p{L}\p{M})”’"'])\s+(\d{1,3})(?:\s+\S{1,14}){0,2}$/u); if (!m) continue;
    const title = m[1].replace(/^\d{1,2}[.)]?\s+(?=\p{L})/u, '').trim(); const printed = Number(m[2]);
    if (title.length < 3 || !/\p{L}/u.test(title) || printed < 1) continue;
    out.push({ title, printed });
  }
  return out;
}

const head = (t: string, n = 500) => t.replace(/\s+/g, ' ').trim().slice(0, n);
/** Does this PDF page look like the start of the titled lesson? Two shared words, one long specific word, or — for a one-word title — that word right at the top of the page. */
function opens(pageText: string | undefined, title: string) {
  if (!pageText) return false; const first = tokens(head(pageText)); const pt = new Set(first); const tt = [...new Set(tokens(title))]; if (!tt.length) return false;
  const near = (t: string, ps: Iterable<string>) => [...ps].some(p => p === t || (p.length >= 4 && t.length >= 4 && (p.startsWith(t) || t.startsWith(p))));
  const shared = tt.filter(t => near(t, pt));
  if (shared.length >= 2 || shared.some(t => [...t].length >= 6)) return true;
  return tt.length === 1 && shared.length === 1 && near(tt[0], first.slice(0, 12));
}

export function detectChapters(pages: PageText[], pageCount = Math.max(0, ...pages.map(p => p.page))): Chapter[] {
  const by = new Map(pages.map(p => [p.page, p.text])); const front = Math.min(pageCount, Math.max(12, Math.ceil(pageCount * 0.12)));
  // contents pages: the first with a contents heading, plus following pages that are mostly entries
  const tocPages: number[] = []; for (let p = 1; p <= front; p++) { const t = by.get(p) ?? ''; if (TOC_WORDS.test(head(t, 200)) || (tocPages.length && parseContents(t).length >= 5 && p === tocPages[tocPages.length - 1] + 1)) tocPages.push(p); }
  if (!tocPages.length) return [];
  const entries = tocPages.flatMap(p => parseContents(by.get(p) ?? '')); if (entries.length < 3) return [];
  // offset between printed and PDF page numbers: the one under which most titles are found opening their page
  let best = { off: 0, score: -1 };
  for (let off = -2; off <= Math.min(40, pageCount); off++) { const score = entries.filter(e => opens(by.get(e.printed + off), e.title)).length; if (score > best.score) best = { off, score }; }
  if (best.score < Math.max(2, Math.floor(entries.length * 0.25))) return []; // the titles do not line up with any offset: do not guess
  // keep entries inside the book, then the largest set whose pages increase (an OCR-misread number would break the order); verified ones weigh double
  const cand = entries.map(e => ({ title: e.title, page: e.printed + best.off, verified: opens(by.get(e.printed + best.off), e.title) })).filter(e => e.page >= 1 && e.page <= pageCount && !tocPages.includes(e.page));
  const w = (e: { verified: boolean }) => (e.verified ? 2 : 1); const score: number[] = [], prev: number[] = [];
  for (let i = 0; i < cand.length; i++) { score[i] = w(cand[i]); prev[i] = -1; for (let j = 0; j < i; j++) if (cand[j].page <= cand[i].page && score[j] + w(cand[i]) > score[i]) { score[i] = score[j] + w(cand[i]); prev[i] = j; } }
  let end = 0; for (let i = 1; i < cand.length; i++) if (score[i] > score[end]) end = i;
  const chain: typeof cand = []; for (let i = cand.length ? end : -1; i >= 0; i = prev[i]) chain.unshift(cand[i]);
  const kept: typeof cand = []; for (const e of chain) { const l = kept[kept.length - 1]; if (l && l.page === e.page) { if (e.verified && !l.verified) kept[kept.length - 1] = e; } else kept.push(e); } // two entries on one page: keep the better one
  return kept.map((c, i) => ({ title: c.title, startPage: c.page, endPage: (kept[i + 1]?.page ?? pageCount + 1) - 1, verified: c.verified })).filter(c => c.endPage >= c.startPage);
}
