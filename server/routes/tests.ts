import { Router, Request } from 'express';
import { z } from 'zod';
import { DB, q, tx } from '../db';
import { audit, requireAuth, requireRole } from '../security';
import { iso } from '../clock';
import { J, canAccessStudent, parse, wrap } from '../http';
import { HttpError, effectiveResult, finalizeIfReady, loadAttemptForStudent, maybeIssueCertificate, saveAnswers, settleIfExpired, startAttempt, submitAttempt, testQuestions, testStatus, topicPerformance, certRef } from '../services/tests';
import { newToken, uid } from '../security';
import { renderCertificatePdf } from '../services/certificatePdf';
import { myProfile, studentReport } from './student';

const publicBase = (req: Request) => process.env.PUBLIC_URL ?? `${req.protocol}://${req.get('host')}`;
const certView = (c: any) => ({ id: c.id, attempt_id: c.attempt_id, ref_no: c.ref_no, token: c.token, status: c.status, reason: c.reason, issued_at: c.issued_at, issuer: c.issuer, template_type: c.template_type, template_version: c.template_version, test_id: c.test_id, snapshot: J(c.snapshot) });

export function testRoutes(db: DB) {
  const r = Router(); const S = requireRole('student');
  const testCard = async (t: any, studentId: string) => { const st = await testStatus(db, t, studentId); const nq = (await q.get<any>(db, 'SELECT COUNT(*) n, COALESCE(SUM(marks),0) m FROM test_questions WHERE test_id=?', t.id))!;
    return { id: t.id, title: t.title, subject_id: t.subject_id, subject_en: t.subject_en, subject_ta: t.subject_ta, topics: J(t.topics), week_no: t.week_no, opens_at: t.opens_at, closes_at: t.closes_at, duration_min: t.duration_min, total_marks: nq.m, question_count: nq.n, pass_pct: t.pass_pct, pass_marks: Math.round((t.pass_pct / 100) * nq.m * 100) / 100, max_attempts: t.max_attempts, language: t.language,
      status: st.status, attemptsUsed: st.attemptsUsed, inProgressId: st.inProgressId ?? null, canStart: st.canStart, best: st.best ? { attemptId: st.best.id, marks: st.best.marks, total: st.best.total, pct: st.best.pct, result: st.best.rstatus } : null }; };
  r.get('/tests', S, wrap(async (req, res) => {
    const p = await myProfile(db, req.user!.id); if (!p?.completed_at) throw new HttpError(409, 'Please complete your student profile first.');
    const rows = (await q.all<any>(db, 'SELECT t.*, s.name_en subject_en, s.name_ta subject_ta FROM tests t JOIN subjects s ON s.id=t.subject_id WHERE t.published=1 AND t.class_level=? AND t.academic_year=? ORDER BY t.opens_at DESC', p.class_level, p.academic_year));
    res.json({ tests: (await Promise.all(rows.map(t => testCard(t, req.user!.id)))), serverTime: iso(), timeZone: 'Asia/Kolkata' });
  }));
  r.get('/tests/:id', S, wrap(async (req, res) => {
    const t = (await q.get<any>(db, 'SELECT t.*, s.name_en subject_en, s.name_ta subject_ta FROM tests t JOIN subjects s ON s.id=t.subject_id WHERE t.id=? AND t.published=1', req.params.id)); const p = (await myProfile(db, req.user!.id))!;
    if (!t || t.class_level !== p.class_level) throw new HttpError(404, 'Test not found.');
    const qs = (await q.get<any>(db, 'SELECT GROUP_CONCAT(DISTINCT q.type) types FROM test_questions tq JOIN questions q ON q.id=tq.question_id WHERE tq.test_id=?', t.id));
    const attempts = (await q.all<any>(db, "SELECT a.id, a.attempt_no, a.status, a.submitted_at, r.marks, r.total, r.pct, r.status result FROM attempts a LEFT JOIN results r ON r.attempt_id=a.id WHERE a.test_id=? AND a.student_id=? ORDER BY a.attempt_no", t.id, req.user!.id));
    res.json({ test: { ...await testCard(t, req.user!.id), description: t.description, instructions: t.instructions, board: t.board, academic_year: t.academic_year, class_level: t.class_level, question_types: (qs?.types ?? '').split(','), allow_change_answers: !!t.allow_change_answers, auto_submit: !!t.auto_submit, awards_certificate: !!t.awards_certificate, score_rule: t.score_rule, show_review: t.show_review }, attempts, eligibility: { eligible: true, reason: `Class ${p.class_level} · ${p.academic_year}` } });
  }));
  r.post('/tests/:id/attempts', S, wrap(async (req, res) => { const id = await startAttempt(db, req.user!.id, req.params.id); res.status(201).json({ attemptId: id }); }));
  const attemptPayload = async (a: any) => {
    const qs = await testQuestions(db, a.test_id); const ans = new Map((await q.all<any>(db, 'SELECT * FROM answers WHERE attempt_id=?', a.id)).map(x => [x.question_id, x]));
    return { id: a.id, test_id: a.test_id, status: a.status, started_at: a.started_at, deadline_at: a.deadline_at, serverTime: iso(), rules: (({ pass_pct, total_marks, pass_marks, allow_change_answers, duration_min }) => ({ pass_pct, total_marks, pass_marks, allow_change_answers, duration_min }))(J(a.rules)), context: J(a.context), title: J(a.context).test_title,
      // Answer keys are never sent to the student.
      questions: qs.map(x => ({ id: x.question_id, position: x.position, type: x.type, marks: x.marks, text_en: x.text_en, text_ta: x.text_ta, options: J(x.options), answer: ans.has(x.question_id) ? J(ans.get(x.question_id).answer) : null, flagged: !!ans.get(x.question_id)?.flagged })) };
  };
  r.get('/attempts/:id', S, wrap(async (req, res) => {
    let a = await loadAttemptForStudent(db, req.params.id, req.user!.id); const settled = await settleIfExpired(db, a); if (settled) a = (await loadAttemptForStudent(db, a.id, req.user!.id));
    res.json({ attempt: await attemptPayload(a) });
  }));
  r.put('/attempts/:id/answers', S, wrap(async (req, res) => {
    const b = parse(z.object({ items: z.array(z.object({ questionId: z.string(), answer: z.any(), flagged: z.boolean().optional() })).min(1).max(100) }), req.body);
    await saveAnswers(db, req.params.id, req.user!.id, b.items); res.json({ saved: true, serverTime: iso() });
  }));
  r.post('/attempts/:id/submit', S, wrap(async (req, res) => {
    // Optionally persist the final answers in the same request, then finalise (idempotent).
    const b = parse(z.object({ items: z.array(z.object({ questionId: z.string(), answer: z.any(), flagged: z.boolean().optional() })).max(100).optional() }), req.body ?? {});
    const a = await loadAttemptForStudent(db, req.params.id, req.user!.id);
    if (a.status === 'in_progress' && b.items?.length) { try { await saveAnswers(db, a.id, req.user!.id, b.items); } catch (e) { if (!(e instanceof HttpError) || e.status !== 409) throw e; } }
    const out = await submitAttempt(db, req.params.id, req.user!.id); res.json({ ...out });
  }));
  r.get('/attempts/:id/result', requireAuth, wrap(async (req, res) => {
    const a = (await q.get<any>(db, 'SELECT * FROM attempts WHERE id=?', req.params.id)); if (!a || !(await canAccessStudent(db, req.user!, a.student_id))) throw new HttpError(404, 'Result not found.');
    if (a.status === 'in_progress') throw new HttpError(409, 'This attempt has not been submitted yet.');
    const res_ = (await q.get<any>(db, 'SELECT * FROM results WHERE attempt_id=?', a.id))!; const ctx = J(a.context); const rules = J(a.rules);
    const topics = await topicPerformance(db, a.id); const gr = (await q.all<any>(db, 'SELECT g.*, 1 FROM gradings g WHERE attempt_id=?', a.id));
    const qs = await testQuestions(db, a.test_id); const correct = gr.filter(g => g.marks >= g.max_marks).length; const manualPending = qs.filter(x => !gr.find(g => g.question_id === x.question_id)).length;
    const cert = (await q.get<any>(db, "SELECT * FROM certificates WHERE attempt_id=? AND status='valid'", a.id));
    const t = (await q.get<any>(db, 'SELECT * FROM tests WHERE id=?', a.test_id))!; const st = await testStatus(db, t, a.student_id);
    const weak = topics.filter(t2 => t2.pct < 70);
    const nextTests = (await q.all<any>(db, "SELECT id,title,opens_at,closes_at FROM tests WHERE published=1 AND class_level=? AND id!=? AND closes_at>? ORDER BY opens_at LIMIT 2", ctx.class_level, a.test_id, iso()));
    res.json({ result: { attemptId: a.id, testId: a.test_id, testTitle: ctx.test_title, studentName: ctx.student_name, classLevel: ctx.class_level, subject_en: ctx.subject_en, subject_ta: ctx.subject_ta, academicYear: ctx.academic_year, attemptNo: a.attempt_no, attemptedAt: a.submitted_at,
      marks: res_.marks, total: res_.total, pct: res_.pct, passPct: rules.pass_pct, passMarks: res_.pass_marks, status: res_.status, finalised: a.status === 'finalised', correctCount: correct, questionCount: qs.length, pendingManual: manualPending,
      topics, revision: weak.map(w => w.topic), certificate: cert ? { id: cert.id, ref_no: cert.ref_no } : null, certificateEligible: !!rules.awards_certificate && res_.status === 'passed',
      retake: { allowed: st.canStart && res_.status === 'not_passed', attemptsLeft: Math.max(0, t.max_attempts - st.attemptsUsed), closes_at: t.closes_at }, reviewAvailable: reviewAllowed(t, a), nextTests } });
  }));
  const reviewAllowed = (t: any, a: any) => a.status !== 'in_progress' && (t.show_review === 1 || (t.show_review === 2 && iso() > t.closes_at));
  r.get('/attempts/:id/review', requireAuth, wrap(async (req, res) => {
    const a = (await q.get<any>(db, 'SELECT * FROM attempts WHERE id=?', req.params.id)); if (!a || !(await canAccessStudent(db, req.user!, a.student_id))) throw new HttpError(404, 'Attempt not found.');
    const t = (await q.get<any>(db, 'SELECT * FROM tests WHERE id=?', a.test_id))!;
    if (!reviewAllowed(t, a)) throw new HttpError(403, t.show_review === 2 ? 'Answer review opens after the test closes.' : 'Answer review is not available for this test.');
    const ans = new Map((await q.all<any>(db, 'SELECT * FROM answers WHERE attempt_id=?', a.id)).map(x => [x.question_id, J(x.answer)])); const gr = new Map((await q.all<any>(db, 'SELECT * FROM gradings WHERE attempt_id=?', a.id)).map(g => [g.question_id, g]));
    res.json({ review: (await testQuestions(db, a.test_id)).map(x => { const k = J(x.answer); const opts = J(x.options); const g = gr.get(x.question_id);
      return { id: x.question_id, position: x.position, type: x.type, text_en: x.text_en, text_ta: x.text_ta, options: opts, yourAnswer: ans.get(x.question_id) ?? null, correctAnswer: x.type === 'mcq' || x.type === 'tf' ? k : x.type === 'numeric' ? k.value : x.type === 'fill' ? k.accept[0] : (g ? k.rubric : null),
        marks: g?.marks ?? null, max: x.marks, status: g ? (g.marks >= g.max_marks ? 'correct' : g.marks > 0 ? 'partial' : 'incorrect') : 'pending_review', feedback: g?.feedback ?? null, explanation_en: x.explanation_en, explanation_ta: x.explanation_ta, topic: x.topic }; }) });
  }));
  r.get('/revision-plan', S, wrap(async (req, res) => {
    const id = req.user!.id; const rep = await studentReport(db, id); const p = (await myProfile(db, id))!;
    // weak topic -> the subject/chapter of the questions that were missed -> that chapter's lessons (not a guess from the topic's words)
    const chapters = new Map<string, Set<string>>();
    for (const row of (await q.all<any>(db, "SELECT r.snapshot FROM attempts a JOIN results r ON r.attempt_id=a.id WHERE a.student_id=? AND a.status='finalised'", id)))
      for (const pq of J(row.snapshot).perQuestion ?? []) { const qu = (await q.get<any>(db, 'SELECT subject_id, chapter_no FROM questions WHERE id=?', pq.id)); if (!qu) continue; const k = pq.topic ?? 'General'; (chapters.get(k) ?? chapters.set(k, new Set()).get(k)!).add(`${qu.subject_id}|${qu.chapter_no}`); }
    const items = (await Promise.all(rep.revisionTopics.map(async t => {
      const seen = new Set<string>(); const lessons: any[] = [];
      for (const c of chapters.get(t.topic) ?? []) { const [sub, ch] = c.split('|'); for (const l of (await q.all<any>(db, "SELECT id,title_en,title_ta FROM lessons WHERE class_level=? AND subject_id=? AND chapter_no=? AND status='published' ORDER BY position LIMIT 2", p.class_level, sub, Number(ch)))) if (!seen.has(l.id)) { seen.add(l.id); lessons.push(l); } }
      return { topic: t.topic, pct: t.pct, lessons: lessons.slice(0, 2) };
    })));
    const upcoming = (await q.all<any>(db, "SELECT id,title,opens_at,closes_at FROM tests WHERE published=1 AND class_level=? AND closes_at>? ORDER BY opens_at LIMIT 5", p.class_level, iso()));
    res.json({ items, upcoming, basis: rep.finalised, note: rep.finalised ? 'Based on your finalised test results.' : 'Take a weekly test to get a personalised revision plan.' });
  }));
  // ---------- Certificates ----------
  r.get('/certificates', requireAuth, wrap(async (req, res) => {
    const sid = String(req.query.studentId ?? req.user!.id); if (!(await canAccessStudent(db, req.user!, sid))) throw new HttpError(403, 'You do not have access to this student.');
    res.json({ certificates: (await q.all<any>(db, 'SELECT * FROM certificates WHERE student_id=? ORDER BY issued_at DESC', sid)).map(certView), base: publicBase(req) });
  }));
  const certAccess = async (req: Request) => { const c = (await q.get<any>(db, 'SELECT * FROM certificates WHERE id=?', req.params.id)); if (!c || !(await canAccessStudent(db, req.user!, c.student_id))) throw new HttpError(404, 'Certificate not found.'); return c; };
  r.get('/certificates/:id/pdf', requireAuth, wrap(async (req, res) => {
    const c = await certAccess(req); const buf = await renderCertificatePdf({ ref: c.ref_no, verifyUrl: `${publicBase(req)}/verify/${c.token}`, snapshot: J(c.snapshot), status: c.status });
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="certificate-${c.ref_no}.pdf"`); res.setHeader('Cache-Control', 'private, no-store'); res.send(buf);
  }));
  r.get('/certificates/:id/history', requireAuth, wrap(async (req, res) => { const c = await certAccess(req); res.json({ history: (await q.all<any>(db, "SELECT action, at, details FROM audit WHERE entity='certificate' AND entity_id=? ORDER BY id", c.id)).map(h => ({ ...h, details: J(h.details) })) }); }));
  /** Public verification: minimal data only, looked up by high-entropy token. */
  r.get('/verify/:token', wrap(async (req, res) => {
    const token = String(req.params.token).trim().split('/').pop()!; if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return void res.status(404).json({ found: false });
    const c = (await q.get<any>(db, 'SELECT * FROM certificates WHERE token=?', token)); if (!c) return void res.status(404).json({ found: false });
    const s = J(c.snapshot); const first = String(s.student_name).split(' ')[0]; const initial = String(s.student_name).split(' ').slice(1).map((x: string) => x[0]).join('');
    res.json({ found: true, status: c.status, title: 'Weekly Test Achievement Certificate', issuer: 'AI Learning Platform (not an official board certificate)', achieved_on: String(s.achieved_on).slice(0, 10), achievement: s.test_title, holder: c.status === 'valid' ? `${first} ${initial ? initial + '.' : ''}`.trim() : undefined, ref_no: c.ref_no, revoked_reason: c.status === 'revoked' ? 'Revoked by the issuer' : undefined, superseded: c.status === 'superseded' || undefined });
  }));
  const canManageCert = async (db_: DB, user: any, c: any) => user.role === 'admin' || (await canAccessStudent(db_, user, c.student_id)) && ['teacher', 'school_admin'].includes(user.role);
  r.post('/certificates/:id/revoke', requireRole('teacher', 'school_admin', 'admin'), wrap(async (req, res) => {
    const b = parse(z.object({ reason: z.string().trim().min(3, 'A reason is required').max(300) }), req.body);
    const c = (await q.get<any>(db, 'SELECT * FROM certificates WHERE id=?', req.params.id)); if (!c || !(await canManageCert(db, req.user!, c))) throw new HttpError(404, 'Certificate not found.');
    if (c.status !== 'valid') throw new HttpError(409, 'Only a valid certificate can be revoked.');
    await tx(db, async () => { await q.run(db, "UPDATE certificates SET status='revoked', reason=? WHERE id=?", b.reason, c.id); await audit(db, req.user!.id, 'certificate.revoke', 'certificate', c.id, { reason: b.reason }); await q.run(db, 'INSERT INTO notifications VALUES (?,?,?,?,0,?)', uid(), c.student_id, 'Certificate revoked', `${J(c.snapshot).test_title}`, iso()); });
    res.json({ ok: true });
  }));
  /** Supersede a certificate and issue a corrected one from the current finalised result. */
  r.post('/certificates/:id/reissue', requireRole('teacher', 'school_admin', 'admin'), wrap(async (req, res) => {
    const b = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
    const c = (await q.get<any>(db, 'SELECT * FROM certificates WHERE id=?', req.params.id)); if (!c || !(await canManageCert(db, req.user!, c))) throw new HttpError(404, 'Certificate not found.');
    const newId = (await tx(db, async () => {
      const rs = (await q.get<any>(db, "SELECT r.*, a.status astatus FROM results r JOIN attempts a ON a.id=r.attempt_id WHERE r.attempt_id=?", c.attempt_id))!;
      if (rs.astatus !== 'finalised' || rs.status !== 'passed') throw new HttpError(409, 'The current result is not a finalised pass, so a corrected certificate cannot be issued.');
      const nid = uid(); const snap = { ...J(c.snapshot), marks: rs.marks, total: rs.total, pct: rs.pct };
      await q.run(db, "UPDATE certificates SET status='superseded', reason=?, superseded_by=? WHERE id=?", b.reason, nid, c.id);
      await q.run(db, 'INSERT INTO certificates(id,token,ref_no,student_id,test_id,attempt_id,template_type,template_version,issued_at,snapshot,issuer,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', nid, newToken(16), certRef(), c.student_id, c.test_id, c.attempt_id, c.template_type, c.template_version, iso(), JSON.stringify(snap), 'Teacher/administrator reissue', 'valid');
      await audit(db, req.user!.id, 'certificate.reissue', 'certificate', c.id, { reason: b.reason, newId: nid }); await audit(db, req.user!.id, 'certificate.issue', 'certificate', nid, { supersedes: c.id });
      return nid;
    }));
    res.json({ ok: true, newCertificateId: newId });
  }));
  return r;
}
export { effectiveResult, finalizeIfReady, maybeIssueCertificate };
