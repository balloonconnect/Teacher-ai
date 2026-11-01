import { beforeEach, describe, expect, it } from 'vitest';
import { client, DEMO, setup } from './helpers';
import { q } from '../server/db';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { ctx = await setup(); });
const base = (o: any = {}) => ({ displayName: 'Test User', email: `u${Math.random().toString(36).slice(2, 8)}@x.com`, password: 'Secret123', consent: true, ...o });
const student = { classLevel: 6, medium: 'Tamil', aiLang: 'both', academicYear: '2026–2027', subjects: ['maths', 'science'], schoolName: 'Test School' };

describe('shared sign-up', () => {
  it('creates a student with a complete profile in one request', async () => {
    const c = client(ctx.app); const r = await c.register(base({ role: 'student', student }));
    expect(r.status).toBe(201); expect(r.body.needsProfile).toBe(false);
    const me = (await c.get('/api/auth/me')).body; expect(me.profile.class_level).toBe(6); expect(me.profile.medium).toBe('Tamil'); expect(me.profile.guardian_approved).toBe(1);
  });
  it('requires guardian details for under-13 students and withholds approval', async () => {
    const c = client(ctx.app);
    expect((await c.register(base({ role: 'student', student, under13: true }))).status).toBe(400);
    const r = await c.register(base({ role: 'student', student, under13: true, guardianName: 'Parent', guardianEmail: 'parent@x.com' }));
    expect(r.status).toBe(201); expect((await c.get('/api/auth/me')).body.profile.guardian_approved).toBe(0);
  });
  it('validates class range and required student fields', async () => {
    const c = client(ctx.app);
    expect((await c.register(base({ role: 'student', student: { ...student, classLevel: 13 } }))).status).toBe(400);
    expect((await c.register(base({ role: 'student', student: { ...student, subjects: [] } }))).status).toBe(400);
  });
  it('never lets a browser choose the platform admin role', async () => {
    const c = client(ctx.app);
    expect((await c.register(base({ role: 'admin' }))).status).toBe(400);
    expect((await c.register(base({ role: 'platform_admin' }))).status).toBe(400);
  });
  it('makes teacher and school-admin sign-ups pending until an admin approves', async () => {
    const t = client(ctx.app); const email = 'newteacher@x.com';
    const r = await t.register(base({ email, role: 'teacher', staff: { schoolName: 'Some School', subjects: ['maths'], classes: [6, 7] } }));
    expect(r.status).toBe(201); expect(r.body.user.role).toBe('pending'); expect(r.body.pendingApproval).toBe(true);
    expect((await t.get('/api/teacher/classes')).status).toBe(403);
    expect((await t.get('/api/admin/stats')).status).toBe(403);
    const a = client(ctx.app); await a.login(DEMO.admin);
    const list = (await a.get('/api/admin/role-requests')).body.requests; const mine = list.find((x: any) => x.email === email);
    expect(mine.requested).toBe('teacher'); expect(mine.schoolName).toBe('Some School');
    expect((await a.patch(`/api/admin/users/${mine.userId}`, { role: 'teacher' })).status).toBe(200);
    expect((await t.get('/api/teacher/classes')).status).toBe(200);
    expect((await a.get('/api/admin/role-requests')).body.requests.find((x: any) => x.email === email)).toBeUndefined();
  });
  it('requires an institution email and details for school admins and teachers', async () => {
    const c = client(ctx.app);
    expect((await c.register(base({ role: 'school_admin', staff: { schoolName: 'S School' } }))).status).toBe(400);
    expect((await c.register(base({ role: 'teacher', staff: { schoolName: 'S School' } }))).status).toBe(400);
    expect((await c.register(base({ role: 'school_admin', staff: { schoolName: 'S School', institutionEmail: 'head@school.edu' } }))).body.pendingApproval).toBe(true);
  });
  it('links a parent to a student with a valid code and rejects bad codes', async () => {
    const s = client(ctx.app); await s.login(DEMO.student); const code = (await s.post('/api/profile/guardian-code')).body.code;
    const bad = client(ctx.app); expect((await bad.register(base({ role: 'parent', parent: { linkCode: 'ZZZZZZ' } }))).status).toBe(422);
    const p = client(ctx.app); const r = await p.register(base({ role: 'parent', parent: { relationship: 'mother', linkCode: code } }));
    expect(r.status).toBe(201); expect((await p.get('/api/parent/children')).body.children?.length ?? (await p.get('/api/parent/children')).body.students?.length).toBeGreaterThan(0);
    const later = client(ctx.app); expect((await later.register(base({ role: 'parent' }))).status).toBe(201);
    expect((await q.get<any>(ctx.db, "SELECT COUNT(*) n FROM users WHERE email LIKE '%@x.com' AND password_hash LIKE '%Secret123%'"))!.n).toBe(0);
  });
});
