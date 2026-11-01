import { Router } from 'express';
import { z } from 'zod';
import { DB, q, tx } from '../db';
import { storage } from '../services/storage';
import { audit, requireRole, uid } from '../security';
import { iso } from '../clock';
import { parse, wrap } from '../http';
import { HttpError } from '../services/tests';
import { readableId } from '../seed';
import { shapeProfile } from './auth';

const Profile = z.object({
  fullName: z.string().trim().min(2, 'Enter the student’s full name').max(80), fullNameTa: z.string().trim().max(80).optional().or(z.literal('')),
  preferredName: z.string().trim().max(40).optional().or(z.literal('')),
  classLevel: z.number().int().min(1).max(12), medium: z.enum(['Tamil', 'English']), aiLang: z.enum(['ta', 'en', 'both']),
  academicYear: z.string().regex(/^\d{4}[–-]\d{4}$/, 'Use a format like 2026–2027'),
  schoolName: z.string().trim().max(120).optional().or(z.literal('')), schoolRef: z.string().trim().max(40).optional().or(z.literal('')),
  subjects: z.array(z.string()).min(1, 'Choose at least one subject'), goals: z.array(z.enum(['understand', 'homework', 'exams', 'marks', 'practise'])).default([]),
  avatar: z.string().max(8).optional().or(z.literal('')), voicePrefs: z.object({ readAloud: z.boolean().default(false), rate: z.number().min(0.5).max(1.5).default(1) }).default({ readAloud: false, rate: 1 }),
  confirmChange: z.boolean().optional(),
});
export function profileRoutes(db: DB) {
  const r = Router();
  r.get('/', requireRole('student'), wrap(async (req, res) => { const p = (await q.get<any>(db, 'SELECT * FROM student_profiles WHERE user_id=?', req.user!.id)); res.json({ profile: p ? shapeProfile(p) : null, under13: (await q.get<any>(db, 'SELECT value FROM settings WHERE key=?', `under13:${req.user!.id}`))?.value === '1' }); }));
  r.put('/', requireRole('student'), wrap(async (req, res) => {
    const b = parse(Profile, req.body); const id = req.user!.id; const cur = (await q.get<any>(db, 'SELECT * FROM student_profiles WHERE user_id=?', id));
    if (cur?.school_managed && (cur.class_level !== b.classLevel || cur.academic_year !== b.academicYear)) throw new HttpError(403, 'Your class and academic year are managed by your school. Please ask your teacher to change them.');
    if (cur?.completed_at && cur.class_level !== b.classLevel && !b.confirmChange) throw new HttpError(409, 'Changing your class updates your lessons. Past test results keep their original class. Please confirm to continue.');
    const under13 = (await q.get<any>(db, 'SELECT value FROM settings WHERE key=?', `under13:${id}`))?.value === '1';
    const vals = [b.fullName, b.fullNameTa || null, b.preferredName || null, b.classLevel, b.medium, b.aiLang, b.academicYear, b.schoolName || null, b.schoolRef || null, JSON.stringify(b.subjects), JSON.stringify(b.goals), b.avatar || null, JSON.stringify(b.voicePrefs), iso()];
    if (cur) await q.run(db, 'UPDATE student_profiles SET full_name=?,full_name_ta=?,preferred_name=?,class_level=?,medium=?,ai_lang=?,academic_year=?,school_name=?,school_ref=?,subjects=?,goals=?,avatar=?,voice_prefs=?,updated_at=?, completed_at=COALESCE(completed_at, ?) WHERE user_id=?', ...vals, iso(), id);
    else await q.run(db, 'INSERT INTO student_profiles(user_id,ref_no,full_name,full_name_ta,preferred_name,class_level,medium,ai_lang,academic_year,school_name,school_ref,subjects,goals,avatar,voice_prefs,guardian_approved,completed_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, readableId('KM'), ...vals.slice(0, 13), under13 ? 0 : 1, iso(), iso());
    await audit(db, id, cur ? 'profile.update' : 'profile.create', 'profile', id);
    res.json({ profile: shapeProfile((await q.get<any>(db, 'SELECT * FROM student_profiles WHERE user_id=?', id))) });
  }));
  /** Guardian link code (student → parent), 6 characters, valid 7 days. */
  r.post('/guardian-code', requireRole('student'), wrap(async (req, res) => {
    const code = uid().replace(/-/g, '').slice(0, 6).toUpperCase(); await q.run(db, 'INSERT INTO settings VALUES (?,?)', `gcode:${code}`, JSON.stringify({ studentId: req.user!.id, exp: Date.now() + 7 * 864e5 }));
    res.json({ code });
  }));
  r.delete('/', requireRole('student'), wrap(async (req, res) => {
    // Data deletion workflow: removes the student account and all personal records (cascade).
    const id = req.user!.id; await audit(db, id, 'user.delete_self', 'user', id);
    const files = (await q.all<any>(db, 'SELECT file_path FROM materials WHERE user_id=? AND file_path IS NOT NULL', id));
    await tx(db, async () => { await q.run(db, 'DELETE FROM certificates WHERE student_id=?', id); await q.run(db, 'DELETE FROM attempts WHERE student_id=?', id); await q.run(db, 'DELETE FROM users WHERE id=?', id); });
    for (const f of files) await storage().delete(f.file_path).catch(() => { /* best effort; the DB rows are already gone */ });
    res.json({ ok: true });
  }));
  return r;
}
