import { q as dq } from '../server/db';
import { describe, it, expect, beforeAll } from 'vitest';
import { setup, client, DEMO, profileBody } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => { ctx = await setup(); }, 60000);

describe('registration & profile', () => {
  it('rejects registration without consent and weak passwords', async () => {
    const c = client(ctx.app);
    expect((await c.register({ displayName: 'A', email: 'a@x.com', password: 'Abcdefg1', consent: false })).status).toBe(400);
    expect((await c.register({ displayName: 'A', email: 'a@x.com', password: 'short', consent: true })).status).toBe(400);
  });
  it('registers, never stores plain-text passwords, blocks duplicates', async () => {
    const c = client(ctx.app);
    const r = await c.register({ displayName: 'Ravi', email: 'ravi@x.com', password: 'Secret123', consent: true });
    expect(r.status).toBe(201); expect(r.body.needsProfile).toBe(true);
    const row: any = (await dq.get(ctx.db, 'SELECT password_hash FROM users WHERE email=?', 'ravi@x.com'));
    expect(row.password_hash).not.toContain('Secret123');
    expect((await client(ctx.app).register({ displayName: 'R', email: 'ravi@x.com', password: 'Secret123', consent: true })).status).toBe(409);
  });
  it('blocks tests until the profile is complete, then allows them', async () => {
    const c = client(ctx.app); await c.register({ displayName: 'Sita', email: 'sita@x.com', password: 'Secret123', consent: true });
    expect((await c.get('/api/tests')).status).toBe(409);
    expect((await c.put('/api/profile', profileBody({ fullName: 'S' }))).status).toBe(400);
    expect((await c.put('/api/profile', profileBody({ fullName: 'Sita Devi' }))).status).toBe(200);
    const t = await c.get('/api/tests'); expect(t.status).toBe(200); expect(t.body.tests.length).toBeGreaterThan(0);
  });
  it('requires a CSRF token on state-changing requests', async () => {
    const c = client(ctx.app); await c.register({ displayName: 'Z', email: 'z@x.com', password: 'Secret123', consent: true });
    expect((await c.agent.put('/api/profile').send(profileBody())).status).toBe(403);
  });
});

describe('priority flow: profile → test → result → certificate → verify', () => {
  it('runs the whole journey', async () => {
    const c = client(ctx.app); await c.register({ displayName: 'Kavin', email: 'kavin@x.com', password: 'Secret123', consent: true });
    await c.put('/api/profile', profileBody({ fullName: 'Kavin Raj' }));
    const lessons = await c.get('/api/curriculum'); expect(lessons.status).toBe(200);
    const test = (await c.get('/api/tests')).body.tests.find((t: any) => t.id === 'test-maths-w6'); expect(test.status).toBe('Available');
    const a = await c.post('/api/tests/test-maths-w6/attempts'); expect(a.status).toBe(201);
    const again = await c.post('/api/tests/test-maths-w6/attempts'); expect(again.body.attemptId).toBe(a.body.attemptId);
    const att = (await c.get(`/api/attempts/${a.body.attemptId}`)).body.attempt;
    expect(JSON.stringify(att)).not.toMatch(/"accept"|"rubric"|explanation/);
    const key: any = {}; for (const q of att.questions) { const k: any = (await dq.get(ctx.db, 'SELECT answer FROM questions WHERE id=?', q.id)); key[q.id] = JSON.parse(k.answer); }
    const items = att.questions.map((q: any) => ({ questionId: q.id, answer: q.type === 'mcq' || q.type === 'tf' ? key[q.id] : q.type === 'numeric' ? String(key[q.id].value) : key[q.id].accept?.[0] }));
    const s = await c.post(`/api/attempts/${a.body.attemptId}/submit`, { items }); expect(s.status).toBe(200);
    const s2 = await c.post(`/api/attempts/${a.body.attemptId}/submit`, {}); expect(s2.status).toBe(200);
    const res = (await c.get(`/api/attempts/${a.body.attemptId}/result`)).body.result;
    expect(res.status).toBe('passed'); expect(res.pct).toBe(100); expect(res.certificate).toBeTruthy();
    const certs = (await c.get('/api/certificates')).body.certificates; expect(certs.length).toBe(1);
    const pdf = await c.get(`/api/certificates/${certs[0].id}/pdf`).buffer(true).parse((r, cb) => { const d: Buffer[] = []; r.on('data', x => d.push(x)); r.on('end', () => cb(null, Buffer.concat(d))); });
    expect(pdf.headers['content-type']).toContain('application/pdf'); expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    const v = await client(ctx.app).get(`/api/verify/${certs[0].token}`); expect(v.body.found).toBe(true); expect(v.body.status).toBe('valid');
    expect(JSON.stringify(v.body)).not.toContain('kavin@x.com'); expect(JSON.stringify(v.body)).not.toContain('Kavin Raj');
    expect((await client(ctx.app).get('/api/verify/doesnotexist1234567')).status).toBe(404);
  });
  it('does not issue duplicate certificates and enforces attempt limits', async () => {
    const c = client(ctx.app); await c.login(DEMO.arun);
    const a = await c.post('/api/tests/test-maths-w6/attempts'); const id = a.body.attemptId;
    await c.post(`/api/attempts/${id}/submit`, {});
    const r = (await c.get(`/api/attempts/${id}/result`)).body.result; expect(r.status).toBe('not_passed'); expect(r.certificate).toBeNull(); expect(r.retake.allowed).toBe(true);
    const b = await c.post('/api/tests/test-maths-w6/attempts'); expect(b.status).toBe(201); expect(b.body.attemptId).not.toBe(id);
    await c.post(`/api/attempts/${b.body.attemptId}/submit`, {});
    expect((await c.post('/api/tests/test-maths-w6/attempts')).status).toBe(409);
  });
  it('refuses an expired/future test', async () => {
    const c = client(ctx.app); await c.login(DEMO.arun);
    expect((await c.post('/api/tests/test-social-w8/attempts')).status).toBe(409);
    expect((await c.post('/api/tests/test-science-w5/attempts')).status).toBe(409);
  });
});

describe('RBAC & tenant isolation', () => {
  it('blocks cross-student access', async () => {
    const meena = client(ctx.app); await meena.login(DEMO.student);
    const arun = client(ctx.app); await arun.login(DEMO.arun);
    const a = await meena.post('/api/tests/test-science-w6/attempts'); await meena.post(`/api/attempts/${a.body.attemptId}/submit`, {});
    expect((await arun.get(`/api/attempts/${a.body.attemptId}/result`)).status).toBe(404);
    expect((await arun.get(`/api/attempts/${a.body.attemptId}/review`)).status).toBe(404);
    expect((await arun.get(`/api/attempts/${a.body.attemptId}`)).status).toBeGreaterThanOrEqual(403);
  });
  it('enforces roles on the server', async () => {
    const s = client(ctx.app); await s.login(DEMO.student);
    expect((await s.get('/api/admin/stats')).status).toBe(403);
    expect((await s.get('/api/teacher/classes')).status).toBe(403);
    expect((await client(ctx.app).get('/api/tests')).status).toBe(401);
    const t = client(ctx.app); await t.login(DEMO.teacher); expect((await t.get('/api/admin/users')).status).toBe(403);
    const a = client(ctx.app); await a.login(DEMO.admin); expect((await a.get('/api/admin/stats')).status).toBe(200);
  });
  it('parents only see linked children', async () => {
    const p = client(ctx.app); await p.login(DEMO.parent);
    const kids = (await p.get('/api/parent/children')).body.children; expect(kids.length).toBe(1);
    const arun: any = (await dq.get(ctx.db, "SELECT id FROM users WHERE email=?", DEMO.arun));
    expect((await p.get(`/api/parent/children/${arun.id}/overview`)).status).toBe(403);
  });
  it('rejects wrong password with a generic message', async () => {
    const r = await client(ctx.app).login(DEMO.student, 'nope12345'); expect(r.status).toBe(401); expect(r.body.error).not.toMatch(/stack|sqlite/i);
  });
});

describe('manual review, revocation', () => {
  it('holds a written-answer test as pending_review, then finalises on teacher marking and revokes on correction', async () => {
    const c = client(ctx.app); await c.login(DEMO.student);
    const a = (await c.post('/api/tests/test-maths-w7/attempts')).body.attemptId;
    const att = (await c.get(`/api/attempts/${a}`)).body.attempt;
    const items = await Promise.all(att.questions.map(async (q: any) => { const k: any = JSON.parse((await dq.get(ctx.db, 'SELECT answer FROM questions WHERE id=?', q.id) as any).answer); return { questionId: q.id, answer: q.type === 'short' ? 'Let x be the number. 2x+3=17 so x=7' : q.type === 'mcq' || q.type === 'tf' ? k : q.type === 'numeric' ? String(k.value) : k.accept[0] }; }));
    await c.post(`/api/attempts/${a}/submit`, { items });
    let res = (await c.get(`/api/attempts/${a}/result`)).body.result; expect(res.status).toBe('pending_review'); expect(res.certificate).toBeNull();
    const t = client(ctx.app); await t.login(DEMO.teacher);
    expect((await t.get('/api/teacher/reviews')).body.reviews.some((r: any) => r.id === a)).toBe(true);
    const detail = (await t.get(`/api/teacher/attempts/${a}`)).body; const sh = detail.questions.find((q: any) => q.type === 'short');
    expect((await t.post(`/api/teacher/attempts/${a}/grade`, { grades: [{ questionId: sh.id, marks: sh.max }] })).status).toBe(200);
    res = (await c.get(`/api/attempts/${a}/result`)).body.result; expect(res.status).toBe('passed'); expect(res.certificate).toBeTruthy();
    expect((await t.post(`/api/teacher/attempts/${a}/correct`, { grades: [{ questionId: sh.id, marks: 0 }] })).status).toBe(400);
    const cor = await t.post(`/api/teacher/attempts/${a}/correct`, { grades: [{ questionId: sh.id, marks: 0 }], reason: 'Marking error found' }); expect(cor.status).toBe(200);
    // Still a pass (other answers were right) so the certificate stays valid until staff reissue it with corrected marks.
    let certs = (await c.get('/api/certificates')).body.certificates; const old = certs.find((x: any) => x.attempt_id === a && x.status === 'valid'); expect(old).toBeTruthy();
    expect(old.snapshot.marks).toBe(50);
    expect((await t.post(`/api/certificates/${old.id}/reissue`, { reason: 'x' })).status).toBe(400);
    expect((await t.post(`/api/certificates/${old.id}/reissue`, { reason: 'Marks corrected after review' })).status).toBe(200);
    certs = (await c.get('/api/certificates')).body.certificates;
    expect(certs.find((x: any) => x.id === old.id).status).toBe('superseded'); const fresh = certs.find((x: any) => x.attempt_id === a && x.status === 'valid'); expect(fresh.id).not.toBe(old.id); expect(fresh.snapshot.marks).toBeLessThan(50);
    expect((await client(ctx.app).get(`/api/verify/${old.token}`)).body.status).toBe('superseded');
    // Revoking requires a reason and removes validity
    expect((await t.post(`/api/certificates/${fresh.id}/revoke`, { reason: 'ab' })).status).toBe(400);
    expect((await t.post(`/api/certificates/${fresh.id}/revoke`, { reason: 'Issued in error' })).status).toBe(200);
    expect((await client(ctx.app).get(`/api/verify/${fresh.token}`)).body.status).toBe('revoked');
    expect(JSON.stringify((await client(ctx.app).get(`/api/verify/${fresh.token}`)).body)).not.toMatch(/Test Student|Meena/);
  });
  it('revoke requires a reason and a staff role', async () => {
    const c = client(ctx.app); await c.login(DEMO.student);
    const certId = (await dq.get(ctx.db, "SELECT id FROM certificates LIMIT 1") as any)?.id; if (!certId) return;
    expect((await c.post(`/api/certificates/${certId}/revoke`, { reason: 'x' })).status).toBe(403);
  });
});
