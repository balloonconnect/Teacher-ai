import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { client, DEMO, setup } from './helpers';
import { q as dq } from '../server/db';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { ctx = await setup(); });
const login = async (email: string) => { const c = client(ctx.app); expect((await c.login(email)).status).toBe(200); return c; };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c60000000049454e44ae426082', 'hex');

describe('server-side permissions and privacy', () => {
  it('requires sign-in for protected endpoints', async () => {
    const c = client(ctx.app);
    for (const u of ['/api/dashboard', '/api/materials', '/api/tutor/conversations', '/api/certificates', '/api/revision-plan']) expect([401, 403]).toContain((await c.get(u)).status);
  });
  it('one student cannot read another student\'s materials or conversations', async () => {
    const a = await login(DEMO.student); const b = await login(DEMO.arun);
    const conv = await a.post('/api/tutor/conversations', {}); const cid = conv.body.conversation?.id ?? conv.body.id; expect(cid).toBeTruthy();
    expect((await b.get(`/api/tutor/conversations/${cid}/messages`)).status).toBeGreaterThanOrEqual(403);
    expect((await b.del(`/api/tutor/conversations/${cid}`)).status).toBeGreaterThanOrEqual(403);
    const uid = (await a.get('/api/auth/me')).body.user.id; const mid = 'mat-secret-1';
    await dq.run(ctx.db, "INSERT INTO materials(id,user_id,kind,name,mime,size,file_path,text,pages,status,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", mid, uid, 'pdf', 'private.pdf', 'application/pdf', 1, null, 'secret', '[]', 'ready', null, new Date().toISOString());
    expect((await a.get(`/api/materials/${mid}`)).status).toBe(200);
    expect((await b.get(`/api/materials/${mid}`)).status).toBeGreaterThanOrEqual(403);
    expect((await b.del(`/api/materials/${mid}`)).status).toBeGreaterThanOrEqual(403);
    expect(JSON.stringify((await b.get('/api/materials')).body)).not.toContain(mid);
  });
  it('one student cannot read or submit another student\'s test attempt, or their certificates', async () => {
    const a = await login(DEMO.student); const b = await login(DEMO.arun);
    const att = (await a.post('/api/tests/test-maths-w6/attempts')).body.attemptId; expect(att).toBeTruthy();
    for (const r of [await b.get(`/api/attempts/${att}/result`), await b.post(`/api/attempts/${att}/submit`, {}), await b.get(`/api/attempts/${att}`)]) expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await b.get('/api/certificates/not-mine/pdf')).status).toBeGreaterThanOrEqual(403);
  });
  it('does not expose correct answers while a test attempt is in progress', async () => {
    const a = await login(DEMO.student); const att = (await a.post('/api/tests/test-maths-w6/attempts')).body.attemptId;
    const body = JSON.stringify((await a.get(`/api/attempts/${att}`)).body);
    expect(body).not.toMatch(/correctAnswer|correct_answer|"explanation/);
  });
});

describe('uploads and scoring', () => {
  it('rejects files whose content does not match the claimed type', async () => {
    const c = await login(DEMO.student);
    const csrf = (await c.get('/api/auth/me')).body.csrf;
    const bad = await c.agent.post('/api/materials/upload').set('x-csrf-token', csrf ?? '').field('kind', 'image').attach('file', Buffer.from('<script>alert(1)</script>'), 'x.png');
    expect(bad.status).toBe(415);
    const pdfAsImage = await c.agent.post('/api/materials/upload').set('x-csrf-token', csrf ?? '').field('kind', 'pdf').attach('file', PNG, 'x.pdf');
    expect(pdfAsImage.status).toBe(415);
  });
  it('scoring is server-side and submitting twice does not change the result', async () => {
    const s = await login(DEMO.student); const a = (await s.post('/api/tests/test-maths-w6/attempts')).body.attemptId;
    await s.post(`/api/attempts/${a}/submit`, {}); const r1 = (await s.get(`/api/attempts/${a}/result`)).body.result;
    await s.post(`/api/attempts/${a}/submit`, {}); const r2 = (await s.get(`/api/attempts/${a}/result`)).body.result;
    expect(r2.score).toBe(r1.score); expect(r1.status).toBe('not_passed');
    // a client cannot dictate its own score
    const forged = await s.post(`/api/attempts/${a}/submit`, { score: 100, status: 'passed' }); expect(forged.status).toBeLessThan(500);
    expect((await s.get(`/api/attempts/${a}/result`)).body.result.status).toBe('not_passed');
  });
  it('no certificate is issued for a failed attempt, and none can be requested directly', async () => {
    const s = await login(DEMO.student); const a = (await s.post('/api/tests/test-maths-w6/attempts')).body.attemptId; await s.post(`/api/attempts/${a}/submit`, {});
    const n = Number(((await dq.get(ctx.db, 'SELECT COUNT(*) c FROM certificates WHERE attempt_id=?', a)) as any).c); expect(n).toBe(0);
    expect((await s.post('/api/certificates', {})).status).toBeGreaterThanOrEqual(400);
  });
});

describe('secrets', () => {
  it('the production client bundle contains no API keys or server-only variables', () => {
    const dir = join(process.cwd(), 'dist'); if (!existsSync(dir)) return;
    const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
    for (const f of walk(dir).filter(f => /\.(js|html|css|json)$/.test(f))) { const t = readFileSync(f, 'utf8'); expect(t, f).not.toMatch(/sk-ant-|ANTHROPIC_API_KEY|SESSION_SECRET/); }
  });
});
