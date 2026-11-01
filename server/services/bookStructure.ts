import { isCleanLine, isFurniture, normalizeTamil } from './tamilText';

/**
 * Reads the structure of one textbook chapter from its page text: which parts are poems, Thirukkural couplets, prose,
 * glossaries, questions and so on, and the numbered items inside them, in the book's own order.
 *
 * It is extractive and conservative. Everything an item holds is the book's own text (as read by OCR). Nothing is invented:
 * a number that was misread, a couplet of the wrong length, a question without its options, a line that looks like OCR noise,
 * all become *flags* on the item so the screen can say "check the printed page" instead of guessing.
 *
 * The section markers below are the vocabulary of the Class 8 Tamil book. Other books can add markers to MARKERS.
 */
export type Role = 'objectives' | 'intro' | 'author' | 'poem' | 'prose' | 'grammar' | 'glossary' | 'meaning' | 'devices' | 'activities' | 'qgroup' | 'language' | 'proverb' | 'idiom' | 'writing' | 'body';
export type Kind = 'couplet' | 'poem' | 'stanza' | 'heading' | 'paragraph' | 'word' | 'meaning' | 'device' | 'question' | 'objective' | 'note';
export type QType = 'mcq' | 'fill' | 'match' | 'very_short' | 'short' | 'long' | 'thinking' | 'activity';
export type Item = {
  id: string; ord: number; kind: Kind; section: Role; page: number;
  number?: string; numberRead?: string; group?: string; title?: string; by?: string;
  lines: string[]; meaning?: string[]; device?: string; parent?: string;
  word?: { term: string; meaning: string };
  question?: { type: QType; category?: string; options?: string[] };
  flags: string[]; uncertain?: number[];
};
export type Segment = { id: string; role: Role; heading: string; page: number; itemIds: string[] };
export type Structure = { version: 1; template: 'kural' | 'poem' | 'prose' | 'grammar' | 'qa' | 'mixed'; segments: Segment[]; items: Item[]; flags: string[] };

// Leading OCR junk (stray letters and symbols before a heading) is ignored when matching a marker.
const lead = (s: string) => s.replace(/^[^஀-௿]+/, '').replace(/^(?:[஀-௿]{1,2}\s+)+(?=\S{4,})/u, (m) => (/கற்பவை|நுழையும்|சிறுவினா|குறுவினா|நெடுவினா/.test(m) ? '' : m)).trim();
export const MARKERS: [RegExp, Role, string][] = [
  [/^கற்றல்\s*நோக்கங்கள்/, 'objectives', 'Learning objectives'],
  [/^நுழையும்\s*முன்/, 'intro', 'Before you begin'],
  [/^நூல்\s*(?:வெளி|வளி|வ\S{1,2}ி)\s*$/, 'author', 'About the author or book'],
  [/^கவிதைப்\s*பேழை/, 'poem', 'Poem'],
  [/^(?:உரைநடை\s*உலகம்|விரிவானம்)/, 'prose', 'Prose'],
  [/^கற்கண்டு/, 'grammar', 'Grammar'],
  [/^சொல்லும்\s*\S*ளும்\s*$/, 'glossary', 'Word meanings'],
  [/^பாடலின்\s*\S+ள்\s*$/, 'meaning', 'Meaning of the poem (textbook)'],
  [/^கற்பவை\s*கற்றபின்/, 'activities', 'Exercises'],
  [/^பழமொழி(?:கள்)?\s*$/, 'proverb', 'Proverbs'],
  [/^மரபுத்\s*தொடர்(?:கள்)?\s*$/, 'idiom', 'Idioms'],
  [/^(?:கடிதம்|கட்டுரை|படைப்பாக்கம்)(?:\s*எழுதுக)?\s*$/, 'writing', 'Writing'],
  [/^(?:மொழியை\s*ஆள்வோம்|அம்\s*மொழியோடு\s*விளையாடு|அறிந்து\s*பயன்படுத்துவோம்)/, 'language', 'Language activities'],
];
const QGROUPS: [RegExp, QType, string][] = [
  [/^குறுவினா\s*$/, 'very_short', 'குறுவினா'], [/^சிறுவினா\s*$/, 'short', 'சிறுவினா'], [/^நெடுவினா\s*$/, 'long', 'நெடுவினா'], [/^சிந்தனை\s*வினா\s*$/, 'thinking', 'சிந்தனை வினா'],
  [/^பொருத்துக\.?\s*$/, 'match', 'பொருத்துக'], [/^கோடிட்ட\s*இடத்தை\s*நிரப்புக\.?\s*$/, 'fill', 'நிரப்புக'], [/^சரியான\s*விடையைத்?\s*தேர்ந்தெடுத்து\s*எழுதுக\.?\s*$/, 'mcq', 'சரியான விடை'],
];
const DEVICE = /^(எதுகை|மோனை|இயைபு|முரண்|அணி)\s*$/;
const NUM = /^[^\p{L}\p{N}]{0,3}([0-9௦-௯]{1,3})\s*[.)]{1,3}\s*(\S.*)$/u;
const digits = (s: string) => s.replace(/[௦-௯]/g, c => String(c.charCodeAt(0) - 0x0BE6));
const wordsOf = (s: string) => s.split(/\s+/).filter(Boolean);
const OPT = /(?:^|\s)(அ|ஆ|இ|ஈ|[AaBbCcDd]|FF|F)\)\s*/g;
const OPT_FIX: Record<string, string> = { A: 'அ', a: 'அ', B: 'ஆ', b: 'ஆ', C: 'இ', c: 'இ', D: 'ஈ', d: 'ஈ', F: 'ஈ', FF: 'ஈ' };

type Line = { t: string; page: number; blank?: boolean };
type Seg = { role: Role; heading: string; page: number; lines: Line[]; q?: { type: QType; cat: string } };

/** Splits the chapter's lines at the book's section markers. Blank lines are kept (they separate stanzas and paragraphs). */
function segment(pages: { page: number; text: string }[]): Seg[] {
  const segs: Seg[] = []; let cur: Seg = { role: 'body', heading: '', page: pages[0]?.page ?? 0, lines: [] };
  const open = (s: Seg) => { if (cur.lines.some(l => !l.blank) || cur.heading) segs.push(cur); cur = s; };
  for (const p of pages) {
    for (const raw of normalizeTamil(p.text).split('\n')) {
      const t = raw.trim();
      if (!t) { cur.lines.push({ t: '', page: p.page, blank: true }); continue; }
      if (isFurniture(t)) continue;
      const l = lead(t); const m = MARKERS.find(([re]) => re.test(l)); const qg = QGROUPS.find(([re]) => re.test(l));
      if (m) { open({ role: m[1], heading: l, page: p.page, lines: [] }); continue; }
      if (qg) { open({ role: 'qgroup', heading: l, page: p.page, lines: [], q: { type: qg[1], cat: qg[2] } }); continue; }
      if (DEVICE.test(l) && cur.role !== 'poem') { open({ role: 'devices', heading: l, page: p.page, lines: [] }); continue; }
      cur.lines.push({ t, page: p.page });
    }
  }
  open({ role: 'body', heading: '', page: 0, lines: [] }); return segs;
}

export function build(pages: { page: number; text: string }[], opts: { maxItems?: number } = {}): Structure {
  const items: Item[] = []; const segments: Segment[] = []; const max = opts.maxItems ?? 400;
  const add = (it: Omit<Item, 'id' | 'ord' | 'flags'> & { flags?: string[] }) => { if (items.length >= max) return undefined; const ord = items.length + 1; const item: Item = { flags: [], ...it, id: `i${ord}`, ord }; items.push(item); return item; };
  const flagLines = (item: Item) => { const u = item.lines.map((l, i) => (isCleanLine(l) ? -1 : i)).filter(i => i >= 0); if (u.length) { item.uncertain = u; item.flags.push('ocr_uncertain'); } };
  for (const s of segment(pages)) {
    const before = items.length; const body = s.lines;
    if (s.role === 'objectives') for (const l of body.filter(x => !x.blank)) add({ kind: 'objective', section: s.role, page: l.page, lines: [l.t.replace(/^[^\p{L}]+/u, '')] });
    else if (['author', 'intro', 'proverb', 'idiom', 'writing'].includes(s.role)) paragraphs(body, s.role, add, flagLines);
    else if (s.role === 'poem') poem(s, add, flagLines);
    else if (s.role === 'glossary') glossary(body, add);
    else if (s.role === 'meaning') for (const para of blocks(body)) { const it = add({ kind: 'meaning', section: 'meaning', page: para.page, lines: [para.lines.join(' ')] }); if (it) flagLines(it); }
    else if (s.role === 'devices') { const ls = body.filter(x => !x.blank); if (ls.length) { const it = add({ kind: 'device', section: 'devices', page: ls[0].page, title: s.heading, lines: ls.map(x => x.t) }); if (it) flagLines(it); } }
    else if (s.role === 'activities' || s.role === 'qgroup' || s.role === 'language') questions(s, add, flagLines);
    else { if (!couplets(s, add, flagLines)) paragraphs(body, s.role === 'grammar' ? 'grammar' : s.role === 'prose' ? 'prose' : 'body', add, flagLines); }
    const ids = items.slice(before).map(i => i.id); if (ids.length) segments.push({ id: `s${segments.length + 1}`, role: s.role, heading: s.heading, page: s.page, itemIds: ids });
  }
  checkSequence(items);
  const kinds = new Set(items.map(i => i.kind)); const flags: string[] = [];
  if (!items.length) flags.push('no_structure_found');
  if (items.length >= max) flags.push('truncated');
  const nc = items.filter(i => i.kind === 'couplet').length; if (nc && nc !== 10) flags.push(`couplets_found_${nc}`); // a Thirukkural chapter has 10 couplets; fewer means some were not read
  const template: Structure['template'] = kinds.has('couplet') ? 'kural' : kinds.has('poem') ? 'poem' : segments.some(s => s.role === 'grammar') ? 'grammar' : kinds.has('paragraph') ? (kinds.has('question') ? 'mixed' : 'prose') : kinds.has('question') ? 'qa' : 'mixed';
  return { version: 1, template, segments, items, flags };
}

/** Groups lines into blocks separated by blank lines. */
function blocks(lines: Line[]) {
  const out: { lines: string[]; page: number }[] = []; let cur: { lines: string[]; page: number } | null = null;
  for (const l of lines) { if (l.blank) { cur = null; continue; } if (!cur) { cur = { lines: [], page: l.page }; out.push(cur); } cur.lines.push(l.t); }
  return out;
}
type Adder = (it: any) => Item | undefined; type Flagger = (i: Item) => void;

function paragraphs(lines: Line[], section: Role, add: Adder, flag: Flagger) {
  const bl = blocks(lines); const short = (t: string) => t.length <= 40 && !/[.!?:;,]$/.test(t) && wordsOf(t).length <= 5;
  for (let i = 0; i < bl.length; i++) {
    const b = bl[i]; let ls = b.lines;
    // a short first line above more text is a heading of that text
    if (ls.length > 1 && short(ls[0]) && ls.slice(1).join(' ').length > 30) { const h = add({ kind: 'heading', section, page: b.page, lines: [ls[0]] }); if (h) flag(h); ls = ls.slice(1); }
    const text = ls.join(' ').replace(/\s+/g, ' ').trim(); if (text.length < 3) continue;
    const isHeading = ls.length === 1 && short(text) && i + 1 < bl.length;
    const it = add({ kind: isHeading ? 'heading' : 'paragraph', section, page: b.page, lines: [text] }); if (it) flag(it);
  }
}

function glossary(lines: Line[], add: Adder) {
  for (const l of lines.filter(x => !x.blank)) {
    const parts = l.t.split(/\s[-–—]\s/).map(s => s.trim()).filter(Boolean); if (parts.length < 2) continue;
    // "term - meaning nextterm - meaning": the middle pieces hold a meaning and the next term; a one-word term is assumed
    let term = parts[0];
    for (let i = 1; i < parts.length; i++) {
      const last = i === parts.length - 1; const w = wordsOf(parts[i]); let meaning = parts[i]; let next = '';
      const unsure = !last && w.length !== 2;
      if (!last) { if (w.length >= 2) { next = w[w.length - 1]; meaning = w.slice(0, -1).join(' '); } }
      add({ kind: 'word', section: 'glossary', page: l.page, lines: [`${term} - ${meaning}`], word: { term, meaning }, flags: unsure ? ['pair_split_unsure'] : [] });
      term = next;
    }
  }
}

function poem(s: Seg, add: Adder, flag: Flagger) {
  const bl = blocks(s.lines); if (!bl.length) return;
  // leading long blocks are the book's introduction to the poem; short lines are the poem
  let title = ''; let by = ''; const poemBlocks: { lines: string[]; page: number }[] = [];
  for (let b of bl) {
    // a short first line above longer text is the poem's title
    if (!title && !poemBlocks.length && b.lines.length > 1 && b.lines[0].length <= 40 && wordsOf(b.lines[0]).length <= 5 && b.lines.slice(1).some(x => x.length > 62)) { title = b.lines[0].replace(/^[^\p{L}]+/u, ''); b = { ...b, lines: b.lines.slice(1) }; }
    const first = b.lines[0]; const isPoetLine = /^[-–—]\s*\S/.test(b.lines[b.lines.length - 1] ?? '');
    const longProse = b.lines.some(x => x.length > 62) && !poemBlocks.length;
    if (longProse) { const it = add({ kind: 'note', section: 'poem', page: b.page, lines: [b.lines.join(' ')] }); if (it) flag(it); continue; }
    if (!title && b.lines.length === 1 && first.length <= 40 && !isPoetLine && !poemBlocks.length) { title = first.replace(/^[^\p{L}]+/u, ''); continue; }
    if (isPoetLine) { const last = b.lines[b.lines.length - 1]; by = last.replace(/^[-–—]\s*/, ''); const rest = b.lines.slice(0, -1); if (rest.length) poemBlocks.push({ lines: rest, page: b.page }); continue; }
    poemBlocks.push(b);
  }
  if (!poemBlocks.length && !title) return;
  const head = add({ kind: 'poem', section: 'poem', page: bl[0].page, title: title || s.heading, by: by || undefined, lines: [], flags: [] }); if (!head) return;
  poemBlocks.forEach((b, i) => {
    const st = add({ kind: 'stanza', section: 'poem', page: b.page, parent: head.id, number: String(i + 1), lines: b.lines });
    if (st) { flag(st); if (b.lines.length > 10 && poemBlocks.length === 1) st.flags.push('stanza_breaks_unclear'); }
  });
  if (!by) head.flags.push('poet_not_found');
}

/** Thirukkural-style numbered couplets, each followed by the book's own meaning ("பொருள் :") and optionally its figure of speech ("அணி :"). Returns false if the segment is not of that shape. */
function couplets(s: Seg, add: Adder, flag: Flagger): boolean {
  const ls = s.lines; const meaningAt = ls.map((l, i) => (!l.blank && /^[^\p{L}]{0,3}பொருள்\s*[:：]/u.test(l.t) ? i : -1)).filter(i => i >= 0);
  const numbered = ls.filter(l => !l.blank && NUM.test(l.t)).length; if (meaningAt.length < 3 || numbered < 3) return false;
  let i = 0; let group = ''; let expected = 1; const pre: Line[] = [];
  const isMeaning = (l: Line) => /^[^\p{L}]{0,3}பொருள்\s*[:：]/u.test(l.t); const isDevice = (l: Line) => /^[^\p{L}]{0,3}அணி\s*[:：]/u.test(l.t);
  // text before the first couplet is the chapter introduction
  while (i < ls.length && !(NUM.test(ls[i].t) && !ls[i].blank)) { pre.push(ls[i]); i++; }
  const lastPre = [...pre].reverse().find(x => !x.blank);
  if (lastPre && wordsOf(lastPre.t).length <= 4 && !/[.:;,!?]$/.test(lastPre.t)) { group = lastPre.t.replace(/^[^\p{L}]+/u, ''); pre.splice(pre.lastIndexOf(lastPre), 1); }
  paragraphs(pre, 'body', add, flag);
  while (i < ls.length) {
    const l = ls[i]; if (l.blank) { i++; continue; }
    const m = NUM.exec(l.t);
    if (!m) {
      // a short unnumbered line right before a numbered one is the chapter (athikaram) name
      const next = ls.slice(i + 1).find(x => !x.blank); if (next && NUM.test(next.t) && wordsOf(l.t).length <= 4 && !/[.:;,]$/.test(l.t)) group = l.t.replace(/^[^\p{L}]+/u, ''); i++; continue;
    }
    const read = digits(m[1]); const verse: string[] = [m[2]]; const page = l.page; i++;
    while (i < ls.length && !ls[i].blank && !isMeaning(ls[i]) && !NUM.test(ls[i].t) && verse.length < 3) { verse.push(ls[i].t); i++; }
    while (i < ls.length && ls[i].blank) i++;
    const meaning: string[] = []; let device = '';
    if (i < ls.length && isMeaning(ls[i])) { meaning.push(ls[i].t.replace(/^[^\p{L}]{0,3}பொருள்\s*[:：]\s*/u, '')); i++; while (i < ls.length && !ls[i].blank && !NUM.test(ls[i].t) && !isDevice(ls[i])) { meaning.push(ls[i].t); i++; } }
    if (i < ls.length && isDevice(ls[i])) { device = ls[i].t.replace(/^[^\p{L}]{0,3}அணி\s*[:：]\s*/u, '').replace(/[^\p{L}\p{M}\s.]+$/u, ''); i++; }
    const it = add({ kind: 'couplet', section: s.role, page, number: String(expected), group: group || undefined, lines: verse, meaning: meaning.length ? [meaning.join(' ').replace(/\s+/g, ' ')] : undefined, device: device || undefined });
    if (it) {
      if (read !== String(expected)) { it.numberRead = read; it.flags.push('number_misread'); }
      if (!meaning.length) it.flags.push('meaning_missing');
      const w = wordsOf(verse.join(' ')).length; if (!(verse.length === 2 && w >= 6 && w <= 8)) it.flags.push('shape_irregular'); // a kural is two lines, 4 + 3 feet
      flag(it); expected++;
    }
  }
  return true;
}

function questions(s: Seg, add: Adder, flag: Flagger) {
  let cat = s.q?.cat ?? ''; let type: QType = s.q?.type ?? 'activity'; let cur: Item | undefined; let pendingText: string[] = [];
  const instr = (t: string) => QGROUPS.find(([re]) => re.test(t));
  const finishPending = () => { if (pendingText.length) { cur = add({ kind: 'question', section: s.role, page: s.page, lines: [pendingText.join(' ')], question: { type: type === 'activity' ? 'activity' : type, category: cat || undefined } }); if (cur) flag(cur); pendingText = []; } };
  for (const l of s.lines) {
    if (l.blank) { if (!(cur && cur.question?.type === 'mcq')) finishPending(); continue; }
    const g = instr(l.t.replace(/^[^\p{L}]+/u, '')); if (g) { finishPending(); cat = g[2]; type = g[1]; cur = undefined; continue; }
    const hasOpt = /(?:^|\s)(?:அ|ஆ|இ|ஈ|[AaBbCcDd]|FF|F)\)\s*\S/.test(l.t);
    if (hasOpt && cur) { const o = options(l.t); cur.question!.options = [...(cur.question!.options ?? []), ...o]; if (cur.question!.type !== 'mcq') cur.question!.type = 'mcq'; flag(cur); continue; }
    const m = NUM.exec(l.t);
    if (m) {
      finishPending(); const num = digits(m[1]);
      const isMatch = type === 'match'; const qt: QType = isMatch ? 'match' : /_{3,}|கோடிட்ட/.test(m[2]) ? 'fill' : type;
      cur = add({ kind: 'question', section: s.role, page: l.page, number: num, lines: [m[2]], question: { type: qt, category: cat || undefined } }); if (cur) flag(cur); continue;
    }
    if (cur && cur.question && !hasOpt && cur.lines.length < 6 && /^\p{L}/u.test(l.t) && cur.number) { cur.lines.push(l.t); flag(cur); continue; } // wrapped line of a numbered question
    cur = undefined; pendingText.push(l.t);
  }
  finishPending();
}
function options(line: string): string[] {
  const idx: { i: number; k: string; end: number }[] = []; OPT.lastIndex = 0; let m: RegExpExecArray | null;
  while ((m = OPT.exec(line))) idx.push({ i: m.index, k: OPT_FIX[m[1]] ?? m[1], end: m.index + m[0].length });
  return idx.map((x, n) => `${x.k}) ${line.slice(x.end, idx[n + 1]?.i ?? line.length).trim()}`);
}

/** Questions and couplets keep their original numbers; an item whose number does not follow the previous one is flagged, never silently renumbered. */
function checkSequence(items: Item[]) {
  let prev = 0; let sec = '';
  for (const it of items.filter(i => i.kind === 'question' && i.number)) {
    const key = `${it.section}:${it.question?.category ?? ''}`; if (key !== sec) { prev = 0; sec = key; }
    const n = Number(it.number); if (n !== prev + 1 && !it.flags.includes('number_misread')) it.flags.push('number_out_of_order'); prev = n;
  }
  for (const it of items.filter(i => i.kind === 'question' && i.question?.type === 'mcq')) if ((it.question!.options ?? []).length !== 4 && !it.flags.includes('options_incomplete')) it.flags.push('options_incomplete');
}

export const ROLE_LABEL: Record<Role, [string, string]> = {
  objectives: ['Learning objectives', 'கற்றல் நோக்கங்கள்'], intro: ['Before you begin', 'நுழையும்முன்'], author: ['About the author or book', 'நூல் வெளி'], poem: ['Poem', 'கவிதைப்பேழை'], prose: ['Prose', 'உரைநடை'],
  grammar: ['Grammar', 'இலக்கணம்'], glossary: ['Word meanings', 'சொல்லும் பொருளும்'], meaning: ['Meaning of the poem', 'பாடலின் பொருள்'], devices: ['Poetic devices', 'நயம்'], activities: ['Exercises', 'கற்பவை கற்றபின்'],
  proverb: ['Proverbs', 'பழமொழிகள்'], idiom: ['Idioms', 'மரபுத்தொடர்கள்'], writing: ['Writing', 'எழுத்துப் பயிற்சி'], qgroup: ['Questions', 'வினாக்கள்'], language: ['Language activities', 'மொழிப் பயிற்சி'], body: ['Lesson', 'பாடம்'],
};
