import { DB, q, tx } from '../db';
import { clock, iso } from '../clock';
import { uid, audit, newToken } from '../security';
import { gradeAnswer, computeResult } from './grading';
import { randomBytes } from 'node:crypto';

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const J = (s: string) => JSON.parse(s);

export async function testQuestions(db: DB, testId: string) {
  return (await q.all<any>(db, 'SELECT q.*, tq.question_id, tq.marks, tq.position FROM test_questions tq JOIN questions q ON q.id=tq.question_id WHERE tq.test_id=? ORDER BY tq.position', testId));
}
export const totalMarks = async (db: DB, testId: string) => (await q.get<{ t: number }>(db, 'SELECT COALESCE(SUM(marks),0) t FROM test_questions WHERE test_id=?', testId))!.t;

export async function effectiveResult(db: DB, testId: string, studentId: string) {
  const test = (await q.get<any>(db, 'SELECT score_rule FROM tests WHERE id=?', testId));
  const rows = (await q.all<any>(db, `SELECT a.id, a.attempt_no, a.status, a.submitted_at, r.marks, r.total, r.pct, r.status rstatus, r.pass_marks FROM attempts a LEFT JOIN results r ON r.attempt_id=a.id WHERE a.test_id=? AND a.student_id=? AND a.status!='in_progress' ORDER BY a.attempt_no`, testId, studentId));
  if (!rows.length) return null;
  const fin = rows.filter(r => r.status === 'finalised');
  if (fin.length) return test?.score_rule === 'latest' ? fin[fin.length - 1] : fin.reduce((b, r) => (r.pct > b.pct ? r : b));
  return rows[rows.length - 1]; // pending review
}
export type TestStatus = 'Upcoming' | 'Available' | 'In progress' | 'Pending review' | 'Passed' | 'Not passed' | 'Expired';
export async function testStatus(db: DB, test: any, studentId: string): Promise<{ status: TestStatus; attemptsUsed: number; inProgressId?: string; best?: any; canStart: boolean }> {
  const now = iso(); const atts = (await q.all<any>(db, 'SELECT id, status, attempt_no FROM attempts WHERE test_id=? AND student_id=?', test.id, studentId));
  const inProg = atts.find(a => a.status === 'in_progress'); const used = atts.length;
  const best = await effectiveResult(db, test.id, studentId);
  const open = now >= test.opens_at && now <= test.closes_at;
  let status: TestStatus;
  if (inProg && open) status = 'In progress';
  else if (best?.status === 'finalised' && best.rstatus === 'passed') status = 'Passed';
  else if (best?.status === 'pending_review') status = 'Pending review';
  else if (best?.status === 'finalised') status = open && used < test.max_attempts ? 'Available' : 'Not passed';
  else if (now < test.opens_at) status = 'Upcoming';
  else if (now > test.closes_at) status = 'Expired';
  else status = 'Available';
  const canStart = open && (!!inProg || (used < test.max_attempts && status !== 'Passed' && status !== 'Pending review'));
  return { status, attemptsUsed: used, inProgressId: inProg?.id, best, canStart };
}

export async function startAttempt(db: DB, studentId: string, testId: string) {
  return (await tx(db, async () => {
    const test = (await q.get<any>(db, 'SELECT * FROM tests WHERE id=? AND published=1', testId));
    const st = (await q.get<any>(db, 'SELECT * FROM student_profiles WHERE user_id=?', studentId));
    if (!test || !st || test.class_level !== st.class_level) throw new HttpError(404, 'Test not found.');
    const now = clock.now(); const t = iso(now);
    const open = (await q.get<any>(db, "SELECT * FROM attempts WHERE test_id=? AND student_id=? AND status='in_progress'", testId, studentId));
    if (open) return open.id as string; // idempotent: never create a second in-progress attempt
    if (t < test.opens_at) throw new HttpError(409, 'This test has not opened yet.');
    if (t > test.closes_at) throw new HttpError(409, 'This test has closed.');
    const used = (await q.get<{ n: number }>(db, 'SELECT COUNT(*) n FROM attempts WHERE test_id=? AND student_id=?', testId, studentId))!.n;
    if (used >= test.max_attempts) throw new HttpError(409, 'No attempts left for this test.');
    const prior = await effectiveResult(db, testId, studentId);
    if (prior?.status === 'pending_review') throw new HttpError(409, 'Your last attempt is still being reviewed.');
    if (prior?.rstatus === 'passed') throw new HttpError(409, 'You have already passed this test.');
    const total = await totalMarks(db, testId);
    let deadline: string = test.closes_at;
    if (test.duration_min) { const d = iso(new Date(now.getTime() + test.duration_min * 60000)); if (d < deadline) deadline = d; }
    const rules = { pass_pct: test.pass_pct, total_marks: total, pass_marks: computeResult(0, total, test.pass_pct, false).passMarks, score_rule: test.score_rule, show_review: test.show_review, allow_change_answers: !!test.allow_change_answers, awards_certificate: !!test.awards_certificate, max_attempts: test.max_attempts, duration_min: test.duration_min, auto_submit: !!test.auto_submit };
    const subj = (await q.get<any>(db, 'SELECT name_en, name_ta FROM subjects WHERE id=?', test.subject_id))!;
    const ctx = { class_level: st.class_level, subject_id: test.subject_id, subject_en: subj.name_en, subject_ta: subj.name_ta, academic_year: test.academic_year, board: test.board, test_title: test.title, student_name: st.full_name, student_name_ta: st.full_name_ta };
    const id = uid();
    await q.run(db, 'INSERT INTO attempts(id,test_id,student_id,attempt_no,started_at,deadline_at,status,rules,context) VALUES (?,?,?,?,?,?,?,?,?)', id, testId, studentId, used + 1, t, deadline, 'in_progress', JSON.stringify(rules), JSON.stringify(ctx));
    await audit(db, studentId, 'attempt.start', 'attempt', id, { testId });
    return id;
  }));
}

const GRACE_MS = 15000;
export async function loadAttemptForStudent(db: DB, attemptId: string, studentId: string) {
  const a = (await q.get<any>(db, 'SELECT * FROM attempts WHERE id=?', attemptId));
  if (!a || a.student_id !== studentId) throw new HttpError(404, 'Attempt not found.');
  return a;
}
/** Auto-submit an overdue in-progress attempt (server is the clock authority). */
export async function settleIfExpired(db: DB, a: any) {
  if (a.status === 'in_progress' && a.deadline_at && iso() > a.deadline_at) {
    const rules = J(a.rules);
    if (rules.auto_submit !== false) return await submitAttempt(db, a.id, a.student_id, true);
  }
  return null;
}
export async function saveAnswers(db: DB, attemptId: string, studentId: string, items: { questionId: string; answer: unknown; flagged?: boolean }[]) {
  const a = await loadAttemptForStudent(db, attemptId, studentId);
  if (a.status !== 'in_progress') throw new HttpError(409, 'This attempt has already been submitted.');
  if (a.deadline_at && clock.now().getTime() > new Date(a.deadline_at).getTime() + GRACE_MS) { await settleIfExpired(db, a); throw new HttpError(409, 'Time is up. Your saved answers were submitted.'); }
  const rules = J(a.rules); const valid = new Set((await testQuestions(db, a.test_id)).map(x => x.question_id));
  await tx(db, async () => {
    for (const it of items) {
      if (!valid.has(it.questionId)) throw new HttpError(400, 'Unknown question.');
      const prev = (await q.get<any>(db, 'SELECT answer FROM answers WHERE attempt_id=? AND question_id=?', attemptId, it.questionId));
      const nonEmpty = prev && J(prev.answer) !== '' && J(prev.answer) !== null;
      if (!rules.allow_change_answers && nonEmpty && JSON.stringify(it.answer) !== prev!.answer) throw new HttpError(409, 'Answers cannot be changed in this test.');
      const text = JSON.stringify(it.answer ?? null); if (text.length > 20000) throw new HttpError(413, 'Answer too long.');
      await q.run(db, 'INSERT INTO answers(attempt_id,question_id,answer,flagged,saved_at) VALUES (?,?,?,?,?) ON CONFLICT(attempt_id,question_id) DO UPDATE SET answer=excluded.answer, flagged=excluded.flagged, saved_at=excluded.saved_at', attemptId, it.questionId, text, it.flagged ? 1 : 0, iso());
    }
  });
}

/** Idempotent final submission: grades on the server, stores result, issues certificate when eligible. */
export async function submitAttempt(db: DB, attemptId: string, studentId: string, auto = false) {
  return (await tx(db, async () => {
    const a = await loadAttemptForStudent(db, attemptId, studentId);
    if (a.status !== 'in_progress') return { attemptId, already: true };
    // Atomic claim: when a manual submit and the timer's auto-submit race, exactly one wins (the other waits on the row lock, then sees 0 rows).
    if ((await q.run(db, "UPDATE attempts SET status='pending_review' WHERE id=? AND status='in_progress'", attemptId)).changes === 0) return { attemptId, already: true };
    const qs = await testQuestions(db, a.test_id); const ans = new Map((await q.all<any>(db, 'SELECT * FROM answers WHERE attempt_id=?', attemptId)).map(r => [r.question_id, J(r.answer)]));
    for (const qu of qs) {
      const out = gradeAnswer(qu.type, J(qu.answer), ans.get(qu.question_id), qu.marks);
      if (out.kind === 'auto') { await q.run(db, 'INSERT INTO gradings VALUES (?,?,?,?,1,NULL,NULL,?)', attemptId, qu.question_id, out.marks, qu.marks, iso()); }
    }
    const submitted = a.deadline_at && iso() > a.deadline_at ? a.deadline_at : iso();
    await q.run(db, "UPDATE attempts SET submitted_at=?, status='pending_review' WHERE id=?", submitted, attemptId);
    await audit(db, studentId, auto ? 'attempt.auto_submit' : 'attempt.submit', 'attempt', attemptId);
    await finalizeIfReady(db, attemptId, null);
    return { attemptId, already: false };
  }));
}

/** Computes/updates the result; finalises when no manual marking is outstanding; issues certificate. Call inside a transaction. */
export async function finalizeIfReady(db: DB, attemptId: string, actor: string | null) {
  const a = (await q.get<any>(db, 'SELECT * FROM attempts WHERE id=?', attemptId))!; const rules = J(a.rules);
  const qs = await testQuestions(db, a.test_id); const graded = new Map((await q.all<any>(db, 'SELECT * FROM gradings WHERE attempt_id=?', attemptId)).map(g => [g.question_id, g]));
  const marks = [...graded.values()].reduce((s, g) => s + g.marks, 0);
  const pending = qs.some(x => !graded.has(x.question_id));
  const r = computeResult(marks, rules.total_marks, rules.pass_pct, pending);
  const ts = iso(); const finalised = !pending;
  const snapshot = { rules, perQuestion: qs.map(x => ({ id: x.question_id, topic: x.topic, max: x.marks, got: graded.get(x.question_id)?.marks ?? null })) };
  await q.run(db, 'INSERT INTO results(attempt_id,marks,total,pct,pass_marks,status,finalised_at,snapshot) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(attempt_id) DO UPDATE SET marks=excluded.marks,total=excluded.total,pct=excluded.pct,pass_marks=excluded.pass_marks,status=excluded.status,finalised_at=excluded.finalised_at,snapshot=excluded.snapshot', attemptId, marks, rules.total_marks, r.pct, r.passMarks, r.status, finalised ? ts : null, JSON.stringify(snapshot));
  await q.run(db, 'UPDATE attempts SET status=? WHERE id=?', finalised ? 'finalised' : 'pending_review', attemptId);
  if (finalised) {
    await q.run(db, 'INSERT INTO notifications VALUES (?,?,?,?,0,?)', uid(), a.student_id, `Result ready: ${J(a.context).test_title}`, `${marks} / ${rules.total_marks} — ${r.status === 'passed' ? 'Passed' : 'Not passed'}`, ts);
    if (r.status === 'passed') await maybeIssueCertificate(db, attemptId, actor);
  }
  return { ...r, marks, total: rules.total_marks, finalised };
}

export const certRef = () => `KM-${new Date().getFullYear()}-WT-${randomBytes(4).toString('hex').toUpperCase()}`;
export async function maybeIssueCertificate(db: DB, attemptId: string, actor: string | null) {
  const a = (await q.get<any>(db, 'SELECT * FROM attempts WHERE id=?', attemptId))!; const res = (await q.get<any>(db, 'SELECT * FROM results WHERE attempt_id=?', attemptId))!;
  const rules = J(a.rules); const ctx = J(a.context);
  // Eligibility: finalised, passed, awards_certificate, completed (submitted) attempt, real student profile.
  if (a.status !== 'finalised' || res.status !== 'passed' || !a.submitted_at || !rules.awards_certificate) return null;
  if (!(await q.get(db, 'SELECT 1 FROM student_profiles WHERE user_id=? AND completed_at IS NOT NULL', a.student_id))) return null;
  if ((await q.get(db, "SELECT 1 FROM certificates WHERE student_id=? AND test_id=? AND status='valid'", a.student_id, a.test_id))) return null; // no duplicates
  const id = uid();
  const snap = { student_name: ctx.student_name, student_name_ta: ctx.student_name_ta, class_level: ctx.class_level, subject_en: ctx.subject_en, subject_ta: ctx.subject_ta, test_title: ctx.test_title, academic_year: ctx.academic_year, achieved_on: a.submitted_at, marks: res.marks, total: res.total, pct: res.pct, pass_pct: rules.pass_pct };
  await q.run(db, 'INSERT INTO certificates(id,token,ref_no,student_id,test_id,attempt_id,template_type,template_version,issued_at,snapshot,issuer,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id, newToken(16), certRef(), a.student_id, a.test_id, attemptId, 'weekly_test_achievement', 1, iso(), JSON.stringify(snap), actor ? 'Teacher/administrator issuance' : 'AI Learning Platform (automatic)', 'valid');
  await audit(db, actor, 'certificate.issue', 'certificate', id, { attemptId });
  await q.run(db, 'INSERT INTO notifications VALUES (?,?,?,?,0,?)', uid(), a.student_id, 'Certificate earned', `${ctx.test_title}`, iso());
  return id;
}

export async function topicPerformance(db: DB, attemptId: string) {
  const r = (await q.get<any>(db, 'SELECT snapshot FROM results WHERE attempt_id=?', attemptId)); if (!r) return [];
  const by = new Map<string, { got: number; max: number }>();
  for (const p of J(r.snapshot).perQuestion) { const t = p.topic ?? 'General'; const e = by.get(t) ?? { got: 0, max: 0 }; e.max += p.max; e.got += p.got ?? 0; by.set(t, e); }
  return [...by].map(([topic, v]) => ({ topic, ...v, pct: v.max ? Math.round((v.got / v.max) * 100) : 0 }));
}

/** Authorised correction of a finalised result — audited; revokes/supersedes certificate as needed. */
export async function correctResult(db: DB, attemptId: string, actor: string, grades: { questionId: string; marks: number; feedback?: string }[], reason: string) {
  return (await tx(db, async () => {
    const a = (await q.get<any>(db, 'SELECT * FROM attempts WHERE id=?', attemptId)); if (!a || a.status === 'in_progress') throw new HttpError(404, 'Attempt not found.');
    const qs = new Map((await testQuestions(db, a.test_id)).map(x => [x.question_id, x]));
    const before = (await q.get<any>(db, 'SELECT marks,status FROM results WHERE attempt_id=?', attemptId));
    for (const g of grades) {
      const qu = qs.get(g.questionId); if (!qu) throw new HttpError(400, 'Unknown question.');
      if (!(g.marks >= 0 && g.marks <= qu.marks)) throw new HttpError(400, `Marks for a question must be between 0 and ${qu.marks}.`);
      await q.run(db, 'INSERT INTO gradings VALUES (?,?,?,?,0,?,?,?) ON CONFLICT(attempt_id,question_id) DO UPDATE SET marks=excluded.marks, auto=0, feedback=excluded.feedback, graded_by=excluded.graded_by, graded_at=excluded.graded_at', attemptId, g.questionId, g.marks, qu.marks, g.feedback ?? null, actor, iso());
    }
    const res = await finalizeIfReady(db, attemptId, actor);
    await audit(db, actor, before?.status === 'pending_review' || !before ? 'result.manual_grade' : 'result.correct', 'attempt', attemptId, { reason, before, after: { marks: res.marks, status: res.status } });
    if (before && before.status !== 'pending_review') {
      const cert = (await q.get<any>(db, "SELECT * FROM certificates WHERE attempt_id=? AND status='valid'", attemptId));
      if (cert && res.status !== 'passed') { await q.run(db, "UPDATE certificates SET status='revoked', reason=? WHERE id=?", `Result corrected: ${reason}`, cert.id); await audit(db, actor, 'certificate.revoke', 'certificate', cert.id, { reason: 'result correction' }); }
    }
    return res;
  }));
}
