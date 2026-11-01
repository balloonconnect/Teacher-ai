import { Router } from 'express';
import { z } from 'zod';
import { DB, q } from '../db';
import { iso } from '../clock';
import { rateLimit, requireRole } from '../security';
import { parse, wrap } from '../http';
import { HttpError } from '../services/tests';
import { LlmClient, llmClientFromEnv } from '../services/llmEngine';
import { Structure } from '../services/bookStructure';
import { ItemAi, ItemAiError, aiKind, chapterMap, explainItem, itemHash, itemMindMap, itemPractice, questionHints } from '../services/itemLearn';
import { TEMPLATES, formatOf, lessonKindOf } from '../services/learnTemplates';
import { PACK_MINUTES, buildPack } from '../services/revisionPack';

/** The structured view of a book lesson: items in the book's order, per-item mind maps, practice and AI explanations (stored apart, labelled). */
export function structureRoutes(db: DB, opts: { llm?: LlmClient | null } = {}) {
  const r = Router(); const llm = opts.llm === undefined ? llmClientFromEnv() : opts.llm;
  const A = (req: any, _res: any, next: any) => (req.user ? next() : next(new HttpError(401, 'Please sign in.')));
  const load = async (id: string) => {
    const l = await q.get<any>(db, "SELECT * FROM lessons WHERE id=? AND status='published'", id); if (!l) throw new HttpError(404, 'Lesson not found.');
    const c = typeof l.content === 'string' ? JSON.parse(l.content) : l.content; const st = c?.structure as Structure | undefined;
    if (!st?.items?.length) throw new HttpError(404, 'This lesson has no structured view yet. Use “Re-read all pages” on the book.');
    return { l, st };
  };
  const item = (st: Structure, id: string) => { const it = st.items.find(i => i.id === id); if (!it) throw new HttpError(404, 'Item not found.'); return it; };
  const aiRow = async (lid: string, iid: string, kind: string, it: Structure['items'][number]) => {
    const row = await q.get<any>(db, 'SELECT * FROM item_ai WHERE lesson_id=? AND item_id=? AND kind=?', lid, iid, kind); if (!row) return null;
    return { ...JSON.parse(row.content) as ItemAi, label: 'AI-generated', model: row.model, createdAt: row.created_at, stale: row.source_hash !== itemHash(it), verified: row.verified_at && row.source_hash === itemHash(it) ? { by: row.verified_by, at: row.verified_at } : null };
  };

  r.get('/lessons/:id/structure', A, wrap(async (req, res) => {
    const { l, st } = await load(req.params.id);
    const rows = await q.all<any>(db, 'SELECT item_id, kind, source_hash FROM item_ai WHERE lesson_id=?', l.id);
    const ai: Record<string, string[]> = {}; for (const x of rows) (ai[x.item_id] ??= []).push(x.kind);
    res.json({ lessonId: l.id, structure: st, ai, aiEnabled: !!llm, source: 'Original text is from the textbook as read by OCR; check the printed page where an item is flagged. Anything marked AI-generated was written by the app’s AI and is not part of the textbook.' });
  }));
  r.get('/lessons/:id/chapter-map', A, wrap(async (req, res) => { const { l, st } = await load(req.params.id); res.json({ map: chapterMap(l, st) }); }));
  const mine = async (uid: string, lid: string) => { const rows = await q.all<any>(db, 'SELECT * FROM item_progress WHERE student_id=? AND lesson_id=?', uid, lid); return new Map(rows.map(x => [x.item_id, x])); };
  const teachable = (st: Structure) => st.items.filter(i => !['heading', 'poem'].includes(i.kind) || (i.kind === 'poem' && !!i.lines.length));
  r.get('/lessons/:id/items/:itemId', A, wrap(async (req, res) => {
    const { l, st } = await load(req.params.id); const it = item(st, req.params.itemId);
    const idx = st.items.filter(i => !['heading'].includes(i.kind)); const k = idx.findIndex(i => i.id === it.id); const fmt = formatOf(it, lessonKindOf(l.title_en, st));
    const pr = req.user!.role === 'student' ? (await mine(req.user!.id, l.id)).get(it.id) ?? null : null;
    res.json({ item: it, format: fmt, template: TEMPLATES[fmt], explanation: await aiRow(l.id, it.id, 'explain', it), explanation_en: await aiRow(l.id, it.id, 'explain_en', it), answer: await aiRow(l.id, it.id, 'answer', it), official: { hasAnswer: false, note: 'This textbook does not print an answer key for this item.' }, practice: itemPractice(st, it.id), progress: pr && { completed: !!pr.completed_at, attempts: pr.attempts, correct: pr.correct, wrong: pr.wrong }, prev: idx[k - 1]?.id ?? null, next: idx[k + 1]?.id ?? null, aiEnabled: !!llm });
  }));
  // Per-student progress on the items of a lesson. Only students are tracked; for anyone else these are harmless no-ops.
  r.get('/lessons/:id/progress', A, wrap(async (req, res) => {
    const { l, st } = await load(req.params.id); const total = teachable(st).length; if (req.user!.role !== 'student') return res.json({ total, completed: 0, items: {}, last: null, revision: [] });
    const m = await mine(req.user!.id, l.id); const items: Record<string, any> = {}; let completed = 0; let last: any = null;
    for (const [id, x] of m) { items[id] = { completed: !!x.completed_at, attempts: x.attempts, correct: x.correct, wrong: x.wrong }; if (x.completed_at) completed++; if (!last || x.last_at > last.at) last = { id, at: x.last_at }; }
    const ids = new Set(st.items.map(i => i.id));
    res.json({ total, completed, items, last: last && ids.has(last.id) ? last.id : null, revision: [...m].filter(([id, x]) => ids.has(id) && (x.wrong > x.correct || (x.attempts > 0 && !x.completed_at))).map(([id]) => id) });
  }));
  r.post('/lessons/:id/items/:itemId/progress', A, wrap(async (req, res) => {
    const b = parse(z.object({ event: z.enum(['view', 'complete', 'quiz']), correct: z.boolean().optional() }), req.body); const { l, st } = await load(req.params.id); const it = item(st, req.params.itemId);
    if (req.user!.role !== 'student') return res.json({ ok: true, tracked: false }); const now = iso();
    await q.run(db, 'INSERT INTO item_progress(student_id,lesson_id,item_id,last_at) VALUES (?,?,?,?) ON CONFLICT(student_id,lesson_id,item_id) DO NOTHING', req.user!.id, l.id, it.id, now);
    if (b.event === 'view') await q.run(db, 'UPDATE item_progress SET viewed_at=COALESCE(viewed_at,?), last_at=? WHERE student_id=? AND lesson_id=? AND item_id=?', now, now, req.user!.id, l.id, it.id);
    else if (b.event === 'complete') await q.run(db, 'UPDATE item_progress SET completed_at=COALESCE(completed_at,?), last_at=? WHERE student_id=? AND lesson_id=? AND item_id=?', now, now, req.user!.id, l.id, it.id);
    else { if (b.correct === undefined) throw new HttpError(400, 'Say whether the answer was correct.'); await q.run(db, `UPDATE item_progress SET attempts=attempts+1, ${b.correct ? 'correct=correct+1' : 'wrong=wrong+1'}, last_at=? WHERE student_id=? AND lesson_id=? AND item_id=?`, now, req.user!.id, l.id, it.id); }
    res.json({ ok: true, tracked: true });
  }));
  r.get('/lessons/:id/items/:itemId/mindmap', A, wrap(async (req, res) => {
    const { l, st } = await load(req.params.id); const it = item(st, req.params.itemId); const ex = await aiRow(l.id, it.id, 'explain', it);
    res.json({ map: itemMindMap(l, st, it.id, ex && !ex.stale ? ex : null) });
  }));
  // Guided hints for a textbook question, from the chapter's own text. Hint 3 shows the best-matching textbook lines.
  r.get('/lessons/:id/items/:itemId/hints', A, wrap(async (req, res) => { const { st } = await load(req.params.id); item(st, req.params.itemId); res.json({ hints: questionHints(st, req.params.itemId) }); }));
  // A time-boxed revision pack (1, 5, 15 or 30 minutes) from this chapter. Items the student struggled with come first.
  r.get('/lessons/:id/revision-pack', A, wrap(async (req, res) => {
    const m = Number(req.query.minutes ?? 5); if (!(PACK_MINUTES as readonly number[]).includes(m)) throw new HttpError(400, 'Choose 1, 5, 15 or 30 minutes.');
    const { l, st } = await load(req.params.id); let need: string[] = [];
    if (req.user!.role === 'student') { const rows = await q.all<any>(db, 'SELECT item_id, completed_at, attempts, correct, wrong FROM item_progress WHERE student_id=? AND lesson_id=?', req.user!.id, l.id); need = rows.filter(x => x.wrong > x.correct || (x.attempts > 0 && !x.completed_at)).map(x => x.item_id); }
    res.json({ pack: buildPack(st, m, need) });
  }));
  // Lessons made from uploaded books, with how many AI texts exist and how many a teacher has checked.
  r.get('/lesson-review', requireRole('teacher', 'school_admin', 'admin'), wrap(async (_req, res) => {
    const ls = await q.all<any>(db, "SELECT id,class_level,subject_id,chapter_no,title_en,title_ta FROM lessons WHERE id LIKE 'bk-%' AND status='published' ORDER BY class_level, subject_id, chapter_no");
    const ai = await q.all<any>(db, "SELECT lesson_id, COUNT(*) total, SUM(CASE WHEN verified_at IS NOT NULL THEN 1 ELSE 0 END) checked FROM item_ai GROUP BY lesson_id");
    const m = new Map(ai.map(a => [a.lesson_id, a]));
    res.json({ lessons: ls.map(l => ({ ...l, ai_total: Number(m.get(l.id)?.total ?? 0), ai_checked: Number(m.get(l.id)?.checked ?? 0) })) });
  }));
  // Teachers (and admins) mark an AI explanation as checked, or take the mark off again.
  r.post('/lessons/:id/items/:itemId/verify', requireRole('teacher', 'school_admin', 'admin'), wrap(async (req, res) => {
    const b = parse(z.object({ kind: z.enum(['explain', 'explain_en', 'answer']), verified: z.boolean() }), req.body ?? {});
    const { l, st } = await load(req.params.id); const it = item(st, req.params.itemId);
    const row = await q.get<any>(db, 'SELECT 1 x FROM item_ai WHERE lesson_id=? AND item_id=? AND kind=?', l.id, it.id, b.kind); if (!row) throw new HttpError(404, 'There is no AI text here to check yet.');
    await q.run(db, 'UPDATE item_ai SET verified_by=?, verified_at=? WHERE lesson_id=? AND item_id=? AND kind=?', b.verified ? req.user!.display_name ?? 'Teacher' : null, b.verified ? iso() : null, l.id, it.id, b.kind);
    res.json({ ok: true });
  }));
  r.post('/lessons/:id/items/:itemId/ai', A, rateLimit(20, 60000, req => `itemai:${req.user?.id ?? req.ip}`), wrap(async (req, res) => {
    const b = parse(z.object({ mode: z.enum(['explain', 'answer']).default('explain'), lang: z.enum(['ta', 'en']).default('ta') }), req.body ?? {});
    const { l, st } = await load(req.params.id); const it = item(st, req.params.itemId);
    if (!llm) throw new HttpError(501, 'The AI explanation service is not set up on this server (no AI model key is configured). The textbook text is shown as it is.');
    if (b.mode === 'answer' && it.kind !== 'question') throw new HttpError(400, 'Only questions have answers.');
    if (b.mode === 'explain' && it.kind === 'question') throw new HttpError(400, 'Use mode “answer” for questions.');
    const ac = new AbortController(); res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    try {
      const ai = await explainItem(llm, it, b.mode, { lessonKind: lessonKindOf(l.title_en, st), chapter: l.title_ta || l.title_en, signal: ac.signal, lang: b.lang, classLevel: l.class_level }); const kind = aiKind(b.mode, b.lang);
      await q.run(db, 'INSERT INTO item_ai(lesson_id,item_id,kind,content,source_hash,model,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(lesson_id,item_id,kind) DO UPDATE SET content=excluded.content, source_hash=excluded.source_hash, model=excluded.model, created_at=excluded.created_at, verified_by=NULL, verified_at=NULL', l.id, it.id, kind, JSON.stringify(ai), itemHash(it), llm.name, iso());
      await q.run(db, 'INSERT INTO ai_usage(user_id,provider,kind,input_chars,output_chars,at) VALUES (?,?,?,?,?,?)', req.user!.id, llm.name, 'item_ai', it.lines.join('').length, JSON.stringify(ai).length, iso());
      res.json({ [b.mode === 'answer' ? 'answer' : b.lang === 'en' ? 'explanation_en' : 'explanation']: { ...ai, label: 'AI-generated', model: llm.name, stale: false, verified: null } });
    } catch (e) { if (e instanceof ItemAiError) throw new HttpError(e.status, e.message); throw e; }
  }));
  return r;
}
