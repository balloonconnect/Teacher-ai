import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { storage } from '../services/storage';
import { DB, q } from '../db';
import { rateLimit, requireRole, uid } from '../security';
import { iso } from '../clock';
import { J, parse, wrap } from '../http';
import { HttpError } from '../services/tests';
import { htmlToText, safeFetch } from '../services/ssrf';
import { splitPassages, topPassages } from '../services/retrieval';

const MAX = 10 * 1024 * 1024;
const sniff = (b: Buffer): 'png' | 'jpeg' | 'webp' | 'pdf' | null => {
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'webp';
  if (b.subarray(0, 5).toString() === '%PDF-') return 'pdf'; return null;
};
async function extractPdf(buf: Buffer) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const r = await parser.getText({ first: 100 });
    return r.pages.map(p => ({ page: p.num, text: p.text.replace(/\s+/g, ' ').trim() })).filter(p => p.text);
  } finally { await parser.destroy().catch(() => {}); }
}
export function materialRoutes(db: DB) {
  const r = Router(); const S = requireRole('student'); const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX, files: 1 } });
  const own = async (id: string, userId: string) => { const m = (await q.get<any>(db, 'SELECT * FROM materials WHERE id=? AND user_id=?', id, userId)); if (!m) throw new HttpError(404, 'Material not found.'); return m; };
  const view = (m: any) => ({ id: m.id, kind: m.kind, name: m.name, mime: m.mime, size: m.size, source_url: m.source_url, status: m.status, note: m.note, created_at: m.created_at, pageCount: J(m.pages).length, hasText: !!m.text, preview: m.text ? m.text.slice(0, 600) : null });
  const saveFile = async (buf: Buffer, ext: string, mime?: string) => { const key = storage().newKey('uploads', ext); await storage().put(key, buf, mime); return key; };
  const guard = async (userId: string) => { const p = (await q.get<any>(db, 'SELECT guardian_approved FROM student_profiles WHERE user_id=?', userId)); const u13 = (await q.get<any>(db, 'SELECT value FROM settings WHERE key=?', `under13:${userId}`))?.value === '1'; if (u13 && !p?.guardian_approved) throw new HttpError(403, 'A parent or guardian needs to approve your account before you can upload material.'); };

  r.get('/', S, wrap(async (req, res) => res.json({ materials: (await q.all<any>(db, 'SELECT * FROM materials WHERE user_id=? ORDER BY created_at DESC', req.user!.id)).map(view), capabilities: { ocr: !!process.env.ANTHROPIC_API_KEY, ocrNote: process.env.ANTHROPIC_API_KEY ? 'Photo text reading uses the configured AI vision service.' : 'Automatic photo text reading (OCR) is not configured in this environment. Type or paste the question text instead.', pdfText: true, pdfOcr: false, link: true } })));
  r.post('/upload', S, rateLimit(20, 600000, req => req.user!.id), upload.single('file'), wrap(async (req, res) => {
    await guard(req.user!.id); const f = req.file; const kind = req.body?.kind === 'pdf' ? 'pdf' : 'image';
    if (!f) throw new HttpError(400, 'Choose a file first.'); const type = sniff(f.buffer);
    if (kind === 'image' && !(type === 'png' || type === 'jpeg' || type === 'webp')) throw new HttpError(415, 'Please choose a JPG, PNG or WebP photo.');
    if (kind === 'pdf' && type !== 'pdf') throw new HttpError(415, 'Please choose a PDF file.');
    const name = (f.originalname || (kind === 'pdf' ? 'document.pdf' : 'photo')).replace(/[^\w.\- ()஀-௿]/g, '_').slice(0, 100); const id = uid();
    const path = await saveFile(f.buffer, type === 'jpeg' ? 'jpg' : type!, f.mimetype);
    let text: string | null = null, pages: any[] = [], status = 'ready', note: string | null = null;
    if (kind === 'pdf') {
      try { pages = await extractPdf(f.buffer); text = pages.map(p => p.text).join('\n'); }
      catch { status = 'failed'; note = 'This PDF could not be read. It may be damaged or password protected.'; }
      if (status === 'ready' && text!.replace(/\s/g, '').length < 40) { status = 'needs_ocr'; note = 'This PDF looks scanned (no readable text). OCR for scanned pages is not configured in this environment.'; text = null; pages = []; }
    } else { status = 'needs_text'; note = process.env.ANTHROPIC_API_KEY ? 'Press “Read text from photo” to extract the question.' : 'Automatic text reading (OCR) is not configured here. Type or paste the text of your question to continue.'; }
    await q.run(db, 'INSERT INTO materials(id,user_id,kind,name,mime,size,file_path,text,pages,status,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id, req.user!.id, kind, name, f.mimetype, f.size, path, text, JSON.stringify(pages), status, note, iso());
    res.status(201).json({ material: view((await q.get(db, 'SELECT * FROM materials WHERE id=?', id))!) });
  }));
  r.post('/link', S, rateLimit(15, 600000, req => req.user!.id), wrap(async (req, res) => {
    await guard(req.user!.id); const b = parse(z.object({ url: z.string().trim().min(8).max(2000) }), req.body);
    const f = await safeFetch(b.url); const { title, text } = htmlToText(f.body);
    if (text.length < 80) throw new HttpError(422, 'No readable text was found on that page. Some pages need sign-in or load content with scripts, which we cannot read.');
    const id = uid(); await q.run(db, 'INSERT INTO materials(id,user_id,kind,name,mime,size,source_url,text,pages,status,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id, req.user!.id, 'link', (title || new URL(f.url).hostname).slice(0, 100), f.contentType, text.length, f.url, text.slice(0, 200000), '[]', 'ready', 'Text extracted from the page. Some pages cannot be read.', iso());
    res.status(201).json({ material: view((await q.get(db, 'SELECT * FROM materials WHERE id=?', id))!) });
  }));
  r.get('/:id', S, wrap(async (req, res) => { const m = await own(req.params.id, req.user!.id); res.json({ material: view(m), pages: J(m.pages).map((p: any) => ({ page: p.page, text: p.text.slice(0, 1500) })), text: m.text?.slice(0, 20000) ?? null }); }));
  r.get('/:id/file', S, wrap(async (req, res) => { const m = await own(req.params.id, req.user!.id); if (!m.file_path || !(await storage().exists(m.file_path))) throw new HttpError(404, 'File not found.'); res.setHeader('Content-Type', m.mime ?? 'application/octet-stream'); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.send(await storage().get(m.file_path)); }));
  r.put('/:id/text', S, wrap(async (req, res) => {
    const b = parse(z.object({ text: z.string().trim().min(5, 'Enter the question or text from your photo').max(8000) }), req.body); const m = await own(req.params.id, req.user!.id);
    if (m.kind !== 'image') throw new HttpError(400, 'Only photos need confirmed text.');
    await q.run(db, "UPDATE materials SET text=?, status='ready', note='Text confirmed by you.' WHERE id=?", b.text, m.id); res.json({ material: view((await q.get(db, 'SELECT * FROM materials WHERE id=?', m.id))!) });
  }));
  r.post('/:id/ocr', S, rateLimit(10, 600000, req => req.user!.id), wrap(async (req, res) => {
    const m = await own(req.params.id, req.user!.id); const key = process.env.ANTHROPIC_API_KEY;
    if (m.kind !== 'image') throw new HttpError(400, 'OCR applies to photos.'); if (!key) throw new HttpError(501, 'Photo text reading (OCR) is not configured in this environment. Type the text instead.');
    const buf = await storage().get(m.file_path); const type = sniff(buf)!;
    const rsp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5', max_tokens: 1000, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: `image/${type}`, data: buf.toString('base64') } }, { type: 'text', text: 'Transcribe the text/question in this school photo exactly. Reply with the text only. If unsure about a word, put it in [?brackets?].' }] }] }), signal: AbortSignal.timeout(30000) });
    if (!rsp.ok) throw new HttpError(502, 'Could not read the photo right now. Please type the text instead.');
    const data: any = await rsp.json(); const text = String(data.content?.[0]?.text ?? '').trim();
    await q.run(db, "UPDATE materials SET text=?, status='needs_confirmation', note='Please check the text below — uncertain words are marked [?like this?].' WHERE id=?", text, m.id); res.json({ material: view((await q.get(db, 'SELECT * FROM materials WHERE id=?', m.id))!), text });
  }));
  r.delete('/:id', S, wrap(async (req, res) => { const m = await own(req.params.id, req.user!.id); if (m.file_path) await storage().delete(m.file_path); await q.run(db, 'DELETE FROM materials WHERE id=?', m.id); res.json({ ok: true }); }));
  const passagesOf = (m: any) => { const pages = J(m.pages) as { page: number; text: string }[]; return pages.length ? pages.flatMap(pg => splitPassages(pg.text, pg.page, m.name)) : splitPassages(m.text ?? '', undefined, m.name); };
  r.post('/:id/notes', S, wrap(async (req, res) => {
    const m = await own(req.params.id, req.user!.id); if (!m.text) throw new HttpError(409, 'This material has no readable text yet.');
    const ps = passagesOf(m); const pick = ps.filter((_, i) => i % Math.max(1, Math.ceil(ps.length / 8)) === 0).slice(0, 8);
    res.json({ label: 'Auto-extracted key passages from your material (not AI-written).', notes: pick.map(p => ({ page: p.page ?? null, text: p.text })) });
  }));
  r.post('/:id/quiz', S, wrap(async (req, res) => {
    const m = await own(req.params.id, req.user!.id); if (!m.text) throw new HttpError(409, 'This material has no readable text yet.');
    const qs = passagesOf(m).filter(p => p.text.length > 60).slice(0, 12).map(p => { const words = (p.text.match(/[\p{L}]{6,}/gu) ?? []); const w = words.sort((a, b) => b.length - a.length)[0]; if (!w) return null; return { page: p.page ?? null, prompt: p.text.replace(w, '_____'), answer: w }; }).filter(Boolean).slice(0, 5);
    res.json({ label: 'Fill-in-the-blank questions built from your material.', questions: qs });
  }));
  r.post('/:id/ask', S, wrap(async (req, res) => { // convenience: one-shot grounded Q&A without a conversation
    const b = parse(z.object({ question: z.string().trim().min(2).max(500) }), req.body); const m = await own(req.params.id, req.user!.id); if (!m.text) throw new HttpError(409, 'This material has no readable text yet.');
    const hits = topPassages(b.question, passagesOf(m), 3); res.json({ grounded: true, answers: hits.map(h => ({ page: h.page ?? null, text: h.text })), found: hits.length > 0 });
  }));
  return r;
}
