import { Router } from 'express';
import { z } from 'zod';
import { DB, q } from '../db';
import { requireRole, uid } from '../security';
import { clock, iso } from '../clock';
import { J, parse, wrap, canAccessStudent } from '../http';
import { HttpError, testStatus, topicPerformance } from '../services/tests';
import { gradeAnswer } from '../services/grading';
import { buildMindMap } from '../services/mindmap';

const L = (l: any) => ({ id: l.id, class_level: l.class_level, subject_id: l.subject_id, chapter_no: l.chapter_no, chapter_en: l.chapter_en, chapter_ta: l.chapter_ta, title_en: l.title_en, title_ta: l.title_ta, minutes: l.minutes, term: l.term });
/** Published lessons for a class and subject. Once a textbook has supplied lessons for it, the sample lessons are left out. */
export async function subjectLessons(db: DB, cls: number, subjectId: string) {
  const rows = await q.all<any>(db, "SELECT * FROM lessons WHERE class_level=? AND subject_id=? AND status='published' ORDER BY chapter_no, position", cls, subjectId);
  return rows.some(l => String(l.source).startsWith('Textbook:')) ? rows.filter(l => String(l.source).startsWith('Textbook:')) : rows;
}
/** Practice questions come from the textbook once it has supplied some for the subject, else from the sample bank. */
export async function practiceRows(db: DB, cls: number, subjectId: string) {
  const rows = await q.all<any>(db, "SELECT * FROM questions WHERE origin='practice' AND status='published' AND class_level=? AND subject_id=?", cls, subjectId);
  return rows.some(x => x.created_by === 'book-import') ? rows.filter(x => x.created_by === 'book-import') : rows;
}
export async function myProfile(db: DB, id: string) { return (await q.get<any>(db, 'SELECT * FROM student_profiles WHERE user_id=?', id)); }

/** Weekly report numbers computed only from real stored records. */
export async function studentReport(db: DB, studentId: string) {
  const atts = (await q.all<any>(db, `SELECT a.id, a.test_id, a.attempt_no, a.submitted_at, a.context, r.marks, r.total, r.pct, r.status, t.title FROM attempts a JOIN results r ON r.attempt_id=a.id JOIN tests t ON t.id=a.test_id WHERE a.student_id=? AND a.status='finalised' ORDER BY a.submitted_at`, studentId));
  const passed = atts.filter(a => a.status === 'passed').length;
  const bySubject = new Map<string, { name: string; sum: number; n: number }>();
  const missed = new Map<string, { got: number; max: number }>();
  for (const a of atts) { const c = J(a.context); const e = bySubject.get(c.subject_id) ?? { name: c.subject_en, sum: 0, n: 0 }; e.sum += a.pct; e.n++; bySubject.set(c.subject_id, e);
    for (const t of await topicPerformance(db, a.id)) { const m = missed.get(t.topic) ?? { got: 0, max: 0 }; m.got += t.got; m.max += t.max; missed.set(t.topic, m); } }
  const pending = (await q.get<{ n: number }>(db, "SELECT COUNT(*) n FROM attempts WHERE student_id=? AND status='pending_review'", studentId))!.n;
  return {
    attempted: atts.length + pending, finalised: atts.length, passed, passRate: atts.length ? Math.round((passed / atts.length) * 100) : null, pending,
    scores: atts.map(a => ({ test: a.title, pct: a.pct, date: a.submitted_at, status: a.status })),
    subjects: [...bySubject].map(([id, v]) => ({ id, name: v.name, avgPct: Math.round(v.sum / v.n), tests: v.n })),
    revisionTopics: [...missed].map(([topic, v]) => ({ topic, pct: Math.round((v.got / v.max) * 100) })).filter(t => t.pct < 70).sort((a, b) => a.pct - b.pct),
  };
}
export async function activitySummary(db: DB, studentId: string) {
  const since = iso(new Date(clock.now().getTime() - 7 * 864e5));
  const days: { day: string; lessons: number; practice: number; tests: number; tutor: number }[] = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(clock.now().getTime() - i * 864e5); const day = d.toISOString().slice(0, 10);
    days.push({ day, lessons: (await q.get<any>(db, "SELECT COUNT(*) n FROM lesson_progress WHERE student_id=? AND substr(opened_at,1,10)=?", studentId, day))!.n, practice: (await q.get<any>(db, "SELECT COUNT(*) n FROM practice_sessions WHERE student_id=? AND submitted_at IS NOT NULL AND substr(submitted_at,1,10)=?", studentId, day))!.n,
      tests: (await q.get<any>(db, "SELECT COUNT(*) n FROM attempts WHERE student_id=? AND substr(started_at,1,10)=?", studentId, day))!.n, tutor: (await q.get<any>(db, "SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.user_id=? AND m.role='user' AND substr(m.created_at,1,10)=?", studentId, day))!.n }); }
  return { since, days, activeDays: days.filter(d => d.lessons + d.practice + d.tests + d.tutor > 0).length };
}

export function studentRoutes(db: DB) {
  const r = Router(); const S = requireRole('student');
  r.get('/dashboard', S, wrap(async (req, res) => {
    const id = req.user!.id; const p = await myProfile(db, id); if (!p?.completed_at) throw new HttpError(409, 'Please complete your student profile first.');
    const subs = J(p.subjects) as string[];
    const lessons = (await q.all<any>(db, "SELECT * FROM lessons WHERE class_level=? AND status='published' ORDER BY subject_id, chapter_no, position", p.class_level));
    const prog = new Map((await q.all<any>(db, 'SELECT * FROM lesson_progress WHERE student_id=?', id)).map(x => [x.lesson_id, x]));
    const subjectCards = (await q.all<any>(db, 'SELECT * FROM subjects')).filter(s => subs.includes(s.id)).map(s => { const ls = lessons.filter(l => l.subject_id === s.id); const done = ls.filter(l => prog.get(l.id)?.completed_at).length; return { id: s.id, name_en: s.name_en, name_ta: s.name_ta, lessons: ls.length, completed: done, pct: ls.length ? Math.round((done / ls.length) * 100) : 0 }; });
    const open = lessons.filter(l => subs.includes(l.subject_id) && !prog.get(l.id)?.completed_at).sort((a, b) => (prog.get(b.id)?.opened_at ?? '').localeCompare(prog.get(a.id)?.opened_at ?? ''));
    const report = await studentReport(db, id); const nowS = iso();
    const tests = (await q.all<any>(db, 'SELECT t.*, s.name_en subject_en, s.name_ta subject_ta FROM tests t JOIN subjects s ON s.id=t.subject_id WHERE t.published=1 AND t.class_level=? AND t.academic_year=?', p.class_level, p.academic_year)).filter(t => subs.includes(t.subject_id));
    const withStatus = (await Promise.all(tests.map(async t => ({ t, st: await testStatus(db, t, id) }))));
    const latest = (await q.all<any>(db, "SELECT a.id attempt_id, t.title, r.marks, r.total, r.pct, r.status, a.submitted_at FROM attempts a JOIN results r ON r.attempt_id=a.id JOIN tests t ON t.id=a.test_id WHERE a.student_id=? AND a.status!='in_progress' ORDER BY a.submitted_at DESC LIMIT 4", id));
    const today = nowS.slice(0, 10); const act = await activitySummary(db, id); const td = act.days[act.days.length - 1];
    const bm = (await q.all<any>(db, 'SELECT * FROM bookmarks WHERE student_id=? ORDER BY created_at DESC LIMIT 5', id));
    res.json({
      profile: { name: p.preferred_name || p.full_name, class_level: p.class_level, medium: p.medium, academic_year: p.academic_year, ai_lang: p.ai_lang, ref_no: p.ref_no },
      continueLesson: open[0] ? L(open[0]) : null, recentLessons: [...prog.values()].sort((a, b) => b.opened_at.localeCompare(a.opened_at)).slice(0, 4).map(x => lessons.find(l => l.id === x.lesson_id)).filter(Boolean).map(L),
      subjects: subjectCards, goals: [{ id: 'lesson', label_en: 'Open or finish a lesson', label_ta: 'ஒரு பாடத்தைத் திறக்க/முடிக்க', done: td.lessons > 0 }, { id: 'practice', label_en: 'Finish a practice set', label_ta: 'ஒரு பயிற்சித் தொகுப்பை முடிக்க', done: td.practice > 0 }, { id: 'tutor', label_en: 'Ask the AI tutor a question', label_ta: 'AI ஆசிரியரிடம் ஒரு கேள்வி கேட்க', done: td.tutor > 0 }], activity: act,
      upcoming: withStatus.filter(x => ['Available', 'In progress', 'Upcoming'].includes(x.st.status)).sort((a, b) => a.t.opens_at.localeCompare(b.t.opens_at)).slice(0, 4).map(x => ({ id: x.t.id, title: x.t.title, subject_en: x.t.subject_en, status: x.st.status, closes_at: x.t.closes_at, opens_at: x.t.opens_at, duration_min: x.t.duration_min })),
      toComplete: withStatus.filter(x => ['Available', 'In progress'].includes(x.st.status)).length,
      latestResults: latest, passRate: report.passRate, passRateBasis: report.finalised, certificates: (await q.get<any>(db, "SELECT COUNT(*) n FROM certificates WHERE student_id=? AND status='valid'", id))!.n,
      revision: report.revisionTopics.slice(0, 4), bookmarks: bm, today,
      recommendedPractice: report.revisionTopics[0] ? { topic: report.revisionTopics[0].topic, reason: 'Based on your test results' } : (open[0] ? { topic: open[0].title_en, reason: 'Next lesson in your plan' } : null),
    });
  }));
  r.get('/curriculum', wrap(async (req, res) => {
    const p = req.user!.role === 'student' ? (await myProfile(db, req.user!.id)) : null;
    const cls = Number(req.query.class ?? p?.class_level ?? 8); const prog = new Map((await q.all<any>(db, 'SELECT * FROM lesson_progress WHERE student_id=?', req.user!.id)).map(x => [x.lesson_id, x]));
    const subjects = (await Promise.all((await q.all<any>(db, 'SELECT * FROM subjects')).map(async s => ({ ...s, lessons: (await subjectLessons(db, cls, s.id)).map(l => ({ ...L(l), completed: !!prog.get(l.id)?.completed_at, source: l.source })) })))).filter(s => s.lessons.length);
    res.json({ classLevel: cls, board: 'Tamil Nadu State Board (Samacheer Kalvi)', subjects, fromBooks: subjects.filter(x => x.lessons.some((l: any) => String(l.source).startsWith('Textbook:'))).map(x => x.id), note: 'Sample content for this prototype. Official curriculum content must be imported and reviewed before use.' });
  }));
  r.get('/lessons/:id', wrap(async (req, res) => {
    const l = (await q.get<any>(db, "SELECT * FROM lessons WHERE id=? AND status='published'", req.params.id)); if (!l) throw new HttpError(404, 'Lesson not found.');
    const sid = req.user!.id; const pr = (await q.get<any>(db, 'SELECT * FROM lesson_progress WHERE student_id=? AND lesson_id=?', sid, l.id));
    const sib = (await q.all<any>(db, "SELECT id,title_en,title_ta FROM lessons WHERE class_level=? AND subject_id=? AND status='published' ORDER BY chapter_no, position", l.class_level, l.subject_id));
    const i = sib.findIndex(x => x.id === l.id); const sub = (await q.get<any>(db, 'SELECT * FROM subjects WHERE id=?', l.subject_id));
    res.json({ lesson: { ...L(l), content: J(l.content), source: l.source, subject_en: sub.name_en, subject_ta: sub.name_ta }, progress: { opened: !!pr, completed: !!pr?.completed_at }, prev: sib[i - 1] ?? null, next: sib[i + 1] ?? null, bookmarked: !!(await q.get(db, "SELECT 1 FROM bookmarks WHERE student_id=? AND kind='lesson' AND ref=?", sid, l.id)) });
  }));
  r.post('/lessons/:id/open', S, wrap(async (req, res) => { const l = (await q.get(db, 'SELECT 1 FROM lessons WHERE id=?', req.params.id)); if (!l) throw new HttpError(404, 'Lesson not found.'); await q.run(db, 'INSERT INTO lesson_progress(student_id,lesson_id,opened_at) VALUES (?,?,?) ON CONFLICT DO NOTHING', req.user!.id, req.params.id, iso()); res.json({ ok: true }); }));
  r.post('/lessons/:id/complete', S, wrap(async (req, res) => { const l = (await q.get(db, 'SELECT 1 FROM lessons WHERE id=?', req.params.id)); if (!l) throw new HttpError(404, 'Lesson not found.'); await q.run(db, 'INSERT INTO lesson_progress(student_id,lesson_id,opened_at,completed_at) VALUES (?,?,?,?) ON CONFLICT(student_id,lesson_id) DO UPDATE SET completed_at=COALESCE(completed_at, excluded.completed_at)', req.user!.id, req.params.id, iso(), iso()); res.json({ ok: true }); }));
  // Mind map: the shared map comes from lesson content; each student's marks are stored separately under their own key.
  const mmKey = (sid: string, lid: string) => `mm:${sid}:${lid}`;
  const mmState = async (sid: string, lid: string) => { const v = (await q.get<any>(db, 'SELECT value FROM settings WHERE key=?', mmKey(sid, lid)))?.value; const s = v ? J(v) : {}; return { understood: (s.understood ?? []) as string[], revision: (s.revision ?? []) as string[], viewedAt: (s.viewedAt ?? null) as string | null }; };
  r.get('/lessons/:id/mindmap', S, wrap(async (req, res) => {
    const l = (await q.get<any>(db, "SELECT * FROM lessons WHERE id=? AND status='published'", req.params.id)); if (!l) throw new HttpError(404, 'Lesson not found.');
    let map; try { map = buildMindMap({ id: l.id, title_en: l.title_en, title_ta: l.title_ta, content: J(l.content), source: l.source }); } catch { throw new HttpError(500, 'The mind map for this lesson could not be built.'); }
    const sid = req.user!.id; const st = await mmState(sid, l.id); const ids = new Set(map.nodes.map(n => n.id));
    const state = { understood: st.understood.filter(x => ids.has(x)), revision: st.revision.filter(x => ids.has(x)), viewedAt: st.viewedAt };
    await q.run(db, 'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', mmKey(sid, l.id), JSON.stringify({ ...state, viewedAt: iso() }));
    res.json({ map: { ...map, defaultMode: l.class_level <= 5 ? 'simple' : map.defaultMode }, state, classLevel: l.class_level, subject_id: l.subject_id });
  }));
  r.put('/lessons/:id/mindmap/state', S, wrap(async (req, res) => {
    const l = (await q.get<any>(db, "SELECT * FROM lessons WHERE id=? AND status='published'", req.params.id)); if (!l) throw new HttpError(404, 'Lesson not found.');
    const b = parse(z.object({ understood: z.array(z.string().max(40)).max(120), revision: z.array(z.string().max(40)).max(120) }), req.body);
    const map = buildMindMap({ id: l.id, title_en: l.title_en, title_ta: l.title_ta, content: J(l.content), source: l.source }); const ids = new Set(map.nodes.map(n => n.id));
    const clean = (a: string[]) => [...new Set(a)].filter(x => ids.has(x)); const understood = clean(b.understood); const revision = clean(b.revision).filter(x => !understood.includes(x));
    await q.run(db, 'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', mmKey(req.user!.id, l.id), JSON.stringify({ understood, revision, viewedAt: iso() }));
    res.json({ understood, revision });
  }));
  r.get('/mindmaps/recent', S, wrap(async (req, res) => {
    const rows = (await q.all<any>(db, 'SELECT key, value FROM settings WHERE key LIKE ?', `mm:${req.user!.id}:%`));
    const out = (await Promise.all(rows.map(async x => { const lid = x.key.slice(`mm:${req.user!.id}:`.length); const s = J(x.value); const l = (await q.get<any>(db, "SELECT id,title_en,title_ta,class_level FROM lessons WHERE id=? AND status='published'", lid)); return l ? { lessonId: lid, title_en: l.title_en, title_ta: l.title_ta, understood: (s.understood ?? []).length, revision: (s.revision ?? []).length, viewedAt: s.viewedAt } : null; }))).filter(Boolean) as any[];
    res.json({ recent: out.sort((a, b) => String(b.viewedAt).localeCompare(String(a.viewedAt))).slice(0, 10) });
  }));
  // Bookmarks
  r.get('/bookmarks', S, wrap(async (req, res) => res.json({ bookmarks: (await q.all(db, 'SELECT * FROM bookmarks WHERE student_id=? ORDER BY created_at DESC', req.user!.id)) })));
  r.post('/bookmarks', S, wrap(async (req, res) => {
    const b = parse(z.object({ kind: z.enum(['lesson', 'message', 'question']), ref: z.string().max(100), title: z.string().max(200) }), req.body);
    await q.run(db, 'INSERT INTO bookmarks VALUES (?,?,?,?,?,?) ON CONFLICT(student_id,kind,ref) DO NOTHING', uid(), req.user!.id, b.kind, b.ref, b.title, iso()); res.status(201).json({ ok: true });
  }));
  r.delete('/bookmarks/:id', S, wrap(async (req, res) => { await q.run(db, 'DELETE FROM bookmarks WHERE id=? AND student_id=?', req.params.id, req.user!.id); res.json({ ok: true }); }));
  r.delete('/bookmarks', S, wrap(async (req, res) => { const b = parse(z.object({ kind: z.string(), ref: z.string() }), req.query); await q.run(db, 'DELETE FROM bookmarks WHERE student_id=? AND kind=? AND ref=?', req.user!.id, b.kind, b.ref); res.json({ ok: true }); }));
  // Notifications
  r.get('/notifications', wrap(async (req, res) => res.json({ notifications: (await q.all(db, 'SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50', req.user!.id)), unread: (await q.get<any>(db, 'SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0', req.user!.id))!.n })));
  r.post('/notifications/read', wrap(async (req, res) => { await q.run(db, 'UPDATE notifications SET read=1 WHERE user_id=?', req.user!.id); res.json({ ok: true }); }));
  // Practice centre
  r.get('/practice/options', S, wrap(async (req, res) => {
    const p = (await myProfile(db, req.user!.id))!; const subs = (await q.all<any>(db, `SELECT s.id, s.name_en, s.name_ta, COUNT(*) n FROM questions qu JOIN subjects s ON s.id=qu.subject_id WHERE qu.origin='practice' AND qu.status='published' AND qu.class_level=? GROUP BY s.id`, p.class_level));
    res.json({ classLevel: p.class_level, subjects: (await Promise.all(subs.map(async s => ({ ...s, chapters: [...new Set((await practiceRows(db, p.class_level, s.id)).map(x => x.chapter_no).filter(n => n != null))].sort((a, b) => a - b) })))) });
  }));
  r.post('/practice/start', S, wrap(async (req, res) => {
    const b = parse(z.object({ subject: z.string(), chapter: z.number().int().optional(), difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).default('mixed'), count: z.number().int().min(1).max(20).default(5), types: z.array(z.string()).optional() }), req.body);
    const p = (await myProfile(db, req.user!.id))!;
    let rows = await practiceRows(db, p.class_level, b.subject);
    if (b.chapter) rows = rows.filter(x => x.chapter_no === b.chapter); if (b.difficulty !== 'mixed') rows = rows.filter(x => x.difficulty === b.difficulty); if (b.types?.length) rows = rows.filter(x => b.types!.includes(x.type));
    if (!rows.length) throw new HttpError(404, 'No questions match these choices yet. Try another chapter or difficulty.');
    const chosen = rows.sort(() => Math.random() - 0.5).slice(0, b.count); const id = uid();
    await q.run(db, 'INSERT INTO practice_sessions(id,student_id,question_ids,created_at) VALUES (?,?,?,?)', id, req.user!.id, JSON.stringify(chosen.map(c => c.id)), iso());
    res.json({ sessionId: id, label: 'Practice questions come from our question bank. Answers are shown only after you submit.', questions: chosen.map(c => ({ id: c.id, type: c.type, text_en: c.text_en, text_ta: c.text_ta, options: J(c.options), marks: c.marks, topic: c.topic })) });
  }));
  r.post('/practice/:id/submit', S, wrap(async (req, res) => {
    const b = parse(z.object({ answers: z.record(z.string(), z.any()) }), req.body);
    const s = (await q.get<any>(db, 'SELECT * FROM practice_sessions WHERE id=? AND student_id=?', req.params.id, req.user!.id)); if (!s) throw new HttpError(404, 'Practice session not found.');
    if (s.submitted_at) throw new HttpError(409, 'This practice set was already submitted.');
    const ids = J(s.question_ids) as string[]; let score = 0; const topicsMissed = new Set<string>();
    const results = (await Promise.all(ids.map(async id => { const qu = (await q.get<any>(db, 'SELECT * FROM questions WHERE id=?', id))!; const g = gradeAnswer(qu.type, J(qu.answer), b.answers[id], qu.marks); const ok = g.kind === 'auto' && g.correct; if (ok) score += qu.marks; else if (qu.topic) topicsMissed.add(qu.topic);
      const key = J(qu.answer); const correct = qu.type === 'mcq' || qu.type === 'tf' ? J(qu.options)[key] : qu.type === 'numeric' ? String(key.value) : key.accept?.[0];
      return { id, text_en: qu.text_en, text_ta: qu.text_ta, correct: ok, given: b.answers[id] ?? null, correctAnswer: correct, explanation_en: qu.explanation_en, explanation_ta: qu.explanation_ta, topic: qu.topic }; })));
    const total = ids.length; await q.run(db, 'UPDATE practice_sessions SET submitted_at=?, score=?, total=? WHERE id=?', iso(), score, total, s.id);
    res.json({ score, total, pct: Math.round((score / total) * 100), results, revise: [...topicsMissed], next: score / total >= 0.8 ? 'Great work — try a harder set or the next lesson.' : 'Review the explanations, then try another set on the same topic.' });
  }));
  r.get('/reports/me', S, wrap(async (req, res) => res.json({ report: await studentReport(db, req.user!.id), activity: await activitySummary(db, req.user!.id) })));
  r.get('/reports/students/:id', wrap(async (req, res) => { if (!(await canAccessStudent(db, req.user!, req.params.id))) throw new HttpError(403, 'You do not have access to this student.'); res.json({ report: await studentReport(db, req.params.id), activity: await activitySummary(db, req.params.id) }); }));
  // Assignments
  r.get('/assignments', S, wrap(async (req, res) => res.json({ assignments: (await q.all(db, `SELECT a.*, s.submitted_at, s.text submission, s.feedback FROM assignments a JOIN enrolments e ON e.class_id=a.class_id LEFT JOIN submissions s ON s.assignment_id=a.id AND s.student_id=e.student_id WHERE e.student_id=? ORDER BY a.due_at`, req.user!.id)) })));
  r.post('/assignments/:id/submit', S, wrap(async (req, res) => {
    const b = parse(z.object({ text: z.string().trim().min(1, 'Write your answer').max(5000) }), req.body);
    if (!(await q.get(db, 'SELECT 1 FROM assignments a JOIN enrolments e ON e.class_id=a.class_id WHERE a.id=? AND e.student_id=?', req.params.id, req.user!.id))) throw new HttpError(404, 'Assignment not found.');
    await q.run(db, 'INSERT INTO submissions(assignment_id,student_id,text,submitted_at) VALUES (?,?,?,?) ON CONFLICT(assignment_id,student_id) DO UPDATE SET text=excluded.text, submitted_at=excluded.submitted_at', req.params.id, req.user!.id, b.text, iso()); res.json({ ok: true });
  }));
  return r;
}
