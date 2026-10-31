import { Router } from 'express';
import { z } from 'zod';
import { DB, q, tx } from '../db';
import { COOKIE, audit, createSession, destroySession, hashPassword, parseCookies, rateLimit, requireAuth, uid, verifyPassword } from '../security';
import { iso } from '../clock';
import { parse, wrap } from '../http';
import { HttpError } from '../services/tests';
import { readableId, DEMO_USERNAMES } from '../seed';
import { Mail, mailer, publicUrl } from '../services/mailer';
import { guardianMail, resetMail, verifyMail, changedMail } from '../services/mailTemplates';
import { consumeToken, createToken, peekToken } from '../services/emailTokens';

const J = (v: string) => JSON.parse(v);
const pw = z.string().min(8, 'Use at least 8 characters').max(128).refine(s => /[A-Za-z]/.test(s) && /\d/.test(s), 'Use letters and at least one number');
const Subjects = z.array(z.string().trim().min(1).max(40)).max(12);
const Reg = z.object({
  displayName: z.string().trim().min(1, 'Enter your full name').max(60), email: z.string().trim().toLowerCase().email('Enter a valid email'), password: pw,
  role: z.enum(['student', 'parent', 'teacher', 'school_admin']).default('student'),
  consent: z.literal(true, { message: 'Please accept the terms and privacy notice' }),
  under13: z.boolean().default(false), guardianName: z.string().trim().max(60).optional(), guardianEmail: z.string().trim().toLowerCase().max(254).optional(),
  student: z.object({ classLevel: z.number().int().min(1).max(12), medium: z.enum(['Tamil', 'English']), aiLang: z.enum(['ta', 'en', 'both']), academicYear: z.string().regex(/^\d{4}[–-]\d{4}$/, 'Use a format like 2026–2027'), subjects: Subjects.min(1, 'Choose at least one subject'), schoolName: z.string().trim().max(120).optional() }).optional(),
  parent: z.object({ relationship: z.enum(['mother', 'father', 'guardian', 'other']).optional(), linkCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/, 'Enter the 6-character code').optional().or(z.literal('')) }).optional(),
  staff: z.object({ schoolName: z.string().trim().min(2, 'Enter the school or institution name').max(120), subjects: Subjects.optional(), classes: z.array(z.number().int().min(1).max(12)).max(12).optional(), code: z.string().trim().max(40).optional(), institutionEmail: z.string().trim().toLowerCase().max(254).optional() }).optional(),
}).superRefine((b, c) => {
  const need = (ok: boolean, path: (string | number)[], message: string) => { if (!ok) c.addIssue({ code: 'custom', path, message }); };
  if (b.role === 'student') {
    if (b.under13) { need(!!b.guardianName && b.guardianName.length >= 2, ['guardianName'], 'Enter a parent or guardian name'); need(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.guardianEmail ?? ''), ['guardianEmail'], 'Enter a valid guardian email'); }
  }
  if (b.role === 'teacher' || b.role === 'school_admin') need(!!b.staff, ['staff'], 'Enter your school details');
  if (b.role === 'teacher') { need((b.staff?.subjects?.length ?? 0) > 0, ['staff', 'subjects'], 'Choose at least one subject'); need((b.staff?.classes?.length ?? 0) > 0, ['staff', 'classes'], 'Choose at least one class'); }
  if (b.role === 'school_admin') need(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.staff?.institutionEmail ?? ''), ['staff', 'institutionEmail'], 'Enter your institution email');
});
let _dummy: string | null = null; const dummyHash = async () => (_dummy ??= (await hashPassword('not-a-real-password')));
const Login = z.object({ email: z.string().trim().toLowerCase().min(1).max(254), password: z.string().min(1).max(128) });

/** Sends in the background: a slow or failing mail service never delays or breaks the request, and failures are logged without the address. */
function sendMail(m: Mail, what: string) {
  const mm = mailer(); if (!mm) return;
  mm.send(m).catch(e => console.warn(`[mail] ${what} not sent: ${String(e?.message ?? e).slice(0, 120)}`));
}
const NO_MAIL = 'Email is not set up on this server, so we cannot send this email. Please ask your school administrator for help.';
const upsertSetting = (db: DB, key: string, value: string) => q.run(db, 'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value);

export function authRoutes(db: DB) {
  const r = Router(); const secure = process.env.NODE_ENV === 'production';
  const setCookie = (res: any, token: string) => res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: 7 * 864e5, path: '/' });
  r.post('/register', rateLimit(10, 600000), wrap(async (req, res) => {
    const b = parse(Reg, req.body);
    if ((await q.get(db, 'SELECT 1 FROM users WHERE email=?', b.email))) throw new HttpError(409, 'An account with this email already exists. Try signing in.');
    // Privileged roles are never self-assigned: teacher and school-admin sign-ups start as "pending" until a platform admin approves them.
    const privileged = b.role === 'teacher' || b.role === 'school_admin'; const dbRole = privileged ? 'pending' : b.role;
    const link = b.role === 'parent' && b.parent?.linkCode ? J((await q.get<any>(db, 'SELECT value FROM settings WHERE key=?', `gcode:${b.parent.linkCode}`))?.value ?? 'null') : null;
    if (b.role === 'parent' && b.parent?.linkCode && (!link || link.exp < Date.now())) throw new HttpError(422, 'That student link code is invalid or has expired. Check it, or leave it blank and link later.');
    const id = uid(); const hash = await hashPassword(b.password); const t = iso();
    await tx(db, async () => {
      await q.run(db, 'INSERT INTO users(id,email,display_name,password_hash,role,consent_at,created_at) VALUES (?,?,?,?,?,?,?)', id, b.email, b.displayName, hash, dbRole, t, t);
      await audit(db, id, 'user.register', 'user', id, { role: dbRole, requested: b.role });
      if (b.role === 'student') await q.run(db, 'INSERT INTO settings VALUES (?,?)', `under13:${id}`, b.under13 ? '1' : '0');
      if (b.role === 'student' && b.under13) await q.run(db, 'INSERT INTO settings VALUES (?,?)', `guardian:${id}`, JSON.stringify({ name: b.guardianName, email: b.guardianEmail }));
      if (b.role === 'student' && b.student) {
        const st = b.student;
        await q.run(db, 'INSERT INTO student_profiles(user_id,ref_no,full_name,full_name_ta,preferred_name,class_level,medium,ai_lang,academic_year,school_name,school_ref,subjects,goals,avatar,voice_prefs,guardian_approved,completed_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          id, readableId('KM'), b.displayName, null, null, st.classLevel, st.medium, st.aiLang, st.academicYear, st.schoolName || null, null, JSON.stringify(st.subjects), '[]', null, JSON.stringify({ readAloud: false, rate: 1 }), b.under13 ? 0 : 1, t, t);
      }
      if (b.role === 'parent') {
        if (b.parent?.relationship) await q.run(db, 'INSERT INTO settings VALUES (?,?)', `relationship:${id}`, b.parent.relationship);
        if (link) { await q.run(db, 'INSERT INTO guardian_links(parent_id,student_id) VALUES (?,?) ON CONFLICT DO NOTHING', id, link.studentId); await q.run(db, 'UPDATE student_profiles SET guardian_approved=1 WHERE user_id=?', link.studentId); await q.run(db, 'DELETE FROM settings WHERE key=?', `gcode:${b.parent!.linkCode}`); await audit(db, id, 'guardian.link', 'user', link.studentId); }
      }
      if (privileged) await q.run(db, 'INSERT INTO settings VALUES (?,?)', `rolereq:${id}`, JSON.stringify({ requested: b.role, ...b.staff, status: 'pending', at: t }));
    });
    // emails (best effort, in the background): confirm the address; and for an under-13 student, ask the guardian to approve
    if (mailer()) void (async () => {
      try {
        sendMail(verifyMail(b.email, b.displayName, `${publicUrl()}/verify-email?token=${await createToken(db, id, 'verify', { email: b.email })}`), 'verification');
        if (b.role === 'student' && b.under13 && b.guardianEmail) sendMail(guardianMail(b.guardianEmail, b.guardianName ?? 'Parent / Guardian', b.displayName, `${publicUrl()}/guardian-approval?token=${await createToken(db, id, 'guardian', { email: b.guardianEmail, name: b.guardianName ?? '' })}`), 'guardian approval');
      } catch (e: any) { console.warn(`[mail] could not prepare sign-up emails: ${String(e?.message ?? e).slice(0, 100)}`); }
    })();
    const s = await createSession(db, id); setCookie(res, s.token);
    res.status(201).json({ user: { id, email: b.email, display_name: b.displayName, role: dbRole }, csrf: s.csrf, needsProfile: b.role === 'student' && !b.student, requestedRole: b.role, pendingApproval: privileged });
  }));
  r.post('/login', rateLimit(15, 600000, req => `${req.ip}:${String(req.body?.email ?? '').toLowerCase()}`), wrap(async (req, res) => {
    const b = parse(Login, req.body);
    const ident = process.env.SEED_DEMO === '0' ? b.email : (DEMO_USERNAMES[b.email] ?? b.email);
    const u = (await q.get<any>(db, 'SELECT * FROM users WHERE email=?', ident));
    // always run one password hash, even for unknown accounts, so response time does not reveal which emails exist
    const ok = u ? !u.disabled && await verifyPassword(b.password, u.password_hash) : (await verifyPassword(b.password, await dummyHash()), false);
    if (!ok) { await audit(db, u?.id ?? null, 'auth.login_failed', 'user', u?.id); throw new HttpError(401, 'Email or password is incorrect.'); }
    const s = await createSession(db, u.id); setCookie(res, s.token); await audit(db, u.id, 'auth.login', 'user', u.id);
    res.json({ user: { id: u.id, email: u.email, display_name: u.display_name, role: u.role }, csrf: s.csrf });
  }));
  r.post('/logout', wrap(async (req, res) => { const t = parseCookies(req.headers.cookie)[COOKIE]; if (t) await destroySession(db, t); res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); }));
  r.get('/me', wrap(async (req, res) => {
    if (!req.user) return void res.json({ user: null });
    const u = req.user; const p = u.role === 'student' ? (await q.get<any>(db, 'SELECT * FROM student_profiles WHERE user_id=?', u.id)) : null;
    const emailVerified = !!(await q.get(db, 'SELECT 1 x FROM settings WHERE key=?', `emailverified:${u.id}`));
    res.json({ user: u, csrf: req.csrf, profile: p ? shapeProfile(p) : null, needsProfile: u.role === 'student' && !p?.completed_at, emailVerified });
  }));

  // ---- email: what this server can do, password reset, address verification, guardian approval ----
  r.get('/config', wrap(async (_req, res) => { res.json({ email: { enabled: !!mailer() } }); }));

  r.post('/forgot', rateLimit(5, 900000, req => `forgot:${req.ip}:${String(req.body?.email ?? '').toLowerCase()}`), wrap(async (req, res) => {
    const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email').max(254) }), req.body);
    if (!mailer()) throw new HttpError(501, NO_MAIL);
    const u = await q.get<any>(db, 'SELECT id,email,display_name,disabled,is_demo FROM users WHERE email=?', email);
    if (u && !u.disabled && !u.is_demo) { sendMail(resetMail(u.email, u.display_name, `${publicUrl()}/reset-password?token=${await createToken(db, u.id, 'reset')}`), 'password reset'); await audit(db, u.id, 'auth.reset_requested', 'user', u.id); }
    res.json({ ok: true }); // the same answer whether or not the address has an account
  }));
  r.post('/reset', rateLimit(10, 900000), wrap(async (req, res) => {
    const b = parse(z.object({ token: z.string().max(100), password: pw }), req.body); // password is checked first: a weak password must not use up the link
    const t = await consumeToken(db, b.token, 'reset'); if (!t) throw new HttpError(400, 'This link has expired or was already used. Please ask for a new one.');
    const hash = await hashPassword(b.password);
    await tx(db, async () => { await q.run(db, 'UPDATE users SET password_hash=? WHERE id=?', hash, t.userId); await q.run(db, 'DELETE FROM sessions WHERE user_id=?', t.userId); });
    await audit(db, t.userId, 'auth.password_reset', 'user', t.userId);
    const u = await q.get<any>(db, 'SELECT email,display_name FROM users WHERE id=?', t.userId); if (u) sendMail(changedMail(u.email, u.display_name), 'password-changed notice');
    res.json({ ok: true });
  }));

  r.post('/send-verification', requireAuth, rateLimit(3, 3600000, req => `verify:${req.user?.id ?? req.ip}`), wrap(async (req, res) => {
    const u = req.user!; if (!mailer()) throw new HttpError(501, NO_MAIL);
    if (await q.get(db, 'SELECT 1 x FROM settings WHERE key=?', `emailverified:${u.id}`)) return void res.json({ ok: true, alreadyVerified: true });
    sendMail(verifyMail(u.email, u.display_name, `${publicUrl()}/verify-email?token=${await createToken(db, u.id, 'verify', { email: u.email })}`), 'verification'); res.json({ ok: true });
  }));
  r.post('/verify', rateLimit(20, 900000), wrap(async (req, res) => {
    const { token } = parse(z.object({ token: z.string().max(100) }), req.body);
    const t = await consumeToken(db, token, 'verify'); if (!t) throw new HttpError(400, 'This link has expired or was already used. Sign in and ask for a new one.');
    const u = await q.get<any>(db, 'SELECT email FROM users WHERE id=?', t.userId); if (!u || u.email !== t.payload.email) throw new HttpError(400, 'This link is for a different email address.');
    await upsertSetting(db, `emailverified:${t.userId}`, iso()); await audit(db, t.userId, 'auth.email_verified', 'user', t.userId); res.json({ ok: true });
  }));

  /** The guardian opens the emailed link (no sign-in) to see who is asking and to approve or decline. */
  r.post('/guardian/lookup', rateLimit(30, 900000), wrap(async (req, res) => {
    const { token } = parse(z.object({ token: z.string().max(100) }), req.body); const t = await peekToken(db, token, 'guardian');
    if (!t) throw new HttpError(400, 'This link has expired or was already used. Ask the student to send a new one from their account.');
    const p = await q.get<any>(db, 'SELECT p.full_name, p.class_level, p.guardian_approved FROM student_profiles p WHERE p.user_id=?', t.userId); const u = await q.get<any>(db, 'SELECT display_name FROM users WHERE id=?', t.userId);
    res.json({ studentName: p?.full_name ?? u?.display_name ?? 'the student', classLevel: p?.class_level ?? null, guardianName: t.payload.name ?? '', alreadyApproved: !!p?.guardian_approved });
  }));
  r.post('/guardian/decide', rateLimit(10, 900000), wrap(async (req, res) => {
    const b = parse(z.object({ token: z.string().max(100), decision: z.enum(['approve', 'decline']), guardianName: z.string().trim().min(2, 'Enter your name').max(60) }), req.body);
    const t = await consumeToken(db, b.token, 'guardian'); if (!t) throw new HttpError(400, 'This link has expired or was already used. Ask the student to send a new one from their account.');
    const at = iso(); const approve = b.decision === 'approve';
    await tx(db, async () => {
      if (approve) await q.run(db, 'UPDATE student_profiles SET guardian_approved=1, updated_at=? WHERE user_id=?', at, t.userId);
      await upsertSetting(db, `guardian_consent:${t.userId}`, JSON.stringify({ decision: b.decision, name: b.guardianName, email: t.payload.email, at, via: 'email-link' }));
      await q.run(db, 'INSERT INTO notifications(id,user_id,title,body,created_at) VALUES (?,?,?,?,?)', uid(), t.userId, approve ? 'Your parent or guardian approved your account' : 'Your parent or guardian did not approve the account', approve ? 'You can now use the tutor.' : 'Please talk to them, or ask your school for help.', at);
    });
    await audit(db, t.userId, approve ? 'guardian.approved' : 'guardian.declined', 'user', t.userId, { by: t.payload.email });
    res.json({ ok: true, decision: b.decision });
  }));
  r.post('/guardian/resend', requireAuth, rateLimit(2, 3600000, req => `gres:${req.user?.id ?? req.ip}`), wrap(async (req, res) => {
    const u = req.user!; if (!mailer()) throw new HttpError(501, NO_MAIL);
    const g = (await q.get<any>(db, 'SELECT value FROM settings WHERE key=?', `guardian:${u.id}`))?.value; const p = await q.get<any>(db, 'SELECT guardian_approved FROM student_profiles WHERE user_id=?', u.id);
    if (u.role !== 'student' || !g) throw new HttpError(400, 'There is no guardian email on this account.'); if (p?.guardian_approved) return void res.json({ ok: true, alreadyApproved: true });
    const gj = J(g); sendMail(guardianMail(gj.email, gj.name || 'Parent / Guardian', u.display_name, `${publicUrl()}/guardian-approval?token=${await createToken(db, u.id, 'guardian', { email: gj.email, name: gj.name ?? '' })}`), 'guardian approval'); res.json({ ok: true });
  }));
  return r;
}
export function shapeProfile(p: any) { return { ...p, subjects: JSON.parse(p.subjects), goals: JSON.parse(p.goals), voice_prefs: JSON.parse(p.voice_prefs) }; }
export { readableId };
