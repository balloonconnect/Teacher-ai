import { q as dq } from '../server/db';
import { describe, it, expect, beforeEach } from 'vitest';
import { setup, client, DEMO } from './helpers';
import { clock } from '../server/clock';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { ctx = await setup(); }, 60000);

describe('server-authoritative timing', () => {
  it('rejects saves after the deadline, auto-settles with saved answers, and never grants extra time', async () => {
    const c = client(ctx.app); await c.login(DEMO.student);
    const id = (await c.post('/api/tests/test-maths-w6/attempts')).body.attemptId;
    const a = (await c.get(`/api/attempts/${id}`)).body.attempt; const first = a.questions[0];
    const key: any = JSON.parse((await dq.get(ctx.db, 'SELECT answer FROM questions WHERE id=?', first.id) as any).answer);
    expect((await c.put(`/api/attempts/${id}/answers`, { items: [{ questionId: first.id, answer: key }] })).status).toBe(200);
    clock.advance(46 * 60 * 1000); // 45-minute test, 46 minutes later (beyond the 15 s grace)
    expect((await c.put(`/api/attempts/${id}/answers`, { items: [{ questionId: a.questions[1].id, answer: 0 }] })).status).toBe(409);
    const res = await c.get(`/api/attempts/${id}`); expect(res.body.attempt.status).not.toBe('in_progress');
    const r = (await c.get(`/api/attempts/${id}/result`)).body.result; expect(r.finalised).toBe(true); expect(r.marks).toBe(6); // only the one saved answer counts
    expect((await c.post(`/api/attempts/${id}/submit`, { items: [{ questionId: a.questions[2].id, answer: 1 }] })).status).toBe(200); // idempotent, no changes
    expect((await c.get(`/api/attempts/${id}/result`)).body.result.marks).toBe(6);
  });
  it('closes the test for new attempts after closes_at and shows it as expired', async () => {
    const c = client(ctx.app); await c.login(DEMO.arun);
    clock.advance(6 * 864e5);
    expect((await c.post('/api/tests/test-maths-w6/attempts')).status).toBe(409);
    expect((await c.get('/api/tests')).body.tests.find((t: any) => t.id === 'test-maths-w6').status).toBe('Expired');
  });
  it('hides answer review when the test rule says so', async () => {
    const c = client(ctx.app); await c.login(DEMO.arun);
    await dq.run(ctx.db, "UPDATE tests SET show_review=2 WHERE id='test-maths-w6'");
    const id = (await c.post('/api/tests/test-maths-w6/attempts')).body.attemptId; await c.post(`/api/attempts/${id}/submit`, {});
    expect((await c.get(`/api/attempts/${id}/review`)).status).toBe(403);
    clock.advance(6 * 864e5); expect((await c.get(`/api/attempts/${id}/review`)).status).toBe(200);
  });
  it('does not let teachers publish a test with unreviewed AI drafts, and does not expose draft tests to students', async () => {
    const t = client(ctx.app); await t.login(DEMO.teacher);
    await t.post('/api/teacher/questions/drafts', { subjectId: 'maths', classLevel: 8, count: 1 });
    const draft = (await t.get('/api/teacher/questions?status=draft')).body.questions[0];
    const body = { title: 'Draft test', classLevel: 8, subjectId: 'maths', academicYear: '2026–2027', topics: [], opensAt: new Date(clock.now().getTime() - 1000).toISOString(), closesAt: new Date(clock.now().getTime() + 864e5).toISOString(), durationMin: 10, passPct: 40, maxAttempts: 1, questions: [{ questionId: draft.id, marks: 1 }] };
    const made = await t.post('/api/teacher/tests', body); expect(made.status).toBe(201);
    expect((await t.post(`/api/teacher/tests/${made.body.id}/publish`)).status).toBe(409);
    await t.post(`/api/teacher/questions/${draft.id}/publish`); expect((await t.post(`/api/teacher/tests/${made.body.id}/publish`)).status).toBe(200);
    const s = client(ctx.app); await s.login(DEMO.student); expect((await s.get('/api/tests')).body.tests.some((x: any) => x.title === 'Draft test')).toBe(true);
    await t.post(`/api/teacher/tests/${made.body.id}/unpublish`); expect((await s.get('/api/tests')).body.tests.some((x: any) => x.title === 'Draft test')).toBe(false);
  });
});
