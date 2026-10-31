/**
 * Records real API responses (from the seeded demo student) into src/preview-data.json.
 * UI-preview mode replays them so the whole student flow can be reviewed with no backend.
 * Run: npx tsx scripts/record-preview.ts   (uses an in-memory database; no network)
 */
import request from 'supertest';
import PDFDocument from 'pdfkit';
import { writeFileSync, mkdirSync } from 'node:fs';
import { openDb } from '../server/db';
import { seed, DEMO_PASSWORD } from '../server/seed';
import { createApp } from '../server/app';
import { clock } from '../server/clock';

process.env.DISABLE_RATE_LIMIT = '1';
const out: any = { base: {}, lessons: {}, tests: {}, practice: {}, attempt: {}, after: {}, verify: {}, material: {}, mindmaps: {} };

async function pdf(): Promise<Buffer> {
  const d = new PDFDocument({ size: 'A4' }); const chunks: Buffer[] = []; d.on('data', c => chunks.push(c));
  d.fontSize(16).text('Sample chapter: Linear equations'); d.moveDown().fontSize(12).text('A linear equation in one variable has the form ax + b = c. To solve it, subtract b from both sides, then divide both sides by a. For example, 2x + 3 = 11 gives 2x = 8 and so x = 4. Always check the answer by putting it back in the equation.');
  d.addPage().fontSize(12).text('Word problems: choose a letter for the unknown number, write an equation from the sentence, solve it, then check that your answer makes sense in the story.');
  d.end(); await new Promise(r => d.on('end', r)); return Buffer.concat(chunks);
}

(async () => {
  clock.reset(); out.recordedAt = clock.now().toISOString(); const db = openDb(':memory:'); await seed(db); const app = createApp(db, { serveStatic: false });
  const agent = request.agent(app); let csrf = '';
  const get = async (u: string) => { const r = await agent.get('/api' + u); if (r.status !== 200) throw new Error(`GET ${u} -> ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); return r.body; };
  const post = async (u: string, b: any = {}) => { const r = await agent.post('/api' + u).set('x-csrf-token', csrf).send(b); if (r.status >= 300) throw new Error(`POST ${u} -> ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); return r.body; };
  const login = await agent.post('/api/auth/login').send({ email: 'meena@demo.kavli.local', password: DEMO_PASSWORD }); csrf = login.body.csrf; out.login = login.body;
  const key = (id: string) => JSON.parse((await q.get(db, 'SELECT answer FROM questions WHERE id=?', id) as any).answer);
  const ans = (q: any) => { const k = key(q.id); return q.type === 'mcq' || q.type === 'tf' ? k : q.type === 'numeric' ? String(k.value) : k.accept?.[0]; };

  for (const p of ['/auth/me', '/config', '/dashboard', '/curriculum?class=8', '/profile', '/practice/options', '/bookmarks', '/certificates', '/reports/me', '/revision-plan', '/assignments', '/materials', '/notifications', '/tests']) out.base[p] = await get(p);
  const lessonIds: string[] = []; const cur = out.base['/curriculum?class=8'];
  JSON.stringify(cur, (_k, v) => { if (v && typeof v === 'object' && typeof v.id === 'string' && v.chapter_no !== undefined && v.title_en) lessonIds.push(v.id); return v; });
  for (const id of [...new Set(lessonIds)]) { out.lessons[id] = await get(`/lessons/${id}`); const mm = await get(`/lessons/${id}/mindmap`); out.mindmaps[id] = { map: mm.map, classLevel: mm.classLevel, subject_id: mm.subject_id }; }
  for (const t of out.base['/tests'].tests) out.tests[t.id] = await get(`/tests/${t.id}`);

  // practice
  const opt = out.base['/practice/options']; const subject = (opt.subjects?.[0]?.id ?? opt.subjects?.[0]) || 'maths';
  const ps = await post('/practice/start', { subject, difficulty: 'mixed', count: 5 }); out.practice.start = ps;
  out.practice.submit = await post(`/practice/${ps.sessionId}/submit`, { answers: Object.fromEntries(ps.questions.map((q: any, i: number) => [q.id, i % 2 === 0 ? ans(q) : (q.type === 'mcq' ? 'x' : '0')])) });

  // material (PDF)
  const up = await agent.post('/api/materials/upload').set('x-csrf-token', csrf).field('kind', 'pdf').attach('file', await pdf(), { filename: 'linear-equations.pdf', contentType: 'application/pdf' });
  if (up.status >= 300) throw new Error('upload ' + up.status + JSON.stringify(up.body)); out.material.upload = up.body; const mid = up.body.material.id;
  out.material.list = await get('/materials'); out.material.detail = await get(`/materials/${mid}`);
  out.material.ask = await post(`/materials/${mid}/ask`, { question: 'How do I solve 2x + 3 = 11?' }); out.material.notes = await post(`/materials/${mid}/notes`); out.material.quiz = await post(`/materials/${mid}/quiz`);
  await agent.delete(`/api/materials/${mid}`).set('x-csrf-token', csrf);

  // weekly test journey
  const test = out.base['/tests'].tests.find((t: any) => t.id === 'test-maths-w6' && t.status === 'Available') ?? out.base['/tests'].tests.find((t: any) => t.status === 'Available');
  out.attempt.testId = test.id; const st = await post(`/tests/${test.id}/attempts`); out.attempt.start = st;
  const att = (await get(`/attempts/${st.attemptId}`)); out.attempt.pre = att;
  const items = att.attempt.questions.map((q: any) => ({ questionId: q.id, answer: ans(q) }));
  out.attempt.submit = await post(`/attempts/${st.attemptId}/submit`, { items });
  out.attempt.result = await get(`/attempts/${st.attemptId}/result`); out.attempt.review = await get(`/attempts/${st.attemptId}/review`);
  for (const p of ['/tests', '/dashboard', '/certificates', '/reports/me', '/revision-plan', '/notifications']) out.after[p] = await get(p);
  out.after.testDetail = await get(`/tests/${test.id}`);
  const cert = out.after['/certificates'].certificates[0]; if (cert) { out.attempt.certHistory = await get(`/certificates/${cert.id}/history`); out.verify[cert.token] = await get(`/verify/${cert.token}`); out.attempt.cert = cert; }
  if (cert) { const r = await agent.get(`/api/certificates/${cert.id}/pdf`).buffer(true).parse((res, cb) => { const d: Buffer[] = []; res.on('data', (x: Buffer) => d.push(x)); res.on('end', () => cb(null, Buffer.concat(d))); }); mkdirSync('public/preview', { recursive: true }); writeFileSync('public/preview/certificate.pdf', r.body as Buffer); }
  writeFileSync('src/preview-data.json', JSON.stringify(out));
  console.log('recorded', { lessons: Object.keys(out.lessons).length, tests: Object.keys(out.tests).length, result: out.attempt.result?.result?.status, cert: !!cert, kb: Math.round(JSON.stringify(out).length / 1024) });
})().catch(e => { console.error(e); process.exit(1); });
