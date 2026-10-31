import { Router } from 'express';
import { z } from 'zod';
import { DB, q } from '../db';
import { audit, rateLimit, requireRole, uid } from '../security';
import { iso, clock } from '../clock';
import { J, parse, wrap } from '../http';
import { HttpError } from '../services/tests';
import { ACTIONS, looksTanglish, TutorProvider, selectProvider } from '../services/tutor';
import { splitPassages } from '../services/retrieval';
import { myProfile } from './student';

export function tutorRoutes(db: DB, provider: TutorProvider = selectProvider()) {
  const r = Router(); const S = requireRole('student');
  const own = async (id: string, uidv: string) => { const c = (await q.get<any>(db, 'SELECT * FROM conversations WHERE id=? AND user_id=?', id, uidv)); if (!c) throw new HttpError(404, 'Conversation not found.'); return c; };
  const shape = (m: any) => ({ id: m.id, role: m.role, content: J(m.content), meta: J(m.meta), created_at: m.created_at });
  r.get('/conversations', S, wrap(async (req, res) => res.json({ conversations: (await q.all(db, 'SELECT * FROM conversations WHERE user_id=? ORDER BY created_at DESC LIMIT 50', req.user!.id)), provider: { name: provider.name, mock: provider.mock }, actions: ACTIONS })));
  r.post('/conversations', S, wrap(async (req, res) => {
    const b = parse(z.object({ subjectId: z.string().nullish(), lessonId: z.string().nullish(), materialId: z.string().nullish(), lang: z.enum(['ta', 'en', 'both']).optional(), title: z.string().max(100).optional() }), req.body ?? {});
    const p = (await myProfile(db, req.user!.id))!; const id = uid(); const lesson = b.lessonId ? (await q.get<any>(db, 'SELECT title_en, subject_id FROM lessons WHERE id=?', b.lessonId)) : null;
    if (b.materialId && !(await q.get(db, 'SELECT 1 FROM materials WHERE id=? AND user_id=?', b.materialId, req.user!.id))) throw new HttpError(404, 'Material not found.');
    await q.run(db, 'INSERT INTO conversations VALUES (?,?,?,?,?,?,?,?)', id, req.user!.id, b.title ?? lesson?.title_en ?? 'New conversation', b.subjectId ?? lesson?.subject_id ?? null, b.lessonId ?? null, b.materialId ?? null, b.lang ?? p.ai_lang, iso());
    res.status(201).json({ conversation: (await q.get(db, 'SELECT * FROM conversations WHERE id=?', id)) });
  }));
  r.get('/conversations/:id/messages', S, wrap(async (req, res) => { const c = await own(req.params.id, req.user!.id); res.json({ conversation: c, messages: (await q.all<any>(db, 'SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at, rowid', c.id)).map(shape) }); }));
  r.delete('/conversations/:id', S, wrap(async (req, res) => { await own(req.params.id, req.user!.id); await q.run(db, 'DELETE FROM conversations WHERE id=?', req.params.id); res.json({ ok: true }); }));
  r.post('/conversations/:id/messages', S, rateLimit(40, 60000, req => req.user?.id ?? req.ip ?? 'x'), wrap(async (req, res) => {
    const b = parse(z.object({ text: z.string().trim().max(2000).default(''), action: z.string().max(30).optional(), lang: z.enum(['ta', 'en', 'both']).optional() }).refine(v => v.text || v.action, 'Type a question or choose an action'), req.body);
    const c = await own(req.params.id, req.user!.id); const p = (await myProfile(db, req.user!.id))!;
    const under13Pending = (await q.get<any>(db, 'SELECT value FROM settings WHERE key=?', `under13:${req.user!.id}`))?.value === '1' && !p.guardian_approved;
    if (under13Pending) throw new HttpError(403, 'A parent or guardian needs to approve your account before you can use the AI tutor. Ask them to link using your guardian code in Settings.');
    const limit = Number((await q.get<any>(db, "SELECT value FROM settings WHERE key='ai_daily_limit'"))?.value ?? 200);
    const used = (await q.get<any>(db, "SELECT COUNT(*) n FROM ai_usage WHERE user_id=? AND substr(at,1,10)=?", req.user!.id, iso().slice(0, 10)))!.n;
    if (used >= limit) throw new HttpError(429, 'You have reached today’s tutor limit. Please try again tomorrow.');
    const hist = (await q.all<any>(db, 'SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at, rowid', c.id)).map(m => ({ role: m.role, content: J(m.content), meta: J(m.meta) }));
    const lang = b.lang ?? (looksTanglish(b.text) ? 'both' : c.lang);
    let passages: any[] | undefined, materialName: string | undefined;
    if (c.material_id) { const m = (await q.get<any>(db, 'SELECT * FROM materials WHERE id=? AND user_id=?', c.material_id, req.user!.id)); if (m?.text) { materialName = m.name; const pages = J(m.pages) as { page: number; text: string }[]; passages = pages.length ? pages.flatMap(pg => splitPassages(pg.text, pg.page, m.name)) : splitPassages(m.text, undefined, m.name); } }
    const text = b.text || (ACTIONS[b.action!]?.en ?? '');
    let reply;
    try { reply = await provider.reply(db, { userId: req.user!.id, text, action: b.action, lang, classLevel: p.class_level, lessonId: c.lesson_id, subjectId: c.subject_id, materialPassages: passages, materialName, history: hist }); }
    catch { throw new HttpError(502, 'The tutor could not answer just now. Please try again.'); }
    const now = iso(); const um = uid(), am = uid();
    await q.run(db, 'INSERT INTO messages VALUES (?,?,?,?,?,?)', um, c.id, 'user', JSON.stringify({ en: text, ta: text }), JSON.stringify({ action: b.action ?? null }), now);
    await q.run(db, 'INSERT INTO messages VALUES (?,?,?,?,?,?)', am, c.id, 'assistant', JSON.stringify(reply.content), JSON.stringify({ provider: reply.provider, mock: reply.mock, grounded: reply.grounded, sources: reply.sources, suggestions: reply.suggestions, ...reply.meta }), new Date(clock.now().getTime() + 1).toISOString());
    await q.run(db, 'INSERT INTO ai_usage(user_id,provider,kind,input_chars,output_chars,at) VALUES (?,?,?,?,?,?)', req.user!.id, reply.provider, b.action ?? 'chat', text.length, reply.content.en.length + reply.content.ta.length, now);
    if (c.title === 'New conversation' && text) await q.run(db, 'UPDATE conversations SET title=? WHERE id=?', text.slice(0, 60), c.id);
    res.json({ messages: [shape((await q.get(db, 'SELECT * FROM messages WHERE id=?', um))), shape((await q.get(db, 'SELECT * FROM messages WHERE id=?', am)))] });
  }));
  r.post('/messages/:id/report', S, wrap(async (req, res) => {
    const b = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
    const m = (await q.get<any>(db, 'SELECT m.id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.id=? AND c.user_id=?', req.params.id, req.user!.id)); if (!m) throw new HttpError(404, 'Message not found.');
    await audit(db, req.user!.id, 'tutor.report', 'message', m.id, { reason: b.reason }); res.json({ ok: true });
  }));
  return r;
}
