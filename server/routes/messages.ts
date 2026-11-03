import { Router } from 'express';
import { z } from 'zod';
import { DB, q } from '../db';
import { requireRole, uid } from '../security';
import { iso } from '../clock';
import { parse, wrap } from '../http';
import { HttpError } from '../services/tests';

/**
 * Messages between a parent and a teacher who teaches one of the parent's linked children.
 * Nobody can message anyone outside that relationship: every call re-derives the allowed contacts from the database.
 */
export function messageRoutes(db: DB) {
  const r = Router(); r.use(requireRole('parent', 'teacher'));

  /** People this user may message, with the child and class that connects them. */
  async function contacts(userId: string, role: string) {
    return role === 'parent'
      ? q.all<any>(db, `SELECT DISTINCT u.id, u.display_name name, p.full_name child, c.name class_name
          FROM guardian_links g JOIN enrolments e ON e.student_id=g.student_id JOIN classes c ON c.id=e.class_id
          JOIN users u ON u.id=c.teacher_id AND u.disabled=0 JOIN student_profiles p ON p.user_id=g.student_id WHERE g.parent_id=?`, userId)
      : q.all<any>(db, `SELECT DISTINCT u.id, u.display_name name, p.full_name child, c.name class_name
          FROM classes c JOIN enrolments e ON e.class_id=c.id JOIN guardian_links g ON g.student_id=e.student_id
          JOIN users u ON u.id=g.parent_id AND u.disabled=0 JOIN student_profiles p ON p.user_id=e.student_id WHERE c.teacher_id=?`, userId);
  }
  const allowed = async (req: any, otherId: string) => {
    const c = await contacts(req.user!.id, req.user!.role);
    if (!c.some(x => x.id === otherId)) throw new HttpError(403, 'You can only message the parent or teacher linked to your child’s class.');
    return c;
  };

  r.get('/contacts', wrap(async (req, res) => {
    const c = await contacts(req.user!.id, req.user!.role);
    const merged = new Map<string, any>();
    for (const x of c) { const m = merged.get(x.id); if (m) m.children.push({ child: x.child, class_name: x.class_name }); else merged.set(x.id, { id: x.id, name: x.name, children: [{ child: x.child, class_name: x.class_name }] }); }
    const out = await Promise.all([...merged.values()].map(async m => {
      const last = await q.get<any>(db, 'SELECT body, created_at FROM parent_teacher_messages WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY created_at DESC LIMIT 1', req.user!.id, m.id, m.id, req.user!.id);
      const unread = (await q.get<any>(db, 'SELECT COUNT(*) n FROM parent_teacher_messages WHERE from_id=? AND to_id=? AND read_at IS NULL', m.id, req.user!.id))!.n;
      return { ...m, last: last ?? null, unread: Number(unread) };
    }));
    res.json({ contacts: out.sort((a, b) => String(b.last?.created_at ?? '').localeCompare(String(a.last?.created_at ?? ''))) });
  }));

  r.get('/thread/:id', wrap(async (req, res) => {
    await allowed(req, req.params.id);
    const messages = await q.all<any>(db, 'SELECT id, from_id, body, created_at FROM parent_teacher_messages WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY created_at ASC LIMIT 200', req.user!.id, req.params.id, req.params.id, req.user!.id);
    await q.run(db, 'UPDATE parent_teacher_messages SET read_at=? WHERE from_id=? AND to_id=? AND read_at IS NULL', iso(), req.params.id, req.user!.id);
    res.json({ messages: messages.map(m => ({ id: m.id, mine: m.from_id === req.user!.id, body: m.body, created_at: m.created_at })) });
  }));

  r.post('/thread/:id', wrap(async (req, res) => {
    const b = parse(z.object({ body: z.string().trim().min(1, 'Write a message first.').max(1000, 'Keep a message under 1000 characters.') }), req.body);
    await allowed(req, req.params.id);
    const recent = (await q.get<any>(db, 'SELECT COUNT(*) n FROM parent_teacher_messages WHERE from_id=? AND created_at > ?', req.user!.id, new Date(Date.now() - 60_000).toISOString()))!.n;
    if (Number(recent) >= 10) throw new HttpError(429, 'You are sending messages too fast. Wait a minute and try again.');
    const id = uid(), at = iso();
    await q.run(db, 'INSERT INTO parent_teacher_messages(id,from_id,to_id,body,created_at) VALUES (?,?,?,?,?)', id, req.user!.id, req.params.id, b.body, at);
    await q.run(db, 'INSERT INTO notifications(id,user_id,title,body,created_at) VALUES (?,?,?,?,?)', uid(), req.params.id, 'New message', `${req.user!.display_name} sent you a message.`, at);
    res.status(201).json({ id });
  }));
  return r;
}
