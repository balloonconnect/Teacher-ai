import { systemStatus } from '../services/status';
import { Router } from 'express';
import { z } from 'zod';
import { DB, q, tx } from '../db';
import { audit, hashPassword, newToken, requireRole, uid } from '../security';
import { mailer, publicUrl } from '../services/mailer';
import { createToken } from '../services/emailTokens';
import { resetMail } from '../services/mailTemplates';
import { iso } from '../clock';
import { J, canAccessStudent, parse, wrap } from '../http';
import { HttpError, testStatus } from '../services/tests';
import { activitySummary, studentReport } from './student';
import { readableId } from '../seed';

export function parentRoutes(db: DB) {
  const r = Router(); r.use(requireRole('parent'));
  const kids = async (id: string) => (await q.all<any>(db, 'SELECT g.student_id, g.notify, p.full_name, p.class_level, p.ref_no, p.academic_year, p.subjects, p.medium FROM guardian_links g JOIN student_profiles p ON p.user_id=g.student_id WHERE g.parent_id=?', id));
  r.get('/children', wrap(async (req, res) => res.json({ children: (await Promise.all((await kids(req.user!.id)).map(async k => ({ ...k, subjects: J(k.subjects), report: (({ finalised, passed, passRate, pending }) => ({ finalised, passed, passRate, pending }))(await studentReport(db, k.student_id)) })))) })));
  r.post('/link', wrap(async (req, res) => {
    const b = parse(z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/, 'Enter the 6-character code from your child’s settings') }), req.body);
    const row = (await q.get<any>(db, 'SELECT value FROM settings WHERE key=?', `gcode:${b.code}`)); const v = row ? J(row.value) : null;
    if (!v || v.exp < Date.now()) throw new HttpError(404, 'That code is invalid or has expired.');
    await tx(db, async () => { await q.run(db, 'INSERT INTO guardian_links(parent_id,student_id) VALUES (?,?) ON CONFLICT DO NOTHING', req.user!.id, v.studentId); await q.run(db, 'UPDATE student_profiles SET guardian_approved=1 WHERE user_id=?', v.studentId); await q.run(db, 'DELETE FROM settings WHERE key=?', `gcode:${b.code}`); await audit(db, req.user!.id, 'guardian.link', 'user', v.studentId); });
    res.json({ ok: true });
  }));
  r.get('/children/:id/overview', wrap(async (req, res) => {
    const sid = req.params.id; if (!(await canAccessStudent(db, req.user!, sid))) throw new HttpError(403, 'You do not have access to this student.');
    const p = (await q.get<any>(db, 'SELECT * FROM student_profiles WHERE user_id=?', sid))!; const rep = await studentReport(db, sid);
    const tests = (await Promise.all((await q.all<any>(db, 'SELECT t.*, s.name_en subject_en FROM tests t JOIN subjects s ON s.id=t.subject_id WHERE t.published=1 AND t.class_level=? AND t.academic_year=? ORDER BY t.opens_at DESC', p.class_level, p.academic_year)).map(async t => { const st = await testStatus(db, t, sid); return { id: t.id, title: t.title, subject_en: t.subject_en, opens_at: t.opens_at, closes_at: t.closes_at, status: st.status, pct: st.best?.pct ?? null }; })));
    const history = (await q.all<any>(db, "SELECT t.title, a.attempt_no, a.submitted_at, r.marks, r.total, r.pct, r.status FROM attempts a JOIN results r ON r.attempt_id=a.id JOIN tests t ON t.id=a.test_id WHERE a.student_id=? AND a.status!='in_progress' ORDER BY a.submitted_at DESC", sid));
    const certs = (await q.all<any>(db, 'SELECT id, ref_no, status, issued_at, snapshot FROM certificates WHERE student_id=? ORDER BY issued_at DESC', sid)).map(c => ({ id: c.id, ref_no: c.ref_no, status: c.status, issued_at: c.issued_at, title: J(c.snapshot).test_title }));
    const link = (await q.get<any>(db, 'SELECT notify FROM guardian_links WHERE parent_id=? AND student_id=?', req.user!.id, sid));
    res.json({ student: { id: sid, name: p.full_name, class_level: p.class_level, ref_no: p.ref_no, academic_year: p.academic_year, subjects: J(p.subjects) }, report: rep, activity: await activitySummary(db, sid), tests, history, certificates: certs, notify: !!link?.notify,
      recommendations: rep.revisionTopics.length ? rep.revisionTopics.slice(0, 3).map(t => `Spend 15 minutes this week practising “${t.topic}” (${t.pct}% in recent tests).`) : [rep.finalised ? 'Keep up the steady practice.' : 'Encourage a weekly test to see where support is needed.'] });
  }));
  r.put('/children/:id/settings', wrap(async (req, res) => { const b = parse(z.object({ notify: z.boolean() }), req.body); if (!(await canAccessStudent(db, req.user!, req.params.id))) throw new HttpError(403, 'No access.'); await q.run(db, 'UPDATE guardian_links SET notify=? WHERE parent_id=? AND student_id=?', b.notify ? 1 : 0, req.user!.id, req.params.id); res.json({ ok: true }); }));
  return r;
}

export function schoolRoutes(db: DB) {
  const r = Router(); r.use(requireRole('school_admin', 'admin'));
  const sid = (req: any) => (req.user!.role === 'admin' ? String(req.query.schoolId ?? 'school-demo') : req.user!.school_id!);
  r.get('/overview', wrap(async (req, res) => { const s = sid(req); const c = async (sql: string) => (await q.get<any>(db, sql, s))!.n;
    const fin = (await q.get<any>(db, "SELECT COUNT(*) n, SUM(CASE WHEN r.status='passed' THEN 1 ELSE 0 END) p FROM results r JOIN attempts a ON a.id=r.attempt_id JOIN users u ON u.id=a.student_id WHERE u.school_id=? AND a.status='finalised'", s))!;
    res.json({ school: (await q.get(db, 'SELECT * FROM schools WHERE id=?', s)), students: await c("SELECT COUNT(*) n FROM users WHERE school_id=? AND role='student'"), teachers: await c("SELECT COUNT(*) n FROM users WHERE school_id=? AND role='teacher'"), classes: await c('SELECT COUNT(*) n FROM classes WHERE school_id=?'), certificates: await c("SELECT COUNT(*) n FROM certificates c JOIN users u ON u.id=c.student_id WHERE u.school_id=? AND c.status='valid'"), attempts: fin.n, passRate: fin.n ? Math.round((fin.p / fin.n) * 100) : null }); }));
  r.get('/users', wrap(async (req, res) => res.json({ users: (await q.all(db, 'SELECT id,email,display_name,role,disabled,created_at FROM users WHERE school_id=? ORDER BY role, display_name', sid(req))) })));
  r.post('/users', wrap(async (req, res) => {
    const b = parse(z.object({ email: z.string().trim().toLowerCase().email(), displayName: z.string().trim().min(1).max(60), role: z.enum(['teacher', 'student']), tempPassword: z.string().min(8).max(100).regex(/\d/).regex(/[A-Za-z]/), fullName: z.string().trim().max(80).optional(), classLevel: z.number().int().min(1).max(12).optional(), academicYear: z.string().optional() }), req.body);
    if ((await q.get(db, 'SELECT 1 FROM users WHERE email=?', b.email))) throw new HttpError(409, 'That email is already registered.'); const id = uid(); const hash = await hashPassword(b.tempPassword);
    await tx(db, async () => { await q.run(db, 'INSERT INTO users(id,email,display_name,password_hash,role,school_id,consent_at,created_at) VALUES (?,?,?,?,?,?,?,?)', id, b.email, b.displayName, hash, b.role, sid(req), iso(), iso());
      if (b.role === 'student') { if (!b.classLevel) throw new HttpError(400, 'Choose a class for the student.'); await q.run(db, 'INSERT INTO student_profiles(user_id,ref_no,full_name,class_level,medium,ai_lang,academic_year,school_name,subjects,goals,guardian_approved,school_managed,completed_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, readableId('KM'), b.fullName ?? b.displayName, b.classLevel, 'English', 'both', b.academicYear ?? '2026–2027', (await q.get<any>(db, 'SELECT name FROM schools WHERE id=?', sid(req)))?.name, '["maths","science","english","social","tamil"]', '[]', 1, 1, iso(), iso()); }
      await audit(db, req.user!.id, 'user.create', 'user', id, { role: b.role }); });
    res.status(201).json({ id });
  }));
  r.post('/classes', wrap(async (req, res) => { const b = parse(z.object({ name: z.string().trim().min(2).max(60), classLevel: z.number().int().min(1).max(12), academicYear: z.string(), teacherId: z.string().optional() }), req.body); if (b.teacherId && !(await q.get(db, "SELECT 1 FROM users WHERE id=? AND role='teacher' AND school_id=?", b.teacherId, sid(req)))) throw new HttpError(400, 'Teacher not found in this school.'); const id = uid(); await q.run(db, 'INSERT INTO classes VALUES (?,?,?,?,?,?)', id, sid(req), b.teacherId ?? null, b.name, b.classLevel, b.academicYear); await audit(db, req.user!.id, 'class.create', 'class', id); res.status(201).json({ id }); }));
  r.get('/classes', wrap(async (req, res) => res.json({ classes: (await q.all<any>(db, 'SELECT c.*, u.display_name teacher, (SELECT COUNT(*) FROM enrolments WHERE class_id=c.id) students FROM classes c LEFT JOIN users u ON u.id=c.teacher_id WHERE c.school_id=?', sid(req))) })));
  /** Authorised class/year change for a school-managed student; historical results keep their original context. */
  r.put('/students/:id/class', wrap(async (req, res) => {
    const b = parse(z.object({ classLevel: z.number().int().min(1).max(12), academicYear: z.string().regex(/^\d{4}[–-]\d{4}$/) }), req.body);
    const s = (await q.get<any>(db, "SELECT u.school_id FROM users u WHERE u.id=? AND u.role='student'", req.params.id)); if (!s || (req.user!.role !== 'admin' && s.school_id !== req.user!.school_id)) throw new HttpError(404, 'Student not found.');
    await q.run(db, 'UPDATE student_profiles SET class_level=?, academic_year=?, updated_at=? WHERE user_id=?', b.classLevel, b.academicYear, iso(), req.params.id); await audit(db, req.user!.id, 'student.class_change', 'user', req.params.id, b); res.json({ ok: true });
  }));
  return r;
}

export function adminRoutes(db: DB) {
  const r = Router(); r.use(requireRole('admin'));
  r.get('/system', wrap(async (_req, res) => res.json(await systemStatus(db))));
  r.get('/stats', wrap(async (_req, res) => { const n = async (s: string) => (await q.get<any>(db, s))!.n; res.json({ users: await n('SELECT COUNT(*) n FROM users'), students: await n("SELECT COUNT(*) n FROM users WHERE role='student'"), schools: await n('SELECT COUNT(*) n FROM schools'), tests: await n('SELECT COUNT(*) n FROM tests'), attempts: await n('SELECT COUNT(*) n FROM attempts'), certificates: await n("SELECT COUNT(*) n FROM certificates WHERE status='valid'"), lessons: await n('SELECT COUNT(*) n FROM lessons'), questions: await n('SELECT COUNT(*) n FROM questions'), errorsNote: 'Operational errors are written to the server log; none are stored in the database.' }); }));
  r.get('/role-requests', wrap(async (_req, res) => res.json({ requests: (await q.all<any>(db, "SELECT s.key, s.value, u.id, u.email, u.display_name, u.role FROM settings s JOIN users u ON s.key = 'rolereq:' || u.id WHERE u.role='pending' AND u.disabled=0 ORDER BY u.created_at")).map(x => ({ userId: x.id, email: x.email, name: x.display_name, ...JSON.parse(x.value) })) })));
  /** Approve or decline a teacher / school-admin sign-up. Approving gives the role they asked for; declining switches the account off. */
  r.post('/role-requests/:id/decide', wrap(async (req, res) => {
    const b = parse(z.object({ decision: z.enum(['approve', 'decline']), schoolId: z.string().nullable().optional() }), req.body);
    const u = await q.get<any>(db, 'SELECT id,role FROM users WHERE id=?', req.params.id); if (!u || u.role !== 'pending') throw new HttpError(404, 'There is no waiting request for this person.');
    const row = await q.get<any>(db, 'SELECT value FROM settings WHERE key=?', `rolereq:${u.id}`); const rq = row ? JSON.parse(row.value) : {}; const role = rq.requested === 'school_admin' ? 'school_admin' : 'teacher';
    if (b.schoolId && !(await q.get(db, 'SELECT 1 FROM schools WHERE id=?', b.schoolId))) throw new HttpError(400, 'That school does not exist.');
    const approve = b.decision === 'approve'; const at = iso();
    await tx(db, async () => {
      if (approve) { await q.run(db, 'UPDATE users SET role=? WHERE id=?', role, u.id); if (b.schoolId) await q.run(db, 'UPDATE users SET school_id=? WHERE id=?', b.schoolId, u.id); }
      else { await q.run(db, 'UPDATE users SET disabled=1 WHERE id=?', u.id); await q.run(db, 'DELETE FROM sessions WHERE user_id=?', u.id); }
      await q.run(db, 'UPDATE settings SET value=? WHERE key=?', JSON.stringify({ ...rq, status: approve ? 'approved' : 'declined', decidedAt: at }), `rolereq:${u.id}`);
      await q.run(db, 'INSERT INTO notifications(id,user_id,title,body,created_at) VALUES (?,?,?,?,?)', uid(), u.id, approve ? 'Your account was approved' : 'Your sign-up was not approved', approve ? `You can now use Karkai AI as a ${role === 'teacher' ? 'teacher' : 'school admin'}.` : 'Please contact your school if you think this is a mistake.', at);
      await audit(db, req.user!.id, approve ? 'role.approved' : 'role.declined', 'user', u.id, { role, schoolId: b.schoolId ?? null });
    });
    res.json({ ok: true, role: approve ? role : null });
  }));
  /** Help someone who is locked out. "email" sends a one-time reset link; "temp" sets a one-time password the admin hands over (shown once, never stored in clear). */
  r.post('/users/:id/reset-password', wrap(async (req, res) => {
    const b = parse(z.object({ mode: z.enum(['email', 'temp']) }), req.body);
    const u = await q.get<any>(db, 'SELECT id,email,display_name,disabled,is_demo FROM users WHERE id=?', req.params.id); if (!u) throw new HttpError(404, 'User not found.');
    if (u.is_demo) throw new HttpError(400, 'Demo accounts have a fixed password.'); if (u.disabled) throw new HttpError(400, 'This account is switched off. Turn it on first.');
    if (b.mode === 'email') {
      const m = mailer(); if (!m) throw new HttpError(400, 'Email is not set up on this server. Use a temporary password instead.');
      try { await m.send(resetMail(u.email, u.display_name, `${publicUrl()}/reset-password?token=${await createToken(db, u.id, 'reset')}`)); } catch { throw new HttpError(502, 'The email service did not accept the message. Try again, or use a temporary password.'); }
      await audit(db, req.user!.id, 'user.reset_link_sent', 'user', u.id); return void res.json({ ok: true, sent: true });
    }
    const temp = `${newToken(6)}${Math.floor(10 + Math.random() * 90)}`; // letters and digits, 10+ characters
    await tx(db, async () => { await q.run(db, 'UPDATE users SET password_hash=? WHERE id=?', await hashPassword(temp), u.id); await q.run(db, 'DELETE FROM sessions WHERE user_id=?', u.id); await audit(db, req.user!.id, 'user.temp_password', 'user', u.id); });
    res.json({ ok: true, temporaryPassword: temp });
  }));
  r.get('/users', wrap(async (req, res) => { const f = String(req.query.q ?? '').trim().toLowerCase().slice(0, 60); res.json({ users: await q.all(db, `SELECT id,email,display_name,role,school_id,disabled,is_demo,created_at FROM users ${f ? "WHERE lower(email) LIKE ? OR lower(display_name) LIKE ?" : ''} ORDER BY created_at DESC LIMIT 300`, ...(f ? [`%${f}%`, `%${f}%`] : [])) }); }));
  r.patch('/users/:id', wrap(async (req, res) => {
    const b = parse(z.object({ role: z.enum(['student', 'parent', 'teacher', 'school_admin', 'admin']).optional(), disabled: z.boolean().optional(), schoolId: z.string().nullable().optional() }), req.body);
    if (req.params.id === req.user!.id && (b.disabled || (b.role && b.role !== 'admin'))) throw new HttpError(400, 'You cannot remove your own admin access.');
    const u = (await q.get<any>(db, 'SELECT * FROM users WHERE id=?', req.params.id)); if (!u) throw new HttpError(404, 'User not found.');
    await tx(db, async () => { if (b.role) await q.run(db, 'UPDATE users SET role=? WHERE id=?', b.role, u.id); if (b.disabled !== undefined) { await q.run(db, 'UPDATE users SET disabled=? WHERE id=?', b.disabled ? 1 : 0, u.id); if (b.disabled) await q.run(db, 'DELETE FROM sessions WHERE user_id=?', u.id); } if (b.schoolId !== undefined) await q.run(db, 'UPDATE users SET school_id=? WHERE id=?', b.schoolId, u.id); await audit(db, req.user!.id, 'user.update', 'user', u.id, b); });
    res.json({ ok: true });
  }));
  r.get('/schools', wrap(async (_req, res) => res.json({ schools: (await q.all(db, 'SELECT s.*, (SELECT COUNT(*) FROM users WHERE school_id=s.id) users FROM schools s')) })));
  r.post('/schools', wrap(async (req, res) => { const b = parse(z.object({ name: z.string().trim().min(3).max(120) }), req.body); const id = uid(); await q.run(db, 'INSERT INTO schools VALUES (?,?,?)', id, b.name, iso()); await audit(db, req.user!.id, 'school.create', 'school', id); res.status(201).json({ id }); }));
  r.get('/audit', wrap(async (req, res) => { const action = String(req.query.action ?? ''); const rows = (await q.all<any>(db, `SELECT a.id, a.actor_id, u.display_name actor, a.action, a.entity, a.entity_id, a.details, a.at FROM audit a LEFT JOIN users u ON u.id=a.actor_id ${action ? 'WHERE a.action LIKE ?' : ''} ORDER BY a.id DESC LIMIT 200`, ...(action ? [`${action}%`] : []))); res.json({ audit: rows.map(x => ({ ...x, details: J(x.details) })) }); }));
  r.get('/settings', wrap(async (_req, res) => res.json({ ai_daily_limit: Number((await q.get<any>(db, "SELECT value FROM settings WHERE key='ai_daily_limit'"))?.value ?? 200) })));
  r.put('/settings', wrap(async (req, res) => { const b = parse(z.object({ ai_daily_limit: z.number().int().min(1).max(5000) }), req.body); await q.run(db, "INSERT INTO settings VALUES ('ai_daily_limit',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", String(b.ai_daily_limit)); await audit(db, req.user!.id, 'settings.update', 'settings', undefined, b); res.json({ ok: true }); }));
  r.get('/ai', wrap(async (_req, res) => { const key = !!process.env.ANTHROPIC_API_KEY;
    res.json({ provider: key && (process.env.AI_PROVIDER ?? 'anthropic') === 'anthropic' ? 'anthropic' : 'development-tutor', configured: key, model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5', note: key ? 'External AI provider configured.' : 'No AI key is set: the built-in development tutor (rule-based, not a language model) is answering.', usageByDay: (await q.all(db, "SELECT substr(at,1,10) day, COUNT(*) requests, SUM(input_chars) input_chars, SUM(output_chars) output_chars FROM ai_usage GROUP BY day ORDER BY day DESC LIMIT 14")), usageByProvider: (await q.all(db, 'SELECT provider, COUNT(*) requests FROM ai_usage GROUP BY provider')), tokensByDay: await q.all(db, "SELECT substr(at,1,10) day, COUNT(*) calls, SUM(input_tokens) input_tokens, SUM(output_tokens) output_tokens FROM ai_token_usage GROUP BY day ORDER BY day DESC LIMIT 14"), cost: await estimateCost(db), costNote: 'Tokens are the counts the AI provider reports. Cost is an estimate that needs LLM_PRICE_IN_PER_MTOK and LLM_PRICE_OUT_PER_MTOK (your provider\'s price per million tokens); it is not a bill.' }); }));
  r.get('/curriculum', wrap(async (_req, res) => res.json({ lessons: (await q.all(db, 'SELECT id,class_level,subject_id,chapter_no,title_en,status,source,version FROM lessons ORDER BY class_level, subject_id, chapter_no')) })));
  r.post('/curriculum/import', wrap(async (req, res) => {
    const b = parse(z.object({ id: z.string().regex(/^[a-z0-9-]{3,60}$/), classLevel: z.number().int().min(1).max(12), subjectId: z.string(), chapterNo: z.number().int().min(1), chapterEn: z.string().min(2), chapterTa: z.string().min(1), titleEn: z.string().min(2), titleTa: z.string().min(1), minutes: z.number().int().min(1).max(120).default(15), source: z.string().trim().min(5, 'Cite the source and licence of the content').max(300), content: z.object({ objectives: z.object({ en: z.array(z.string()), ta: z.array(z.string()) }), sections: z.array(z.object({ h_en: z.string(), h_ta: z.string(), en: z.string(), ta: z.string() })).min(1) }).passthrough() }), req.body);
    if ((await q.get(db, 'SELECT 1 FROM lessons WHERE id=?', b.id))) throw new HttpError(409, 'A lesson with this id already exists.');
    await q.run(db, "INSERT INTO lessons(id,class_level,subject_id,chapter_no,chapter_en,chapter_ta,title_en,title_ta,minutes,position,content,source,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'draft')", b.id, b.classLevel, b.subjectId, b.chapterNo, b.chapterEn, b.chapterTa, b.titleEn, b.titleTa, b.minutes, 1, JSON.stringify({ vocab: [], examples: [], realLife: { en: '', ta: '' }, mistakes: [], ...b.content }), b.source); await audit(db, req.user!.id, 'curriculum.import', 'lesson', b.id); res.status(201).json({ id: b.id, status: 'draft' });
  }));
  r.post('/curriculum/:id/publish', wrap(async (req, res) => { const l = (await q.get(db, 'SELECT 1 FROM lessons WHERE id=?', req.params.id)); if (!l) throw new HttpError(404, 'Lesson not found.'); await q.run(db, "UPDATE lessons SET status='published', version=version+1 WHERE id=?", req.params.id); await audit(db, req.user!.id, 'curriculum.publish', 'lesson', req.params.id); res.json({ ok: true }); }));
  r.get('/templates', wrap(async (_req, res) => res.json({ certificateTemplates: [{ type: 'weekly_test_achievement', version: 1, title: 'AI Learning Platform — Weekly Test Achievement Certificate', status: 'active', size: 'A4 landscape' }, { type: 'subject_mastery', version: 0, status: 'not implemented' }, { type: 'chapter_completion', version: 0, status: 'not implemented' }, { type: 'learning_milestone', version: 0, status: 'not implemented' }], testTemplates: [{ name: 'Weekly test (objective + short answer)', passPct: 40, maxAttempts: 1, scoreRule: 'highest' }] })));
  r.get('/security', wrap(async (_req, res) => res.json({ passwordHashing: 'scrypt (per-user salt)', sessions: 'Random 256-bit token, SHA-256 hashed at rest, HttpOnly + SameSite=Lax cookie, 7-day expiry', csrf: 'Per-session token required in X-CSRF-Token for state-changing requests', rateLimits: { login: '15 / 10 min per IP+email', register: '10 / 10 min per IP', tutor: '40 / min per user', uploads: '20 / 10 min per user', links: '15 / 10 min per user' }, uploads: 'Private directory, magic-byte validation, 10 MB limit', urlFetching: 'SSRF protection: scheme/port allow-list, DNS-resolved IP validation, pinned connection, redirect re-validation, size/time limits', tenantIsolation: 'Server-side ownership checks on every student-scoped endpoint' })));
  return r;
}

/** Estimated spend from stored token counts and the per-million-token prices the operator sets. Returns null prices when they are not configured. */
export async function estimateCost(db: DB, env = process.env) {
  const pin = Number(env.LLM_PRICE_IN_PER_MTOK), pout = Number(env.LLM_PRICE_OUT_PER_MTOK); const priced = Number.isFinite(pin) && Number.isFinite(pout) && env.LLM_PRICE_IN_PER_MTOK !== undefined && env.LLM_PRICE_OUT_PER_MTOK !== undefined;
  const t = (await q.get<any>(db, 'SELECT COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o, COUNT(*) calls FROM ai_token_usage'))!;
  const m = (await q.get<any>(db, "SELECT COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o FROM ai_token_usage WHERE substr(at,1,7)=?", iso().slice(0, 7)))!;
  const cost = (i: number, o: number) => priced ? Math.round(((i * pin + o * pout) / 1e6) * 10000) / 10000 : null;
  return { priced, currency: env.LLM_PRICE_CURRENCY ?? 'USD', calls: t.calls, inputTokens: t.i, outputTokens: t.o, total: cost(t.i, t.o), thisMonth: cost(m.i, m.o) };
}
