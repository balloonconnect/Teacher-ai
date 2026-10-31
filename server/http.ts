import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, ZodError } from 'zod';
import { DB, q } from './db';
import type { AuthUser } from './security';
import { HttpError } from './services/tests';

export const wrap = (fn: (req: Request, res: Response) => unknown | Promise<unknown>): RequestHandler => async (req, res, next) => { await Promise.resolve(fn(req, res)).catch(next); };
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data); if (!r.success) throw new HttpError(400, r.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
  return r.data;
}
/** Sanitised error handler: never leaks stack traces, SQL or provider details. */
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
  if (err instanceof ZodError) return void res.status(400).json({ error: 'Invalid input.' });
  if (err?.type === 'entity.too.large') return void res.status(413).json({ error: 'Request is too large.' });
  if (err?.code === 'LIMIT_FILE_SIZE') return void res.status(413).json({ error: 'File is larger than 10 MB.' });
  if (err?.name === 'UrlError') return void res.status(422).json({ error: err.message });
  console.error('[error]', req.method, req.path, err?.message);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
}
/** Who may see a student's data. Enforced on the server for every student-scoped endpoint. */
export async function canAccessStudent(db: DB, user: AuthUser, studentId: string): Promise<boolean> {
  if (user.id === studentId) return true;
  if (user.role === 'admin') return true;
  const stu = (await q.get<any>(db, 'SELECT school_id FROM users WHERE id=? AND role=\'student\'', studentId)); if (!stu) return false;
  if (user.role === 'parent') return !!(await q.get(db, 'SELECT 1 FROM guardian_links WHERE parent_id=? AND student_id=?', user.id, studentId));
  if (user.role === 'teacher') return !!(await q.get(db, 'SELECT 1 FROM enrolments e JOIN classes c ON c.id=e.class_id WHERE e.student_id=? AND c.teacher_id=?', studentId, user.id));
  if (user.role === 'school_admin') return !!user.school_id && stu.school_id === user.school_id;
  return false;
}
export const J = (s: string) => JSON.parse(s);
export const userFilter = (u: AuthUser) => u;
