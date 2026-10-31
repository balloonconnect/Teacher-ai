import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { client, DEMO, setup } from './helpers';
import { q } from '../server/db';
import { type Mail, setMailer } from '../server/services/mailer';

let ctx: Awaited<ReturnType<typeof setup>>; const sent: Mail[] = [];
beforeEach(async () => { sent.length = 0; setMailer(undefined); ctx = await setup(); });
afterAll(() => setMailer(undefined));
const staff = { schoolName: 'Some School', subjects: ['maths'], classes: [6] };
const signup = async (email: string, role = 'teacher') => { const c = client(ctx.app); const r = await c.register({ displayName: 'New Staff', email, password: 'Secret123', consent: true, role, staff: role === 'school_admin' ? { ...staff, institutionEmail: 'office@school.in' } : staff }); expect(r.status).toBe(201); return { c, id: r.body.user.id as string }; };
const admin = async () => { const a = client(ctx.app); await a.login(DEMO.admin); return a; };

describe('admin: staff approval', () => {
  it('approving gives the role they asked for, can set the school, and notifies them', async () => {
    const { c, id } = await signup('t1@school.in'); const a = await admin();
    const school = (await a.post('/api/admin/schools', { name: 'Greenfield School' })).body.id;
    expect((await a.post(`/api/admin/role-requests/${id}/decide`, { decision: 'approve', schoolId: school })).body).toMatchObject({ ok: true, role: 'teacher' });
    expect((await c.get('/api/teacher/classes')).status).toBe(200);
    expect((await q.get<any>(ctx.db, 'SELECT school_id FROM users WHERE id=?', id))!.school_id).toBe(school);
    expect((await a.get('/api/admin/role-requests')).body.requests).toHaveLength(0);
    expect(JSON.parse((await q.get<any>(ctx.db, 'SELECT value FROM settings WHERE key=?', `rolereq:${id}`))!.value).status).toBe('approved');
    expect((await q.get<any>(ctx.db, "SELECT COUNT(*) n FROM notifications WHERE user_id=? AND title LIKE 'Your account was approved'", id))!.n).toBe(1);
    expect((await q.get<any>(ctx.db, "SELECT COUNT(*) n FROM audit WHERE action='role.approved'"))!.n).toBe(1);
  });
  it('a school-admin request gets the school_admin role', async () => {
    const { id } = await signup('s1@school.in', 'school_admin'); const a = await admin(); const r = await a.post(`/api/admin/role-requests/${id}/decide`, { decision: 'approve' }); expect(r.body.role).toBe('school_admin');
  });
  it('declining switches the account off and removes it from the waiting list', async () => {
    const { c, id } = await signup('t2@school.in'); const a = await admin();
    expect((await a.post(`/api/admin/role-requests/${id}/decide`, { decision: 'decline' })).status).toBe(200);
    expect((await c.get('/api/auth/me')).body.user).toBeNull(); expect((await client(ctx.app).login('t2@school.in', 'Secret123')).status).toBe(401);
    expect((await a.get('/api/admin/role-requests')).body.requests).toHaveLength(0);
  });
  it('cannot be decided twice, for ordinary users, or by non-admins; an unknown school is refused', async () => {
    const { id } = await signup('t3@school.in'); const a = await admin();
    expect((await a.post(`/api/admin/role-requests/${id}/decide`, { decision: 'approve', schoolId: 'nope' })).status).toBe(400);
    expect((await a.post(`/api/admin/role-requests/${id}/decide`, { decision: 'approve' })).status).toBe(200);
    expect((await a.post(`/api/admin/role-requests/${id}/decide`, { decision: 'decline' })).status).toBe(404);
    const stu = await q.get<any>(ctx.db, "SELECT id FROM users WHERE role='student' LIMIT 1"); expect((await a.post(`/api/admin/role-requests/${stu!.id}/decide`, { decision: 'approve' })).status).toBe(404);
    const t = client(ctx.app); await t.login(DEMO.teacher); expect((await t.post(`/api/admin/role-requests/${id}/decide`, { decision: 'approve' })).status).toBe(403);
  });
});

describe('admin: help someone locked out', () => {
  const victim = async () => { const { c, id } = await signup('lost@school.in'); const a = await admin(); await a.post(`/api/admin/role-requests/${id}/decide`, { decision: 'approve' }); return { c, id, a }; };
  it('a temporary password works once, signs the person out everywhere, and is audited without being stored', async () => {
    const { c, id, a } = await victim(); const r = await a.post(`/api/admin/users/${id}/reset-password`, { mode: 'temp' }); expect(r.status).toBe(200);
    const temp = r.body.temporaryPassword as string; expect(temp.length).toBeGreaterThanOrEqual(10); expect(/[A-Za-z]/.test(temp) && /\d/.test(temp)).toBe(true);
    expect((await c.get('/api/auth/me')).body.user).toBeNull(); expect((await client(ctx.app).login('lost@school.in', 'Secret123')).status).toBe(401); expect((await client(ctx.app).login('lost@school.in', temp)).status).toBe(200);
    const au = await q.all<any>(ctx.db, "SELECT details FROM audit WHERE action='user.temp_password'"); expect(au).toHaveLength(1); expect(au[0].details).not.toContain(temp);
  });
  it('email mode sends a reset link when mail is set up, and says so plainly when it is not', async () => {
    const { id, a } = await victim(); const off = await a.post(`/api/admin/users/${id}/reset-password`, { mode: 'email' }); expect(off.status).toBe(400); expect(off.body.error).toMatch(/not set up/);
    process.env.PUBLIC_URL = 'https://kalvi.example.in'; setMailer({ name: 'capture', async send(m) { sent.push(m); } });
    expect((await a.post(`/api/admin/users/${id}/reset-password`, { mode: 'email' })).body).toEqual({ ok: true, sent: true }); expect(sent[0].to).toBe('lost@school.in'); expect(sent[0].text).toContain('https://kalvi.example.in/reset-password?token=');
    setMailer({ name: 'down', async send() { throw new Error('down'); } }); expect((await a.post(`/api/admin/users/${id}/reset-password`, { mode: 'email' })).status).toBe(502);
  });
  it('refuses demo, switched-off and unknown accounts, and non-admins', async () => {
    const { id, a } = await victim(); const demo = await q.get<any>(ctx.db, 'SELECT id FROM users WHERE is_demo=1 LIMIT 1');
    expect((await a.post(`/api/admin/users/${demo!.id}/reset-password`, { mode: 'temp' })).status).toBe(400); expect((await a.post('/api/admin/users/none/reset-password', { mode: 'temp' })).status).toBe(404);
    await a.patch(`/api/admin/users/${id}`, { disabled: true }); expect((await a.post(`/api/admin/users/${id}/reset-password`, { mode: 'temp' })).status).toBe(400);
    const t = client(ctx.app); await t.login(DEMO.teacher); expect((await t.post(`/api/admin/users/${id}/reset-password`, { mode: 'temp' })).status).toBe(403);
  });
  it('the user list can be searched by name or email', async () => {
    await signup('findme@school.in'); const a = await admin(); const r = await a.get('/api/admin/users?q=FINDME'); expect(r.body.users.map((u: any) => u.email)).toEqual(['findme@school.in']);
  });
});
