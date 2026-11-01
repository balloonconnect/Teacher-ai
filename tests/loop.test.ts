import { beforeEach, describe, expect, it } from 'vitest';
import { client, DEMO, setup } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { ctx = await setup(); });
const login = async (email: string) => { const c = client(ctx.app); expect((await c.login(email)).status).toBe(200); return c; };

describe('the learning loop is visible to the right people, from real records', () => {
  it('student result -> revision plan -> parent overview -> teacher class report', async () => {
    const s = await login(DEMO.student);
    const a = (await s.post('/api/tests/test-maths-w6/attempts')).body.attemptId; await s.post(`/api/attempts/${a}/submit`, {});
    const result = (await s.get(`/api/attempts/${a}/result`)).body.result; expect(result.status).toBe('not_passed'); expect(result.certificate).toBeNull();

    const plan = (await s.get('/api/revision-plan')).body; expect(plan.items.length).toBeGreaterThan(0); expect(plan.items[0].lessons.length).toBeGreaterThan(0);
    const dash = (await s.get('/api/dashboard')).body; expect(dash.latestResults[0].status).toBe('not_passed'); expect(dash.revision.length).toBeGreaterThan(0);

    const p = await login(DEMO.parent); const kid = (await p.get('/api/parent/children')).body.children[0];
    const ovr = await p.get(`/api/parent/children/${kid.student_id}/overview`); const ov = ovr.body;
    expect(ov.history[0].status).toBe('not_passed'); expect(ov.recommendations[0]).toMatch(/practising/); expect(ov.report.revisionTopics.length).toBeGreaterThan(0);

    const t = await login(DEMO.teacher); const cls = (await t.get('/api/teacher/classes')).body.classes[0];
    const rep = (await t.get(`/api/teacher/classes/${cls.id}/report`)).body; expect(rep.attempts).toBe(1); expect(rep.passRate).toBe(0); expect(rep.frequentlyMissed.length).toBeGreaterThan(0);
    const res = (await t.get('/api/teacher/tests/test-maths-w6/results')).body; expect(JSON.stringify(res)).toMatch(/not_passed|Not passed/i);
  });
  it('a parent sees only their linked child; teachers and parents cannot read each other\'s areas', async () => {
    const p = await login(DEMO.parent); const arun = (await login(DEMO.arun).then(c => c.get('/api/auth/me'))).body.user.id;
    expect((await p.get(`/api/parent/children/${arun}/overview`)).status).toBe(403);
    expect((await p.get('/api/teacher/classes')).status).toBe(403);
    const t = await login(DEMO.teacher); expect((await t.get('/api/parent/children')).status).toBe(403);
  });
  it('a teacher can only open and edit tests, classes and attempts they own', async () => {
    const t = await login(DEMO.teacher); expect((await t.get('/api/teacher/classes/not-mine/report')).status).toBeGreaterThanOrEqual(403);
    expect((await t.get('/api/teacher/tests/does-not-exist')).status).toBeGreaterThanOrEqual(403);
    const s = await login(DEMO.student); expect((await s.get('/api/teacher/overview')).status).toBe(403); expect((await s.post('/api/teacher/tests', {})).status).toBe(403);
  });
});

describe('bilingual tutor', () => {
  it('detects Tanglish conservatively, answers worked-example and explain-again from the lesson', async () => {
    const { looksTanglish } = await import('../server/services/tutor');
    expect(looksTanglish('indha equation epdi solve panradhu')).toBe(true);
    expect(looksTanglish('What is an equation?')).toBe(false);
    expect(looksTanglish('இது என்ன')).toBe(false);
    const s = await login(DEMO.student);
    const lid = 'c8-maths-linear';
    const conv = (await s.post('/api/tutor/conversations', { lessonId: lid })).body; const cid = conv.conversation?.id ?? conv.id;
    for (const action of ['worked', 'again']) {
      const r = await s.post(`/api/tutor/conversations/${cid}/messages`, { action }); expect(r.status).toBe(200);
      const m = r.body.message ?? r.body.reply ?? r.body; expect(JSON.stringify(m)).toMatch(/example|explain|another way|உதாரண|எடுத்துக்காட்டு/i);
    }
  });
});
