import { Router } from 'express';
import { z } from 'zod';
import { DB, q, tx } from '../db';
import { audit, requireRole, uid } from '../security';
import { iso } from '../clock';
import { J, canAccessStudent, parse, wrap } from '../http';
import { HttpError, correctResult, testQuestions } from '../services/tests';
import { studentReport } from './student';

const T = requireRole('teacher', 'school_admin', 'admin');
const QType = z.enum(['mcq', 'tf', 'fill', 'numeric', 'short']);
const QuestionIn = z.object({ subjectId: z.string(), classLevel: z.number().int().min(1).max(12), chapterNo: z.number().int().nullish(), type: QType, textEn: z.string().trim().min(3).max(1000), textTa: z.string().trim().max(1000).optional(),
  options: z.array(z.string().trim().min(1).max(200)).max(6).default([]), answer: z.any(), marks: z.number().positive().max(100).default(1), difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'), explanationEn: z.string().max(1000).optional(), explanationTa: z.string().max(1000).optional(), topic: z.string().max(80).optional() });
function validateAnswer(b: z.infer<typeof QuestionIn>) {
  if (b.type === 'mcq') { if (b.options.length < 2) throw new HttpError(400, 'Multiple-choice questions need at least 2 options.'); if (!Number.isInteger(b.answer) || b.answer < 0 || b.answer >= b.options.length) throw new HttpError(400, 'Choose the correct option.'); return b.answer; }
  if (b.type === 'tf') { if (![0, 1].includes(b.answer)) throw new HttpError(400, 'Choose True or False.'); return b.answer; }
  if (b.type === 'fill') { const a = Array.isArray(b.answer) ? b.answer : [b.answer]; if (!a.length || a.some(x => !String(x).trim())) throw new HttpError(400, 'Provide at least one accepted answer.'); return { accept: a.map(String) }; }
  if (b.type === 'numeric') { const v = Number(b.answer); if (!Number.isFinite(v)) throw new HttpError(400, 'Provide a numeric answer.'); return { value: v }; }
  if (!String(b.answer ?? '').trim()) throw new HttpError(400, 'Provide a marking guide for short answers.'); return { rubric: String(b.answer) };
}
const TestIn = z.object({ title: z.string().trim().min(3).max(120), description: z.string().max(500).optional(), classLevel: z.number().int().min(1).max(12), subjectId: z.string(), academicYear: z.string().regex(/^\d{4}[–-]\d{4}$/), topics: z.array(z.string().max(60)).max(10).default([]), weekNo: z.number().int().nullish(),
  opensAt: z.string().datetime(), closesAt: z.string().datetime(), durationMin: z.number().int().min(5).max(240).nullable(), language: z.enum(['ta', 'en', 'both']).default('both'), instructions: z.string().max(1000).optional(),
  passPct: z.number().min(0).max(100), maxAttempts: z.number().int().min(1).max(5).default(1), scoreRule: z.enum(['highest', 'latest']).default('highest'), showReview: z.number().int().min(0).max(2).default(1), awardsCertificate: z.boolean().default(true), allowChangeAnswers: z.boolean().default(true), autoSubmit: z.boolean().default(true),
  questions: z.array(z.object({ questionId: z.string(), marks: z.number().positive().max(100) })).min(1).max(100) });

export function teacherRoutes(db: DB) {
  const r = Router(); r.use(T);
  const testRow = async (req: any, id: string) => { const t = (await q.get<any>(db, 'SELECT * FROM tests WHERE id=?', id)); const u = req.user!; if (!t || !(u.role === 'admin' || (u.school_id && t.school_id === u.school_id))) throw new HttpError(404, 'Test not found.'); return t; };
  const classRow = async (req: any, id: string) => { const c = (await q.get<any>(db, 'SELECT * FROM classes WHERE id=?', id)); const u = req.user!; if (!c || !(u.role === 'admin' || (u.role === 'teacher' && c.teacher_id === u.id) || (u.role === 'school_admin' && c.school_id === u.school_id))) throw new HttpError(404, 'Class not found.'); return c; };
  const myClasses = async (req: any) => (await q.all<any>(db, req.user!.role === 'teacher' ? 'SELECT * FROM classes WHERE teacher_id=?' : req.user!.role === 'school_admin' ? 'SELECT * FROM classes WHERE school_id=?' : 'SELECT * FROM classes WHERE ?=?', ...(req.user!.role === 'admin' ? [1, 1] : [req.user!.role === 'teacher' ? req.user!.id : req.user!.school_id])));
  r.get('/overview', wrap(async (req, res) => {
    const classes = await myClasses(req); const ids = classes.map(c => c.id); const students = ids.length ? (await q.all<any>(db, `SELECT DISTINCT e.student_id FROM enrolments e WHERE e.class_id IN (${ids.map(() => '?').join(',')})`, ...ids)) : [];
    const pending = (await pendingReviews(req)).length; const tests = (await q.all<any>(db, 'SELECT id,title,opens_at,closes_at,published FROM tests WHERE school_id=? ORDER BY opens_at DESC LIMIT 6', req.user!.school_id ?? ''));
    res.json({ classes: classes.length, students: students.length, pendingReviews: pending, tests });
  }));
  r.get('/classes', wrap(async (req, res) => res.json({ classes: (await Promise.all((await myClasses(req)).map(async c => ({ ...c, students: (await q.get<any>(db, 'SELECT COUNT(*) n FROM enrolments WHERE class_id=?', c.id))!.n })))) })));
  r.get('/classes/:id/students', wrap(async (req, res) => {
    const c = await classRow(req, req.params.id);
    res.json({ class: c, students: (await Promise.all((await q.all<any>(db, 'SELECT u.id, u.display_name, p.full_name, p.ref_no, p.class_level FROM enrolments e JOIN users u ON u.id=e.student_id JOIN student_profiles p ON p.user_id=u.id WHERE e.class_id=? ORDER BY p.full_name', c.id)).map(async s => ({ ...s, report: (({ finalised, passed, passRate, pending }) => ({ finalised, passed, passRate, pending }))(await studentReport(db, s.id)) })))) });
  }));
  r.post('/classes/:id/students', wrap(async (req, res) => {
    const c = await classRow(req, req.params.id); const b = parse(z.object({ refNo: z.string().trim().min(4).max(30) }), req.body);
    const s = (await q.get<any>(db, 'SELECT p.user_id, u.school_id FROM student_profiles p JOIN users u ON u.id=p.user_id WHERE p.ref_no=?', b.refNo.toUpperCase())); if (!s || s.school_id !== c.school_id) throw new HttpError(404, 'No student with that reference number in this school.');
    await q.run(db, 'INSERT INTO enrolments VALUES (?,?) ON CONFLICT DO NOTHING', c.id, s.user_id); await audit(db, req.user!.id, 'class.enrol', 'class', c.id, { student: s.user_id }); res.json({ ok: true });
  }));
  r.delete('/classes/:id/students/:sid', wrap(async (req, res) => { const c = await classRow(req, req.params.id); await q.run(db, 'DELETE FROM enrolments WHERE class_id=? AND student_id=?', c.id, req.params.sid); await audit(db, req.user!.id, 'class.unenrol', 'class', c.id, { student: req.params.sid }); res.json({ ok: true }); }));
  r.get('/classes/:id/report', wrap(async (req, res) => {
    const c = await classRow(req, req.params.id); const sids = (await q.all<any>(db, 'SELECT student_id FROM enrolments WHERE class_id=?', c.id)).map(x => x.student_id);
    const reports = (await Promise.all(sids.map(id => studentReport(db, id)))); const finalised = reports.reduce((s, x) => s + x.finalised, 0), passed = reports.reduce((s, x) => s + x.passed, 0);
    const missed = new Map<string, { n: number; sum: number }>(); for (const rp of reports) for (const t of rp.revisionTopics) { const m = missed.get(t.topic) ?? { n: 0, sum: 0 }; m.n++; m.sum += t.pct; missed.set(t.topic, m); }
    res.json({ class: c, students: sids.length, attempts: finalised, passed, passRate: finalised ? Math.round((passed / finalised) * 100) : null, frequentlyMissed: [...missed].map(([topic, v]) => ({ topic, students: v.n, avgPct: Math.round(v.sum / v.n) })).sort((a, b) => b.students - a.students), note: 'Calculated from finalised assessment records only.' });
  }));
  // ---- Question bank ----
  r.get('/questions', wrap(async (req, res) => {
    const rows = (await q.all<any>(db, "SELECT q.*, s.name_en subject_en FROM questions q JOIN subjects s ON s.id=q.subject_id WHERE (q.school_id=? OR ?='admin' OR q.origin='book') AND q.origin!='practice' ORDER BY q.class_level, q.subject_id, q.id", req.user!.school_id ?? '', req.user!.role))
      .filter(x => (!req.query.subject || x.subject_id === req.query.subject) && (!req.query.status || x.status === req.query.status) && (!req.query.class || x.class_level === Number(req.query.class)));
    res.json({ questions: rows.map(x => ({ ...x, options: J(x.options), answer: J(x.answer) })) });
  }));
  r.post('/questions', wrap(async (req, res) => {
    const b = parse(QuestionIn, req.body); const ans = validateAnswer(b); const id = uid();
    await q.run(db, 'INSERT INTO questions(id,subject_id,class_level,chapter_no,type,text_en,text_ta,options,answer,marks,difficulty,explanation_en,explanation_ta,topic,origin,status,created_by,school_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, b.subjectId, b.classLevel, b.chapterNo ?? null, b.type, b.textEn, b.textTa ?? null, JSON.stringify(b.options), JSON.stringify(ans), b.marks, b.difficulty, b.explanationEn ?? null, b.explanationTa ?? null, b.topic ?? null, 'teacher', 'published', req.user!.id, req.user!.school_id);
    await audit(db, req.user!.id, 'question.create', 'question', id); res.status(201).json({ id });
  }));
  /** AI-assisted draft generation (development generator). Drafts must be reviewed and published by a teacher before use in tests. */
  r.post('/questions/drafts', wrap(async (req, res) => {
    const b = parse(z.object({ subjectId: z.string(), classLevel: z.number().int().min(1).max(12), count: z.number().int().min(1).max(10).default(3) }), req.body); const ids: string[] = [];
    if (b.subjectId !== 'maths') throw new HttpError(422, 'The development draft generator currently supports Mathematics equations only. Connect an AI provider for other subjects.');
    for (let i = 0; i < b.count; i++) { const a = 2 + Math.floor(Math.random() * 8), x = 1 + Math.floor(Math.random() * 12), c = 1 + Math.floor(Math.random() * 15); const id = uid(); ids.push(id);
      await q.run(db, 'INSERT INTO questions(id,subject_id,class_level,chapter_no,type,text_en,text_ta,options,answer,marks,difficulty,explanation_en,explanation_ta,topic,origin,status,created_by,school_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, 'maths', b.classLevel, 1, 'numeric', `Solve: ${a}x + ${c} = ${a * x + c}. x = ?`, `${a}x + ${c} = ${a * x + c} ஐத் தீர்க்க. x = ?`, '[]', JSON.stringify({ value: x }), 1, 'medium', `Subtract ${c}, then divide by ${a}.`, `${c} ஐக் கழித்து ${a} ஆல் வகுக்க.`, 'Two-step equations', 'ai_draft', 'draft', req.user!.id, req.user!.school_id); }
    await audit(db, req.user!.id, 'question.draft_generate', 'question', undefined, { ids }); res.status(201).json({ ids, note: 'Drafts are not usable in tests until you review and publish them.' });
  }));
  r.post('/questions/:id/publish', wrap(async (req, res) => { const x = (await q.get<any>(db, 'SELECT * FROM questions WHERE id=?', req.params.id)); if (!x || (x.school_id !== req.user!.school_id && req.user!.role !== 'admin')) throw new HttpError(404, 'Question not found.'); await q.run(db, "UPDATE questions SET status='published' WHERE id=?", x.id); await audit(db, req.user!.id, 'question.publish', 'question', x.id); res.json({ ok: true }); }));
  // ---- Tests ----
  r.get('/tests', wrap(async (req, res) => res.json({ tests: (await q.all<any>(db, 'SELECT t.*, s.name_en subject_en, (SELECT COUNT(*) FROM test_questions WHERE test_id=t.id) question_count, (SELECT COALESCE(SUM(marks),0) FROM test_questions WHERE test_id=t.id) total_marks, (SELECT COUNT(*) FROM attempts WHERE test_id=t.id) attempts FROM tests t JOIN subjects s ON s.id=t.subject_id WHERE (t.school_id=? OR ?=\'admin\') ORDER BY t.opens_at DESC', req.user!.school_id ?? '', req.user!.role)).map(t => ({ ...t, topics: J(t.topics) })) })));
  const saveTest = async (req: any, id: string | null) => {
    const b = parse(TestIn, req.body); if (b.opensAt >= b.closesAt) throw new HttpError(400, 'The closing time must be after the opening time.');
    const total = b.questions.reduce((s, x) => s + x.marks, 0); if (total <= 0) throw new HttpError(400, 'Total marks must be greater than zero.');
    for (const it of b.questions) { const qu = (await q.get<any>(db, 'SELECT * FROM questions WHERE id=?', it.questionId)); if (!qu || qu.class_level !== b.classLevel || qu.subject_id !== b.subjectId) throw new HttpError(400, 'Every question must match the test’s class and subject.'); if (qu.origin === 'practice') throw new HttpError(400, 'Practice-centre questions cannot be used in tests.'); }
    const tid = id ?? uid();
    await tx(db, async () => {
      const vals = [b.title, b.description ?? null, b.classLevel, 'Tamil Nadu State Board (Samacheer Kalvi)', b.subjectId, b.academicYear, JSON.stringify(b.topics), b.weekNo ?? null, b.opensAt, b.closesAt, b.durationMin, b.language, b.instructions ?? null, b.passPct, b.maxAttempts, b.scoreRule, b.showReview, b.awardsCertificate ? 1 : 0, b.allowChangeAnswers ? 1 : 0, b.autoSubmit ? 1 : 0];
      if (id) { await q.run(db, 'UPDATE tests SET title=?,description=?,class_level=?,board=?,subject_id=?,academic_year=?,topics=?,week_no=?,opens_at=?,closes_at=?,duration_min=?,language=?,instructions=?,pass_pct=?,max_attempts=?,score_rule=?,show_review=?,awards_certificate=?,allow_change_answers=?,auto_submit=? WHERE id=?', ...vals, id); await q.run(db, 'DELETE FROM test_questions WHERE test_id=?', id); }
      else await q.run(db, 'INSERT INTO tests(title,description,class_level,board,subject_id,academic_year,topics,week_no,opens_at,closes_at,duration_min,language,instructions,pass_pct,max_attempts,score_rule,show_review,awards_certificate,allow_change_answers,auto_submit,id,published,created_by,school_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)', ...vals, tid, req.user!.id, req.user!.school_id, iso());
      b.questions.forEach(async (it, i) => (await q.run(db, 'INSERT INTO test_questions VALUES (?,?,?,?,?)', tid, it.questionId, it.marks, i + 1, (await q.get<any>(db, 'SELECT version FROM questions WHERE id=?', it.questionId))!.version)));
      await audit(db, req.user!.id, id ? 'test.update' : 'test.create', 'test', tid, { total });
    });
    return tid;
  };
  r.post('/tests', wrap(async (req, res) => res.status(201).json({ id: await saveTest(req, null) })));
  r.get('/tests/:id', wrap(async (req, res) => { const t = await testRow(req, req.params.id); res.json({ test: { ...t, topics: J(t.topics) }, questions: (await testQuestions(db, t.id)).map(x => ({ id: x.question_id, marks: x.marks, position: x.position, type: x.type, text_en: x.text_en, status: x.status, options: J(x.options), answer: J(x.answer) })), attempts: (await q.get<any>(db, 'SELECT COUNT(*) n FROM attempts WHERE test_id=?', t.id))!.n }); }));
  r.put('/tests/:id', wrap(async (req, res) => { const t = await testRow(req, req.params.id); if ((await q.get(db, 'SELECT 1 FROM attempts WHERE test_id=?', t.id))) throw new HttpError(409, 'Students have already started this test, so its questions and rules can no longer be changed.'); res.json({ id: await saveTest(req, t.id) }); }));
  r.post('/tests/:id/publish', wrap(async (req, res) => {
    const t = await testRow(req, req.params.id); const qs = await testQuestions(db, t.id); if (!qs.length) throw new HttpError(409, 'Add questions before publishing.');
    if (qs.some(x => x.status !== 'published')) throw new HttpError(409, 'This test contains draft (unreviewed) questions. Review and publish them first.');
    await q.run(db, 'UPDATE tests SET published=1 WHERE id=?', t.id); await audit(db, req.user!.id, 'test.publish', 'test', t.id); res.json({ ok: true });
  }));
  r.post('/tests/:id/unpublish', wrap(async (req, res) => { const t = await testRow(req, req.params.id); if ((await q.get(db, 'SELECT 1 FROM attempts WHERE test_id=?', t.id))) throw new HttpError(409, 'Cannot unpublish a test that students have attempted.'); await q.run(db, 'UPDATE tests SET published=0 WHERE id=?', t.id); await audit(db, req.user!.id, 'test.unpublish', 'test', t.id); res.json({ ok: true }); }));
  /** Authorised reopening: extends the closing time and/or adds an attempt. Audited. */
  r.post('/tests/:id/reopen', wrap(async (req, res) => {
    const b = parse(z.object({ closesAt: z.string().datetime(), extraAttempt: z.boolean().default(false), reason: z.string().trim().min(3).max(300) }), req.body); const t = await testRow(req, req.params.id);
    if (b.closesAt <= t.closes_at && !b.extraAttempt) throw new HttpError(400, 'Choose a later closing time or allow an extra attempt.');
    await q.run(db, 'UPDATE tests SET closes_at=MAX(closes_at, ?), max_attempts=max_attempts+? WHERE id=?', b.closesAt, b.extraAttempt ? 1 : 0, t.id); await audit(db, req.user!.id, 'test.reopen', 'test', t.id, b); res.json({ ok: true });
  }));
  const results = async (t: any) => {
    const sids = (await q.all<any>(db, 'SELECT DISTINCT e.student_id FROM enrolments e JOIN classes c ON c.id=e.class_id WHERE c.class_level=? AND c.school_id=?', t.class_level, t.school_id)).map(x => x.student_id);
    const rows = (await Promise.all(sids.map(async sid => { const p = (await q.get<any>(db, 'SELECT full_name, ref_no FROM student_profiles WHERE user_id=?', sid))!; const atts = (await q.all<any>(db, "SELECT a.id, a.attempt_no, a.status, r.marks, r.total, r.pct, r.status rs FROM attempts a LEFT JOIN results r ON r.attempt_id=a.id WHERE a.test_id=? AND a.student_id=? AND a.status!='in_progress' ORDER BY a.attempt_no", t.id, sid)); const best = atts.filter(a => a.status === 'finalised').sort((a, b) => b.pct - a.pct)[0] ?? atts[atts.length - 1];
      return { studentId: sid, name: p.full_name, ref_no: p.ref_no, attempts: atts.length, attemptId: best?.id ?? null, marks: best?.marks ?? null, total: best?.total ?? null, pct: best?.pct ?? null, status: best ? (best.status === 'pending_review' ? 'pending_review' : best.rs) : 'not_attempted' }; })));
    const fin = rows.filter(x => x.status === 'passed' || x.status === 'not_passed');
    const qa = (await Promise.all((await testQuestions(db, t.id)).map(async qq => { const g = (await q.all<any>(db, 'SELECT g.marks, g.max_marks FROM gradings g JOIN attempts a ON a.id=g.attempt_id WHERE a.test_id=? AND g.question_id=?', t.id, qq.question_id)); return { id: qq.question_id, text_en: qq.text_en, topic: qq.topic, correctPct: g.length ? Math.round((g.filter(x => x.marks >= x.max_marks).length / g.length) * 100) : null, answered: g.length }; })));
    return { students: rows, summary: { enrolled: rows.length, attempted: rows.filter(x => x.status !== 'not_attempted').length, passed: fin.filter(x => x.status === 'passed').length, passRate: fin.length ? Math.round((fin.filter(x => x.status === 'passed').length / fin.length) * 100) : null, average: fin.length ? Math.round(fin.reduce((s, x) => s + x.pct, 0) / fin.length * 10) / 10 : null, pending: rows.filter(x => x.status === 'pending_review').length }, questions: qa };
  };
  r.get('/tests/:id/results', wrap(async (req, res) => res.json(await results(await testRow(req, req.params.id)))));
  r.get('/tests/:id/results.csv', wrap(async (req, res) => {
    const t = await testRow(req, req.params.id); const d = await results(t); const esc = (v: any) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
    const csv = ['Student,Reference,Attempts,Marks,Total,Percent,Status', ...d.students.map(s => [s.name, s.ref_no, s.attempts, s.marks, s.total, s.pct, s.status].map(esc).join(','))].join('\n');
    await audit(db, req.user!.id, 'report.export', 'test', t.id); res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="results-${t.id}.csv"`); res.send('﻿' + csv);
  }));
  // ---- Manual marking ----
  const pendingReviews = async (req: any) => (await q.all<any>(db, "SELECT a.id, a.student_id, a.submitted_at, a.context, t.title FROM attempts a JOIN tests t ON t.id=a.test_id WHERE a.status='pending_review' ORDER BY a.submitted_at")).filter(a => canAccessStudent(db, req.user!, a.student_id)).map(a => ({ id: a.id, title: a.title, student: J(a.context).student_name, submitted_at: a.submitted_at }));
  r.get('/reviews', wrap(async (req, res) => res.json({ reviews: await pendingReviews(req) })));
  r.get('/attempts/:id', wrap(async (req, res) => {
    const a = (await q.get<any>(db, 'SELECT * FROM attempts WHERE id=?', req.params.id)); if (!a || !(await canAccessStudent(db, req.user!, a.student_id))) throw new HttpError(404, 'Attempt not found.');
    const ans = new Map((await q.all<any>(db, 'SELECT * FROM answers WHERE attempt_id=?', a.id)).map(x => [x.question_id, J(x.answer)])); const gr = new Map((await q.all<any>(db, 'SELECT * FROM gradings WHERE attempt_id=?', a.id)).map(g => [g.question_id, g]));
    res.json({ attempt: { id: a.id, status: a.status, student: J(a.context).student_name, title: J(a.context).test_title, submitted_at: a.submitted_at }, questions: (await testQuestions(db, a.test_id)).map(x => ({ id: x.question_id, type: x.type, text_en: x.text_en, options: J(x.options), max: x.marks, answer: ans.get(x.question_id) ?? null, key: J(x.answer), marks: gr.get(x.question_id)?.marks ?? null, auto: gr.get(x.question_id)?.auto ?? null, feedback: gr.get(x.question_id)?.feedback ?? null })) });
  }));
  const Grades = z.object({ grades: z.array(z.object({ questionId: z.string(), marks: z.number().min(0), feedback: z.string().max(500).optional() })).min(1), reason: z.string().trim().min(3).max(300).optional() });
  r.post('/attempts/:id/grade', wrap(async (req, res) => {
    const b = parse(Grades, req.body); const a = (await q.get<any>(db, 'SELECT * FROM attempts WHERE id=?', req.params.id)); if (!a || !(await canAccessStudent(db, req.user!, a.student_id))) throw new HttpError(404, 'Attempt not found.');
    if (a.status !== 'pending_review') throw new HttpError(409, 'This attempt is not waiting for review.'); res.json({ result: await correctResult(db, a.id, req.user!.id, b.grades, b.reason ?? 'Manual marking') });
  }));
  r.post('/attempts/:id/correct', wrap(async (req, res) => {
    const b = parse(Grades.extend({ reason: z.string().trim().min(3, 'A reason is required for corrections').max(300) }), req.body); const a = (await q.get<any>(db, 'SELECT * FROM attempts WHERE id=?', req.params.id)); if (!a || !(await canAccessStudent(db, req.user!, a.student_id))) throw new HttpError(404, 'Attempt not found.');
    if (a.status !== 'finalised') throw new HttpError(409, 'Only a finalised result can be corrected.'); res.json({ result: await correctResult(db, a.id, req.user!.id, b.grades, b.reason) });
  }));
  // ---- Assignments ----
  r.get('/assignments', wrap(async (req, res) => { const cs = (await myClasses(req)).map(c => c.id); res.json({ assignments: cs.length ? (await Promise.all((await q.all<any>(db, `SELECT a.*, c.name class_name FROM assignments a JOIN classes c ON c.id=a.class_id WHERE a.class_id IN (${cs.map(() => '?').join(',')}) ORDER BY a.due_at DESC`, ...cs)).map(async a => ({ ...a, submissions: (await q.all<any>(db, 'SELECT s.student_id, p.full_name, s.text, s.submitted_at, s.feedback FROM submissions s JOIN student_profiles p ON p.user_id=s.student_id WHERE s.assignment_id=?', a.id)) })))) : [] }); }));
  r.post('/assignments', wrap(async (req, res) => { const b = parse(z.object({ classId: z.string(), title: z.string().trim().min(3).max(120), description: z.string().max(1000).optional(), dueAt: z.string().datetime() }), req.body); await classRow(req, b.classId); const id = uid(); await q.run(db, 'INSERT INTO assignments VALUES (?,?,?,?,?,?,?)', id, b.classId, b.title, b.description ?? null, b.dueAt, req.user!.id, iso()); res.status(201).json({ id }); }));
  r.post('/assignments/:id/feedback', wrap(async (req, res) => { const b = parse(z.object({ studentId: z.string(), feedback: z.string().trim().min(1).max(500) }), req.body); const a = (await q.get<any>(db, 'SELECT * FROM assignments WHERE id=?', req.params.id)); if (!a) throw new HttpError(404, 'Not found.'); await classRow(req, a.class_id); await q.run(db, 'UPDATE submissions SET feedback=? WHERE assignment_id=? AND student_id=?', b.feedback, a.id, b.studentId); res.json({ ok: true }); }));
  r.get('/certificates', wrap(async (req, res) => res.json({ certificates: (await q.all<any>(db, 'SELECT c.*, p.full_name FROM certificates c JOIN student_profiles p ON p.user_id=c.student_id ORDER BY issued_at DESC')).filter(c => canAccessStudent(db, req.user!, c.student_id)).map(c => ({ id: c.id, ref_no: c.ref_no, status: c.status, reason: c.reason, issued_at: c.issued_at, student: c.full_name, title: J(c.snapshot).test_title, attempt_id: c.attempt_id })) })));
  return r;
}
