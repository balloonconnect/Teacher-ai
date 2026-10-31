import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { storage } from '../services/storage';
import { DB, q } from '../db';
import { rateLimit, requireAuth, requireRole, uid } from '../security';
import { iso } from '../clock';
import { parse, wrap } from '../http';
import { HttpError } from '../services/tests';
import { textbookHits } from '../services/tutor';
import { retireBookLessons, syncChapterLessons } from '../services/chapterLessons';
import { detectAndStoreChapters, extractAll, listChapters, ocrQueue, ocrUsable, putPages, replaceChapters, runOcr, triage } from '../services/textbookIngest';

const MAX = 60 * 1024 * 1024;
const STAFF = ['teacher', 'school_admin', 'admin'];
/** Class books. The platform admin uploads a PDF with its class; students only ever see, open and are answered from books of their own class. */
/** Fills a blank subject from a title that clearly names one, e.g. "Class 8 English". */
export const guessSubject = (title: string): string | null => {
  const hits = ([['maths', /\b(maths?|mathematics)\b|கணிதம்/i], ['science', /\bscience\b|அறிவியல்/i], ['english', /\benglish\b|ஆங்கிலம்/i], ['social', /\bsocial\b|சமூக/i], ['tamil', /\btamil\b|தமிழ்/i]] as [string, RegExp][]).filter(([, r]) => r.test(title));
  return hits.length === 1 ? hits[0][0] : null;
};

export function textbookRoutes(db: DB) {
  const r = Router(); const admin = requireRole('admin' as any); // only the platform admin can add or remove books; teachers read only
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX, files: 1 } });
  const studentClass = async (userId: string) => (await q.get<any>(db, 'SELECT class_level FROM student_profiles WHERE user_id=?', userId))?.class_level as number | undefined;
  const allowed = async (req: any, b: any) => { if (STAFF.includes(req.user.role)) return true; if (req.user.role === 'student') return (await studentClass(req.user.id)) === b.class_level; return false; };
  const view = (b: any) => ({ id: b.id, title: b.title, class_level: b.class_level, subject_id: b.subject_id, medium: b.medium, page_count: b.page_count, status: b.status, note: b.note, created_at: b.created_at });
  const get = async (id: string) => { const b = (await q.get<any>(db, 'SELECT * FROM textbooks WHERE id=?', id)); if (!b) throw new HttpError(404, 'Book not found.'); return b; };

  r.get('/', requireAuth, wrap(async (req, res) => {
    const u = req.user!; let rows: any[];
    if (STAFF.includes(u.role)) rows = (await q.all<any>(db, 'SELECT * FROM textbooks ORDER BY class_level, subject_id, title'));
    else if (u.role === 'student') { const c = await studentClass(u.id); rows = c ? (await q.all<any>(db, "SELECT * FROM textbooks WHERE class_level=? AND status IN ('ready','needs_ocr','processing') ORDER BY subject_id, title", c)) : []; }
    else rows = [];
    res.json({ textbooks: await Promise.all(rows.map(async b => ({ ...view(b), ...(STAFF.includes(u.role) ? { file_ok: await storage().exists(b.file_path).catch(() => false) } : {}) }))) });
  }));

  r.post('/', admin, rateLimit(10, 600000, req => req.user!.id), upload.single('file'), wrap(async (req, res) => {
    const b = parse(z.object({ title: z.string().trim().min(2).max(120), classLevel: z.coerce.number().int().min(1).max(12), subjectId: z.string().trim().max(40).optional(), medium: z.enum(['English', 'Tamil', 'Both']).default('English') }), req.body);
    const f = req.file; if (!f) throw new HttpError(400, 'Choose a PDF file first.');
    if (f.buffer.subarray(0, 5).toString() !== '%PDF-') throw new HttpError(415, 'Please choose a PDF file.');
    let subject: string | null = null;
    if (!b.subjectId) { const g = guessSubject(b.title); if (g) b.subjectId = g; }
    if (b.subjectId) { if (!(await q.get(db, 'SELECT id FROM subjects WHERE id=?', b.subjectId))) throw new HttpError(400, 'Unknown subject.'); subject = b.subjectId; }
    let pages: { page: number; text: string }[] = []; let status = 'ready', note: string | null = null;
    try { pages = await extractAll(f.buffer); } catch { status = 'failed'; note = 'This PDF could not be read. It may be damaged or password protected.'; }
    if (status === 'failed') throw new HttpError(422, note!);
    // Use the PDF's own text only where it is trustworthy; scanned or badly-encoded pages (common in older Tamil books) go to OCR.
    const { good, bad } = triage(pages, b.medium); const ocr = bad.length ? await ocrUsable(b.medium) : null;
    if (bad.length && ocr?.ok) { status = 'processing'; note = `Reading ${bad.length} page${bad.length > 1 ? 's' : ''} with OCR. The book opens now; the tutor can use it as the pages finish.`; }
    else if (bad.length && good.length < Math.max(1, Math.floor(pages.length / 4))) { status = 'needs_ocr'; note = 'Most pages are scanned images or use an unreadable text encoding, and OCR cannot run on this server' + (ocr && !ocr.ok ? ` (${ocr.why})` : '') + '. Students can open this book, but the tutor cannot answer from it yet.'; }
    else if (bad.length) note = `${bad.length} page${bad.length > 1 ? 's' : ''} have no readable text (images or unusual encoding) and are skipped by the tutor.`;
    const id = uid(); const path = storage().newKey('textbooks', 'pdf'); await storage().put(path, f.buffer, 'application/pdf');
    await q.run(db, 'INSERT INTO textbooks(id,title,class_level,subject_id,medium,file_path,size,page_count,status,note,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id, b.title, b.classLevel, subject, b.medium, path, f.size, pages.length, status, note, req.user!.id, iso());
    await putPages(db, id, good);
    if (status === 'processing') ocrQueue.add(() => runOcr(db, id, bad)); else await detectAndStoreChapters(db, id);
    res.status(201).json({ textbook: view(await get(id)) });
  }));

  /** Pages of the student's own class books that relate to one lesson (a few excerpts, never the whole book). */
  r.get('/for-lesson/:lessonId', requireAuth, wrap(async (req, res) => {
    const u = req.user!; const l = (await q.get<any>(db, 'SELECT id,class_level,subject_id,title_en,content FROM lessons WHERE id=?', req.params.lessonId));
    if (!l) throw new HttpError(404, 'Lesson not found.');
    if (u.role === 'student' ? (await studentClass(u.id)) !== l.class_level : !STAFF.includes(u.role)) return res.json({ pages: [] });
    let c: any = {}; try { c = JSON.parse(l.content); } catch { /* ignore */ }
    const query = [l.title_en, ...(c.sections ?? []).map((x: any) => `${x.h_en} ${x.en}`), ...(c.vocab ?? []).map((v: any) => v.en ?? v.term_en ?? '')].join(' ');
    const seen = new Set<string>(); const pages: any[] = [];
    for (const h of await textbookHits(db, l.class_level, l.subject_id, query, 12)) { const k = `${h.bookId}:${h.page}`; if (seen.has(k) || pages.length >= 4) continue; seen.add(k); pages.push({ bookId: h.bookId, book: h.source, page: h.page, excerpt: h.text.slice(0, 320) }); }
    res.json({ pages });
  }));

  r.get('/:id', requireAuth, wrap(async (req, res) => { const b = await get(req.params.id); if (!(await allowed(req, b))) throw new HttpError(404, 'Book not found.'); res.json({ textbook: { ...view(b), file_ok: await storage().exists(b.file_path) } }); }));
  r.get('/:id/pages/:n', requireAuth, wrap(async (req, res) => {
    const b = await get(req.params.id); if (!(await allowed(req, b))) throw new HttpError(404, 'Book not found.');
    const n = Number(req.params.n); const p = Number.isInteger(n) ? (await q.get<any>(db, 'SELECT page,text FROM textbook_pages WHERE textbook_id=? AND page=?', b.id, n)) : undefined;
    res.json({ page: n, text: p?.text ?? '', pageCount: b.page_count });
  }));
  r.get('/:id/file', requireAuth, wrap(async (req, res) => {
    const b = await get(req.params.id); if (!(await allowed(req, b)) || !(await storage().exists(b.file_path))) throw new HttpError(404, 'Book not found.');
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${b.id}.pdf"`);
    res.setHeader('X-Frame-Options', 'SAMEORIGIN'); res.setHeader('Content-Security-Policy', "frame-ancestors 'self'"); res.setHeader('Cache-Control', 'private, max-age=300');
    (await storage().stream(b.file_path)).pipe(res);
  }));
  /** Chapters (lessons) of a book, from its printed contents page; used for the chapter picker and to keep the tutor inside one chapter. */
  r.get('/:id/chapters', requireAuth, wrap(async (req, res) => { const b = await get(req.params.id); if (!(await allowed(req, b))) throw new HttpError(404, 'Book not found.'); res.json({ chapters: await listChapters(db, b.id) }); }));
  r.post('/:id/chapters/detect', admin, rateLimit(20, 600000, req => req.user!.id), wrap(async (req, res) => {
    const b = await get(req.params.id); const n = await detectAndStoreChapters(db, b.id, true);
    if (!n) throw new HttpError(422, 'No contents page could be read in this book, so no chapters were found. You can add them by hand.');
    res.json({ chapters: await listChapters(db, b.id) });
  }));
  r.put('/:id/chapters', admin, wrap(async (req, res) => {
    const b = await get(req.params.id);
    const body = parse(z.object({ chapters: z.array(z.object({ title: z.string().trim().min(1).max(160), startPage: z.number().int().min(1), endPage: z.number().int().min(1) })).max(300) }), req.body);
    let prevEnd = 0; // chapters must sit inside the book, in order, without overlapping
    for (const c of body.chapters) { if (c.endPage < c.startPage || c.endPage > b.page_count || c.startPage <= prevEnd) throw new HttpError(400, `“${c.title}” has page numbers that do not fit the book (1–${b.page_count}) or overlap the chapter before it.`); prevEnd = c.endPage; }
    await replaceChapters(db, b.id, body.chapters, 'admin'); await syncChapterLessons(db, b.id).catch(() => {}); res.json({ chapters: await listChapters(db, b.id) });
  }));
  /** Re-run OCR on the pages that have no usable text (e.g. after OCR was installed), or on every page with `all: true` (e.g. after the OCR settings or language data were improved). */
  r.post('/:id/ocr', admin, rateLimit(10, 600000, req => req.user!.id), wrap(async (req, res) => {
    const all = parse(z.object({ all: z.boolean().optional() }), req.body ?? {}).all === true;
    const b = await get(req.params.id); if (b.status === 'processing') throw new HttpError(409, 'This book is already being read.');
    const usable = await ocrUsable(b.medium); if (!usable.ok) throw new HttpError(501, usable.why);
    const have = new Set((await q.all<any>(db, 'SELECT page FROM textbook_pages WHERE textbook_id=?', b.id)).map(r => r.page as number));
    const todo = Array.from({ length: b.page_count }, (_, i) => i + 1).filter(n => all || !have.has(n)); if (!todo.length) throw new HttpError(409, 'Every page already has text.');
    await q.run(db, "UPDATE textbooks SET status='processing', note=? WHERE id=?", `Reading ${todo.length} pages with OCR.`, b.id); ocrQueue.add(() => runOcr(db, b.id, todo));
    res.status(202).json({ textbook: view(await get(b.id)) });
  }));
  r.patch('/:id', admin, wrap(async (req, res) => {
    const b = await get(req.params.id);
    const body = parse(z.object({ subjectId: z.string().trim().max(40).nullable().optional(), medium: z.enum(['English', 'Tamil', 'Both']).optional() }), req.body);
    const subject = body.subjectId === undefined ? b.subject_id : (body.subjectId || null); const medium = body.medium ?? b.medium;
    if (subject && !(await q.get(db, 'SELECT 1 FROM subjects WHERE id=?', subject))) throw new HttpError(400, 'Unknown subject.');
    await q.run(db, 'UPDATE textbooks SET subject_id=?, medium=? WHERE id=?', subject, medium, b.id);
    // lessons made from this book follow the new subject and medium; with no subject they are hidden
    if (subject) await syncChapterLessons(db, b.id); else await retireBookLessons(db, b.id);
    res.json({ textbook: view(await get(b.id)) });
  }));
  r.delete('/:id', admin, wrap(async (req, res) => {
    const b = await get(req.params.id); await storage().delete(b.file_path); await retireBookLessons(db, b.id);
    await q.run(db, 'DELETE FROM textbook_chapters WHERE textbook_id=?', b.id); await q.run(db, 'DELETE FROM textbook_pages WHERE textbook_id=?', b.id); await q.run(db, 'DELETE FROM textbooks WHERE id=?', b.id); res.json({ ok: true });
  }));
  return r;
}
