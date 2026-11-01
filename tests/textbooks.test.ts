import { beforeEach, describe, expect, it } from 'vitest';
import { client, DEMO, setup } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { ctx = await setup(); });
async function makePdf(pages: string[]): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default; const doc = new PDFDocument(); const bufs: Buffer[] = []; doc.on('data', (b: Buffer) => bufs.push(b));
  pages.forEach((t, i) => { if (i) doc.addPage(); doc.text(t); }); doc.end(); await new Promise(r => doc.on('end', r)); return Buffer.concat(bufs);
}
const login = async (email: string) => { const c = client(ctx.app); expect((await c.login(email)).status).toBe(200); const csrf = (await c.get('/api/auth/me')).body.csrf; return { c, csrf }; };
const addBook = async (t: { c: any; csrf: string }, title: string, classLevel: number, pages: string[], subjectId = '') =>
  t.c.agent.post('/api/textbooks').set('x-csrf-token', t.csrf).field('title', title).field('classLevel', String(classLevel)).field('subjectId', subjectId).field('medium', 'English').attach('file', await makePdf(pages), 'b.pdf');
const P8 = ['Introduction to the volcano unit. Students will study volcanoes and rocks in this unit.', 'The Zephyrian obsidian volcano erupts every forty years. Obsidian is volcanic glass formed when lava cools quickly without crystals.'];
const P10 = ['Quantum flibbertigibbet theory describes the wobbling of the grand unified marmalade field in advanced physics.'];

describe('class books', () => {
  it('only the platform admin can upload; only PDFs are accepted', async () => {
    const s = await login(DEMO.student); expect((await addBook(s, 'x', 8, P8)).status).toBe(403);
    const tt = await login(DEMO.teacher); expect((await addBook(tt, 'x', 8, P8)).status).toBe(403);
    const t = await login(DEMO.admin);
    const bad = await t.c.agent.post('/api/textbooks').set('x-csrf-token', t.csrf).field('title', 'Bad book').field('classLevel', '8').attach('file', Buffer.from('<html>no</html>'), 'b.pdf'); expect(bad.status).toBe(415);
    const ok = await addBook(t, 'Class 8 Science', 8, P8); expect(ok.status).toBe(201); expect(ok.body.textbook.page_count).toBe(2); expect(ok.body.textbook.status).toBe('ready');
  });
  it('a student sees, opens and reads pages of their own class book only', async () => {
    const t = await login(DEMO.admin); const b8 = (await addBook(t, 'Class 8 Science', 8, P8)).body.textbook.id; const b10 = (await addBook(t, 'Class 10 Physics', 10, P10)).body.textbook.id;
    const s = await login(DEMO.student); const list = (await s.c.get('/api/textbooks')).body.textbooks;
    expect(list.map((b: any) => b.id)).toEqual([b8]);
    expect((await s.c.get(`/api/textbooks/${b8}/pages/2`)).body.text).toMatch(/Zephyrian/);
    const f = await s.c.get(`/api/textbooks/${b8}/file`); expect(f.status).toBe(200); expect(f.headers['content-type']).toMatch(/pdf/); expect(f.headers['x-frame-options']).toBe('SAMEORIGIN');
    for (const u of [`/api/textbooks/${b10}`, `/api/textbooks/${b10}/file`, `/api/textbooks/${b10}/pages/1`]) expect((await s.c.get(u)).status).toBe(404);
    expect((await s.c.del(`/api/textbooks/${b8}`)).status).toBe(403);
  });
  it('the chatbot answers from the student\'s class book and cites the page; other classes\' books are never used', async () => {
    const t = await login(DEMO.admin); const b8 = (await addBook(t, 'Class 8 Science', 8, P8)).body.textbook.id; await addBook(t, 'Class 10 Physics', 10, P10);
    const s = await login(DEMO.student); const conv = (await s.c.post('/api/tutor/conversations', {})).body; const cid = conv.conversation?.id ?? conv.id;
    const a = (await s.c.post(`/api/tutor/conversations/${cid}/messages`, { text: 'How often does the Zephyrian obsidian volcano erupt?' })).body.messages[1];
    expect(a.content.en).toMatch(/forty years/); expect(a.meta.refs[0]).toMatchObject({ bookId: b8, page: 2 }); expect(a.meta.sources.join()).toMatch(/page 2/);
    const o = (await s.c.post(`/api/tutor/conversations/${cid}/messages`, { text: 'Explain the quantum flibbertigibbet marmalade field' })).body.messages[1];
    expect(JSON.stringify(o)).not.toMatch(/flibbertigibbet theory|grand unified/); expect(o.meta.refs ?? []).toHaveLength(0);
  });
  it('a scanned (no-text) book is stored but marked as needing OCR, and is not used for answers', async () => {
    const t = await login(DEMO.admin); const r = await addBook(t, 'Scanned', 8, ['', '', '']); expect(r.status).toBe(201); expect(r.body.textbook.status).toBe('needs_ocr');
    const s = await login(DEMO.student); expect((await s.c.get('/api/textbooks')).body.textbooks).toHaveLength(1); const cv = (await s.c.post('/api/tutor/conversations', {})).body; expect(JSON.stringify((await s.c.post(`/api/tutor/conversations/${cv.conversation?.id ?? cv.id}/messages`, { text: 'scanned pages content' })).body)).not.toMatch(/From your class book/);
  });
});

describe('teacher read-only', () => { it('a teacher can list books but cannot delete them', async () => {
  const a = await login(DEMO.admin); const id = (await addBook(a, 'Class 8 Science', 8, P8)).body.textbook.id;
  const t = await login(DEMO.teacher); expect((await t.c.get('/api/textbooks')).body.textbooks).toHaveLength(1);
  expect((await t.c.agent.delete(`/api/textbooks/${id}`).set('x-csrf-token', t.csrf)).status).toBe(403);
  expect((await a.c.agent.delete(`/api/textbooks/${id}`).set('x-csrf-token', a.csrf)).status).toBe(200); }); });

describe('lesson textbook tab', () => {
  it('returns only related pages of the student\'s own class book', async () => {
    const a = await login(DEMO.admin); await addBook(a, 'Class 8 Maths', 8, ['Solving linear equations means finding the value of the variable. A linear equation has the variable only to the power one, and we keep both sides balanced.', 'Unrelated page about volcanoes and obsidian glass formed when lava cools.']);
    await addBook(a, 'Class 10 Physics', 10, P10);
    const s = await login(DEMO.student); const r = await s.c.get('/api/textbooks/for-lesson/c8-maths-linear'); expect(r.status).toBe(200);
    expect(r.body.pages.length).toBeGreaterThan(0); expect(r.body.pages.every((p: any) => p.book === 'Class 8 Maths')).toBe(true); expect(JSON.stringify(r.body)).not.toMatch(/marmalade/);
    expect((await s.c.get('/api/textbooks/for-lesson/c10-nope')).status).toBe(404);
  });
  it('says when the stored PDF file is gone, while the page text stays readable', async () => {
    const t = await login(DEMO.admin); const id = (await addBook(t, 'Class 8 Science', 8, P8)).body.textbook.id;
    expect((await t.c.get(`/api/textbooks/${id}`)).body.textbook.file_ok).toBe(true);
    const { storage } = await import('../server/services/storage'); const { q } = await import('../server/db');
    const row = await q.get<any>(ctx.db, 'SELECT file_path FROM textbooks WHERE id=?', id); await storage().delete(row.file_path);
    expect((await t.c.get(`/api/textbooks/${id}`)).body.textbook.file_ok).toBe(false);
    expect((await t.c.get('/api/textbooks')).body.textbooks.find((b: any) => b.id === id).file_ok).toBe(false);
    expect((await t.c.get(`/api/textbooks/${id}/file`)).status).toBe(404);
    expect((await t.c.get(`/api/textbooks/${id}/pages/2`)).body.text).toMatch(/Zephyrian/);
  });
});
