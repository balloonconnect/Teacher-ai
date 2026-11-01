import { DB, q } from '../db';
import { JobQueue } from './jobs';
import { getOcrEngine, ocrMissingLangs, ocrPages, textQuality } from './ocr';
import { storage } from './storage';
import { detectChapters } from './chapters';
import { syncChapterLessons } from './chapterLessons';
import { randomUUID } from 'node:crypto';

export type PageText = { page: number; text: string };
/** Page text with line breaks kept (a contents page is one entry per line; passages are split on lines too). */
export async function extractAll(buf: Buffer): Promise<PageText[]> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try { const r = await parser.getText(); return r.pages.map((p: any) => ({ page: p.num as number, text: String(p.text).replace(/[ \t\f\v\u00a0]+/g, ' ').replace(/ ?\r?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim() })); }
  finally { await parser.destroy().catch(() => {}); }
}

export const ocrQueue = new JobQueue(Number(process.env.OCR_CONCURRENCY ?? 1));
export const langFor = (medium: string) => (medium === 'Tamil' || medium === 'Both' ? process.env.OCR_LANG_TAMIL ?? 'tam+eng' : process.env.OCR_LANG_ENGLISH ?? 'eng');
const MIN_PAGE_CHARS = 20;

export async function putPages(db: DB, bookId: string, pages: PageText[]) {
  for (const p of pages) if (p.text.length >= MIN_PAGE_CHARS) await q.run(db, 'INSERT INTO textbook_pages(textbook_id,page,text) VALUES (?,?,?) ON CONFLICT(textbook_id,page) DO UPDATE SET text=excluded.text', bookId, p.page, p.text.slice(0, 20000));
}

/** Splits the PDF's own text layer into pages we can trust and pages that need OCR. */
export function triage(pages: PageText[], medium: 'English' | 'Tamil' | 'Both') {
  const good = pages.filter(p => textQuality(p.text, medium).ok); const ok = new Set(good.map(p => p.page));
  return { good, bad: pages.filter(p => !ok.has(p.page)).map(p => p.page) };
}

/** Background job: OCR the listed pages of a stored book, saving each page as it is read, then settle the book's status. */
/** Can this book's pages be OCR'd here? Says why not in words an admin can act on. */
export async function ocrUsable(medium: string): Promise<{ ok: true } | { ok: false; why: string }> {
  if (!(await getOcrEngine())) return { ok: false, why: 'OCR is not available on this server.' };
  const missing = await ocrMissingLangs(langFor(medium));
  if (missing.length) return { ok: false, why: `OCR language data is missing on this server (${missing.join(', ')}). Reading would produce wrong text, so it was not started. Install it (Debian/Ubuntu: tesseract-ocr-${missing[0]}; the Docker image already has it) and press "Read pages (OCR)".` };
  return { ok: true };
}
export async function runOcr(db: DB, bookId: string, pageNos: number[]) {
  const book = await q.get<any>(db, 'SELECT * FROM textbooks WHERE id=?', bookId); if (!book) return;
  const engine = await getOcrEngine(); const usable = await ocrUsable(book.medium);
  const settle = async (status: string, note: string | null) => { await q.run(db, 'UPDATE textbooks SET status=?, note=? WHERE id=?', status, note, bookId); };
  if (!engine || !usable.ok) return settle('needs_ocr', usable.ok ? 'OCR is not available on this server, so scanned pages cannot be read yet.' : usable.why);
  let pdf: Buffer; try { pdf = await storage().get(book.file_path); } catch { return settle('failed', 'The stored PDF could not be found, so OCR could not run.'); }
  let last = 0;
  const r = await ocrPages(pdf, pageNos, {
    engine, lang: langFor(book.medium),
    onPage: async (done, total) => { if (done - last >= 3 || done === total) { last = done; await q.run(db, 'UPDATE textbooks SET note=? WHERE id=?', `Reading the pages (OCR): ${done} of ${total} done.`, bookId); } },
    shouldStop: () => false,
  });
  await putPages(db, bookId, r.pages);
  const have = (await q.get<any>(db, 'SELECT COUNT(*) c FROM textbook_pages WHERE textbook_id=?', bookId))?.c ?? 0;
  const skipped = r.failed.length;
  if (!have) return settle('needs_ocr', 'No readable text could be found in this PDF.');
  await settle('ready', skipped ? `${skipped} page${skipped > 1 ? 's' : ''} could not be read (OCR). The rest is ready.` : null);
  await detectAndStoreChapters(db, bookId);
  await syncChapterLessons(db, bookId).catch(() => {}); // chapters an admin edited are not re-detected, but their lessons must follow the new text
}

/** After a restart, books left half-read continue where they stopped (pages already saved are skipped). */
export async function resumeOcr(db: DB) {
  const books = await q.all<any>(db, "SELECT id, page_count FROM textbooks WHERE status='processing'");
  for (const b of books) {
    const have = new Set((await q.all<any>(db, 'SELECT page FROM textbook_pages WHERE textbook_id=?', b.id)).map(r => r.page as number));
    const todo = Array.from({ length: b.page_count }, (_, i) => i + 1).filter(n => !have.has(n));
    ocrQueue.add(() => runOcr(db, b.id, todo));
  }
  return books.length;
}

export type StoredChapter = { id: string; title: string; startPage: number; endPage: number; verified: boolean; source: string };
export async function listChapters(db: DB, bookId: string): Promise<StoredChapter[]> {
  return (await q.all<any>(db, 'SELECT id,title,start_page,end_page,verified,source FROM textbook_chapters WHERE textbook_id=? ORDER BY ord', bookId)).map(r => ({ id: r.id, title: r.title, startPage: r.start_page, endPage: r.end_page, verified: !!r.verified, source: r.source }));
}
/** Replaces a book's chapters. */
export async function replaceChapters(db: DB, bookId: string, list: { title: string; startPage: number; endPage: number; verified?: boolean }[], source: 'auto' | 'admin') {
  await db.exec('BEGIN');
  try {
    await q.run(db, 'DELETE FROM textbook_chapters WHERE textbook_id=?', bookId);
    for (let i = 0; i < list.length; i++) { const c = list[i]; await q.run(db, 'INSERT INTO textbook_chapters(id,textbook_id,ord,title,start_page,end_page,verified,source) VALUES (?,?,?,?,?,?,?,?)', randomUUID(), bookId, i + 1, c.title.slice(0, 160), c.startPage, c.endPage, c.verified ? 1 : 0, source); }
    await db.exec('COMMIT');
  } catch (e) { await db.exec('ROLLBACK'); throw e; }
}
/** Reads the contents page and stores the chapters found. Chapters an admin has edited are left alone unless `force`. Never throws: a book without chapters is normal. */
export async function detectAndStoreChapters(db: DB, bookId: string, force = false): Promise<number> {
  try {
    const book = await q.get<any>(db, 'SELECT page_count FROM textbooks WHERE id=?', bookId); if (!book) return 0;
    if (!force && (await q.get<any>(db, "SELECT 1 x FROM textbook_chapters WHERE textbook_id=? AND source='admin'", bookId))) return 0;
    const pages = await q.all<any>(db, 'SELECT page,text FROM textbook_pages WHERE textbook_id=? ORDER BY page', bookId);
    const found = detectChapters(pages, book.page_count); if (!found.length) return 0;
    await replaceChapters(db, bookId, found, 'auto'); await syncChapterLessons(db, bookId).catch(() => {}); return found.length;
  } catch { return 0; }
}
