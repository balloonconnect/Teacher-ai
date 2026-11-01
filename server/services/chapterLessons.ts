import { createHash } from 'node:crypto';
import { DB, q } from '../db';
import { tokens } from './retrieval';
import { cleanLines, isCleanLine, isFurniture, normalizeTamil } from './tamilText';

/**
 * Turns each chapter of an imported textbook into a lesson, so the Learn page, explanation, mind map, tutor chat, voice
 * tutor, practice and tests all work from the real book. Everything is extractive: the lesson text is the book's own text
 * (as read from the PDF or by OCR), cut into sections. Nothing is written by a model, and nothing is translated.
 *
 * Lessons are keyed `bk-<book>-<chapter number>`, so running this again updates them in place and keeps student progress.
 */
import { build as buildStructure } from './bookStructure';
export const BOOK_SOURCE_PREFIX = 'Textbook:';
export const BOOK_QUESTION_MAKER = 'book-import';
const SECTION_CHARS = 900, MAX_SECTIONS = 12, MAX_QUESTIONS = 10;

const isTamil = (s: string) => (s.match(/[஀-௿]/g) ?? []).length > s.replace(/\s/g, '').length * 0.4;
const clean = (s: string) => s.replace(/[|_~^`]+/g, ' ').replace(/[ \t]+/g, ' ').trim();
const pick = <T,>(arr: T[], seed: string, n: number): T[] => {
  const h = (x: string) => createHash('sha1').update(seed + x).digest().readUInt32BE(0);
  return [...arr].map(x => [h(String(x)), x] as const).sort((a, b) => a[0] - b[0]).slice(0, n).map(x => x[1]);
};

/** A heading must be mostly real letters of the book's script; OCR noise on decorative banners is not used. */
export function looksLikeHeading(line: string, tamil: boolean) {
  const compact = line.replace(/[\s.,:;()\-–—'"“”‘’!?]/g, ''); if (compact.length < 3) return false;
  const good = (compact.match(tamil ? /[஀-௿]/g : /[A-Za-z]/g) ?? []).length;
  return good / compact.length >= 0.85;
}
export type Section = { h_en: string; h_ta: string; en: string; ta: string };
/** Cuts a chapter's page texts into readable sections. The heading is the first short line, else "Page N". */
export function buildSections(pages: { page: number; text: string }[], tamil: boolean): Section[] {
  const out: Section[] = [];
  let buf: string[] = [], startPage = 0, endPage = 0, len = 0;
  const flush = () => {
    if (!buf.length) return;
    const first = buf[0]; const heading = first.length <= 60 && buf.length > 1 && looksLikeHeading(first, tamil) ? first : '';
    const body = (heading ? buf.slice(1) : buf).join(' ').replace(/\s+/g, ' ').trim();
    if (body.length >= 40) {
      const range = startPage === endPage ? `${startPage}` : `${startPage}–${endPage}`;
      const h_en = heading || `Page ${range}`, h_ta = heading || `பக்கம் ${range}`;
      out.push({ h_en, h_ta, en: body, ta: tamil ? body : '' });
    }
    buf = []; len = 0;
  };
  for (const p of pages) {
    const lines = normalizeTamil(p.text).split(/\n+/).map(clean).filter(l => l.length > 2 && /\p{L}/u.test(l) && !isFurniture(l) && (!tamil || isCleanLine(l)) && (!tamil || l.length >= 40 || looksLikeHeading(l, true)));
    for (const line of lines) {
      if (!buf.length) startPage = p.page;
      endPage = p.page; buf.push(line); len += line.length;
      if (len >= SECTION_CHARS) flush();
    }
  }
  flush();
  // keep headings unique (the lesson page keys sections by heading)
  const seen = new Map<string, number>();
  for (const s of out) { const n = (seen.get(s.h_en) ?? 0) + 1; seen.set(s.h_en, n); if (n > 1) { s.h_en += ` (${n})`; s.h_ta += ` (${n})`; } }
  return out.slice(0, MAX_SECTIONS);
}

export type Cloze = { stem: string; answer: string; options: string[]; correct: number };
/** Fill-in-the-blank multiple choice questions made from the chapter's own sentences. The distractors are other words from the same chapter. */
export function buildCloze(text: string, seed: string, max = MAX_QUESTIONS): Cloze[] {
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?।])\s+/).map(s => s.trim()).filter(s => s.length >= 40 && s.length <= 220);
  const letters = (s: string) => (s.match(/[\p{L}\p{M}]/gu) ?? []).length;
  const tamil = isTamil(text);
  const clean1 = (s: string) => {
    if (letters(s) / s.length <= 0.7 || /[0-9]{4,}/.test(s)) return false;
    if (tamil && (s.match(/[஀-௿]/g) ?? []).length / letters(s) < 0.9) return false; // OCR mixed in Latin noise
    return s.split(/\s+/).filter(w => w.replace(/[^\p{L}\p{M}]/gu, '').length === 1).length <= 1; // stray single letters mean the line was split badly
  };
  const good = sentences.filter(clean1);
  const pool = [...new Set(tokens(text).filter(t => /^[\p{L}\p{M}]+$/u.test(t) && t.length >= 4 && t.length <= 14))];
  const out: Cloze[] = [];
  for (const s of pick(good, seed, good.length)) {
    if (out.length >= max) break;
    const words = s.split(/\s+/).map(w => w.replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, ''));
    const cand = words.filter(w => w.length >= 4 && w.length <= 14 && pool.includes(w.toLowerCase().normalize('NFC')));
    if (cand.length < 2 || words.length < 6) continue;
    const answer = pick(cand, seed + s, 1)[0];
    const distract = pick(pool.filter(t => t !== answer.toLowerCase().normalize('NFC') && Math.abs(t.length - answer.length) <= 3 && !s.toLowerCase().includes(t)), seed + answer, 3);
    if (distract.length < 3) continue;
    const opts = pick([answer, ...distract], seed + 'o' + s, 4);
    out.push({ stem: s.replace(answer, '_____'), answer, options: opts, correct: opts.indexOf(answer) });
  }
  return out;
}

const pageNote = (a: number, b: number) => (a === b ? `page ${a}` : `pages ${a}–${b}`);

/** Creates or updates one lesson per chapter of the book. Returns how many lessons exist for the book afterwards. */
export async function syncChapterLessons(db: DB, bookId: string): Promise<number> {
  const book = await q.get<any>(db, 'SELECT * FROM textbooks WHERE id=?', bookId);
  if (!book || !book.subject_id) return 0;
  const chapters = await q.all<any>(db, 'SELECT * FROM textbook_chapters WHERE textbook_id=? ORDER BY ord', bookId);
  const prefix = `bk-${bookId.slice(0, 8)}-`;
  const tamilBook = book.medium === 'Tamil';
  const subj = await q.get<any>(db, 'SELECT name_en, name_ta FROM subjects WHERE id=?', book.subject_id);
  let made = 0;
  for (const ch of chapters) {
    const pages = await q.all<any>(db, 'SELECT page,text FROM textbook_pages WHERE textbook_id=? AND page BETWEEN ? AND ? ORDER BY page', bookId, ch.start_page, ch.end_page);
    const text = pages.map(p => cleanLines(p.text).text).join('\n'); const quality = cleanLines(pages.map(p => p.text).join('\n')).quality;
    const sections = buildSections(pages, tamilBook || isTamil(text));
    if (!sections.length) continue; // a chapter whose pages have not been read yet gets no lesson
    const id = `${prefix}${ch.ord}`;
    const range = pageNote(ch.start_page, ch.end_page);
    const content = {
      objectives: {
        en: [`Read the chapter “${ch.title}” (${range} of your textbook)`, 'Know the main ideas and words in each part', 'Answer questions taken from the chapter'],
        ta: [`“${ch.title}” பாடத்தைப் படித்தல் (பாடநூல் ${range.replace('pages', 'பக்கங்கள்').replace('page', 'பக்கம்')})`, 'ஒவ்வொரு பகுதியின் முக்கிய கருத்துகளையும் சொற்களையும் அறிதல்', 'பாடத்திலிருந்து கேட்கப்படும் வினாக்களுக்கு விடையளித்தல்'],
      },
      sections,
      structure: buildStructure(pages),
      vocab: [], examples: [], mistakes: [],
      fromBook: { quality: Math.round(quality * 100) / 100, textbookId: bookId, chapterOrd: ch.ord, startPage: ch.start_page, endPage: ch.end_page, language: tamilBook || (book.medium === 'Both' && isTamil(text)) ? 'ta' : 'en', verified: !!ch.verified },
    };
    const source = `${BOOK_SOURCE_PREFIX} ${book.title}, ${range}. Read from the textbook PDF${book.status === 'ready' ? '' : ' (still being read)'}; scanned text can contain a few wrong letters.`;
    const title = ch.title;
    const exists = await q.get<any>(db, 'SELECT id, version FROM lessons WHERE id=?', id);
    if (exists) await q.run(db, "UPDATE lessons SET class_level=?, subject_id=?, chapter_no=?, chapter_en=?, chapter_ta=?, title_en=?, title_ta=?, minutes=?, position=?, content=?, source=?, version=version+1, status='published' WHERE id=?",
      book.class_level, book.subject_id, ch.ord, tamilBook ? subj?.name_ta ?? title : subj?.name_en ?? title, subj?.name_ta ?? title, title, title, Math.max(5, Math.min(40, Math.round(text.length / 900))), ch.ord, JSON.stringify(content), source, id);
    else await q.run(db, "INSERT INTO lessons(id,class_level,subject_id,term,chapter_no,chapter_en,chapter_ta,title_en,title_ta,minutes,position,content,source,version,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,'published')",
      id, book.class_level, book.subject_id, 1, ch.ord, subj?.name_en ?? title, subj?.name_ta ?? title, title, title, Math.max(5, Math.min(40, Math.round(text.length / 900))), ch.ord, JSON.stringify(content), source);
    made++;
    await makeQuestions(db, id, book, ch, text);
  }
  // chapters that no longer exist: take the lesson down but keep it (student progress points at it)
  await q.run(db, `UPDATE lessons SET status='archived' WHERE id LIKE ? AND CAST(substr(id, ?) AS INTEGER) > ?`, `${prefix}%`, prefix.length + 1, chapters.length);
  return made;
}

/** Practice questions (published, labelled as made from the book) and a draft copy for teachers to review before any test uses them. Never overwrites a reviewed question. */
async function makeQuestions(db: DB, lessonId: string, book: any, ch: any, text: string) {
  if (await q.get(db, 'SELECT 1 x FROM questions WHERE id=?', `bq-${lessonId}-0`)) return;
  const items = buildCloze(text, lessonId);
  for (let i = 0; i < items.length; i++) {
    const c = items[i];
    const base = [book.subject_id, book.class_level, ch.ord, 'mcq', c.stem, c.stem, JSON.stringify(c.options), JSON.stringify(c.correct), 1, 'easy',
      `The word that completes the sentence is “${c.answer}”. (From ${ch.title}.)`, `வாக்கியத்தை நிறைவு செய்யும் சொல் “${c.answer}”. (${ch.title} பாடத்திலிருந்து.)`, ch.title.slice(0, 120)];
    const cols = 'id,subject_id,class_level,chapter_no,type,text_en,text_ta,options,answer,marks,difficulty,explanation_en,explanation_ta,topic,origin,status,created_by,school_id';
    await q.run(db, `INSERT INTO questions(${cols}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, `bp-${lessonId}-${i}`, ...base, 'practice', 'published', BOOK_QUESTION_MAKER, null);
    await q.run(db, `INSERT INTO questions(${cols}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, `bq-${lessonId}-${i}`, ...base, 'book', 'draft', BOOK_QUESTION_MAKER, null);
  }
}

/** Takes a deleted book's lessons off the Learn page (progress is kept). */
export async function retireBookLessons(db: DB, bookId: string) {
  await q.run(db, "UPDATE lessons SET status='archived' WHERE id LIKE ?", `bk-${bookId.slice(0, 8)}-%`);
}

/** At start-up: make sure every book that has chapters has its lessons. */
export async function backfillChapterLessons(db: DB): Promise<number> {
  let n = 0;
  for (const b of await q.all<any>(db, "SELECT DISTINCT t.id FROM textbooks t JOIN textbook_chapters c ON c.textbook_id=t.id WHERE t.subject_id IS NOT NULL")) {
    try { n += await syncChapterLessons(db, b.id); } catch (e) { console.warn('chapter lessons failed for', b.id, (e as Error).message); }
  }
  return n;
}
