import { describe, it, expect, beforeAll } from 'vitest';
import { gradeAnswer, computeResult } from '../server/services/grading';
import { isPrivateIp, validateUrlSyntax, safeFetch, UrlError } from '../server/services/ssrf';
import { solveLinearFromText, fstr } from '../server/services/solver';
import { renderCertificatePdf } from '../server/services/certificatePdf';
import { setup, client, DEMO, profileBody } from './helpers';

describe('grading', () => {
  it('scores each type', () => {
    expect(gradeAnswer('mcq', 1, 1, 4)).toEqual({ kind: 'auto', marks: 4, correct: true });
    expect(gradeAnswer('mcq', 1, '2', 4)).toMatchObject({ marks: 0 });
    expect(gradeAnswer('tf', 0, 0, 1)).toMatchObject({ marks: 1 });
    expect(gradeAnswer('fill', { accept: ['Chennai'] }, '  chennai. ', 2)).toMatchObject({ marks: 2 });
    expect(gradeAnswer('numeric', { value: 5 }, '5.0', 3)).toMatchObject({ marks: 3 });
    expect(gradeAnswer('numeric', { value: 5 }, 'abc', 3)).toMatchObject({ marks: 0 });
    expect(gradeAnswer('short', { rubric: 'x' }, 'text', 5)).toEqual({ kind: 'manual' });
    expect(gradeAnswer('short', { rubric: 'x' }, '', 5)).toMatchObject({ marks: 0 });
    expect(gradeAnswer('mcq', 1, undefined, 4)).toMatchObject({ marks: 0 });
  });
  it('applies pass boundaries exactly and holds pending reviews', () => {
    expect(computeResult(20, 50, 40, false)).toMatchObject({ status: 'passed', pct: 40 });
    expect(computeResult(19.5, 50, 40, false).status).toBe('not_passed');
    expect(computeResult(50, 50, 40, true).status).toBe('pending_review');
    expect(computeResult(0, 0, 40, false).pct).toBe(0);
  });
});

describe('SSRF protection', () => {
  it('flags private/loopback/link-local addresses', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1']) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '93.184.216.34']) expect(isPrivateIp(ip), ip).toBe(false);
  });
  it('rejects bad schemes, ports and credentials', () => {
    for (const u of ['file:///etc/passwd', 'ftp://x.com', 'http://user:pw@example.com', 'http://example.com:22', 'javascript:alert(1)', 'nonsense']) expect(() => validateUrlSyntax(u), u).toThrow(UrlError);
    expect(validateUrlSyntax('https://example.com/a').hostname).toBe('example.com');
  });
  it('refuses to fetch internal targets', async () => {
    for (const u of ['http://localhost/', 'http://127.0.0.1:80/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/']) await expect(safeFetch(u), u).rejects.toBeInstanceOf(UrlError);
  });
});

describe('equation solver', () => {
  it('solves linear equations exactly', () => {
    expect(fstr(solveLinearFromText('3x + 5 = 20')!.x!)).toBe('5');
    expect(fstr(solveLinearFromText('2(x-3) = x+4')!.x!)).toBe('10');
    expect(fstr(solveLinearFromText('x/2 + 1 = 4')!.x!)).toBe('6');
    expect(fstr(solveLinearFromText('3x = 2')!.x!)).toBe('2/3');
    expect(solveLinearFromText('hello world')).toBeNull();
  });
});

describe('certificate PDF', () => {
  it('renders a valid PDF with Tamil text', async () => {
    const buf = await renderCertificatePdf({ ref: 'KM-2026-WT-ABCD1234', verifyUrl: 'http://localhost/verify/abc', status: 'valid', snapshot: { student_name: 'மீனாட்சி குமார்', test_title: 'Mathematics — Weekly Test 6', class_level: 8, subject_en: 'Mathematics', academic_year: '2026–2027', achieved_on: '2026-10-01T00:00:00Z', pct: 92, marks: 46, total: 50 } as any });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF'); expect(buf.length).toBeGreaterThan(5000);
  });
});

describe('AI tutor (development tutor) and materials', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { ctx = await setup(); }, 60000);
  it('is honestly labelled and solves an equation step by step', async () => {
    const c = client(ctx.app); await c.login(DEMO.student);
    const conv = (await c.post('/api/tutor/conversations', { lang: 'en' })).body.conversation;
    const r = await c.post(`/api/tutor/conversations/${conv.id}/messages`, { text: 'Solve 3x + 5 = 20', lang: 'en' });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).toMatch(/x = 5/); expect(JSON.stringify(r.body)).toMatch(/development-tutor/);
  });
  it('does not invent curriculum for an unknown question', async () => {
    const c = client(ctx.app); await c.login(DEMO.student);
    const conv = (await c.post('/api/tutor/conversations', { lang: 'en' })).body.conversation;
    const r = await c.post(`/api/tutor/conversations/${conv.id}/messages`, { text: 'Who won the 1987 cricket world cup final MVP?' });
    expect(r.status).toBe(200); expect(JSON.stringify(r.body)).not.toMatch(/Border|Allan/);
  });
  it('blocks the tutor for under-13 accounts until a guardian approves', async () => {
    const c = client(ctx.app); await c.register({ displayName: 'Tiny', email: 'tiny@x.com', password: 'Secret123', consent: true, under13: true, guardianName: 'Parent One', guardianEmail: 'parent1@x.com' });
    await c.put('/api/profile', profileBody({ fullName: 'Tiny One', classLevel: 4 }));
    const conv = (await c.post('/api/tutor/conversations', {})).body.conversation;
    expect((await c.post(`/api/tutor/conversations/${conv.id}/messages`, { text: 'hello' })).status).toBe(403);
  });
  it('rejects link learning to internal addresses and unsupported uploads', async () => {
    const c = client(ctx.app); await c.login(DEMO.student);
    const l = await c.post('/api/materials/link', { url: 'http://169.254.169.254/latest/meta-data' }); expect(l.status).toBeGreaterThanOrEqual(400); expect(l.status).toBeLessThan(500);
    const tok = (await c.get('/api/auth/me')).body.csrf; const up = await c.agent.post('/api/materials/upload').set('x-csrf-token', tok).field('kind', 'pdf').attach('file', Buffer.from('MZ not a pdf'), 'x.pdf');
    expect(up.status).toBe(415);
  });
  it('keeps uploaded materials private to their owner', async () => {
    const a = client(ctx.app); await a.login(DEMO.student); const b = client(ctx.app); await b.login(DEMO.arun);
    const csrf = (await a.get('/api/auth/me')).body.csrf;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const up = await a.agent.post('/api/materials/upload').set('x-csrf-token', csrf).field('kind', 'image').attach('file', png, 'p.png'); expect(up.status).toBeLessThan(300);
    const id = up.body.material?.id ?? up.body.id; expect(id).toBeTruthy();
    expect((await b.get(`/api/materials/${id}`)).status).toBe(404); expect((await b.get(`/api/materials/${id}/file`)).status).toBe(404);
  });
});

describe('PDF materials', () => {
  async function makePdf(pages: string[]): Promise<Buffer> {
    const PDFDocument = (await import('pdfkit')).default; const doc = new PDFDocument(); const bufs: Buffer[] = []; doc.on('data', (b: Buffer) => bufs.push(b));
    pages.forEach((t, i) => { if (i) doc.addPage(); if (t) doc.text(t); }); doc.end(); await new Promise(r => doc.on('end', r)); return Buffer.concat(bufs);
  }
  it('extracts text per page and answers only from the material', async () => {
    const ctx = await setup(); const c = client(ctx.app); await c.login(DEMO.student); const csrf = (await c.get('/api/auth/me')).body.csrf;
    const pdf = await makePdf(['Photosynthesis is how green plants make food using sunlight. Chlorophyll absorbs sunlight in the leaves.', 'Respiration releases energy from food in every living cell of the plant body.']);
    const up = await c.agent.post('/api/materials/upload').set('x-csrf-token', csrf).field('kind', 'pdf').attach('file', pdf, 'bio.pdf');
    expect(up.status).toBe(201); expect(up.body.material.status).toBe('ready'); expect(up.body.material.pageCount).toBe(2);
    const id = up.body.material.id;
    const hit = await c.post(`/api/materials/${id}/ask`, { question: 'What does chlorophyll absorb?' }); expect(hit.body.found).toBe(true); expect(hit.body.answers[0].page).toBe(1);
    const miss = await c.post(`/api/materials/${id}/ask`, { question: 'Who invented the telephone?' }); expect(miss.body.found).toBe(false);
    expect((await c.post(`/api/materials/${id}/quiz`, {})).body.questions.length).toBeGreaterThan(0);
  });
  it('reports scanned (text-less) PDFs honestly instead of inventing text', async () => {
    const ctx = await setup(); const c = client(ctx.app); await c.login(DEMO.student); const csrf = (await c.get('/api/auth/me')).body.csrf;
    const up = await c.agent.post('/api/materials/upload').set('x-csrf-token', csrf).field('kind', 'pdf').attach('file', await makePdf(['']), 'scan.pdf');
    expect(up.status).toBe(201); expect(up.body.material.status).toBe('needs_ocr'); expect(up.body.material.hasText).toBe(false);
  });
});

describe('Tamil retrieval', () => {
  it('finds a passage through inflected word forms, not only exact words', async () => {
    const { topPassages, stem } = await import('../server/services/retrieval');
    expect(stem('ஆறுகளில்')).toBe('ஆறு'); expect(stem('ஆறுகளை')).toBe('ஆறு'); expect(stem('ஆறு')).toBe('ஆறு');
    const ps = [
      { text: 'நதிகள் கடலுக்கு நீரைக் கொண்டு செல்கின்றன. மழைக்காலத்தில் ஆறுகளில் வெள்ளம் பெருகும் என்பதால் அணைகள் கட்டப்பட்டன.', page: 20, source: 'Tamil 8' },
      { text: 'விவசாயிகள் வயல்களுக்கு நீர் பாய்ச்சுகிறார்கள். கிணறுகளிலிருந்து நீர் இறைக்க ஏற்றம் பயன்படுத்தப்பட்டது.', page: 21, source: 'Tamil 8' },
      { text: 'The volcano erupts every forty years and forms volcanic glass when lava cools quickly without crystals.', page: 5, source: 'Science' },
    ];
    const hit = topPassages('ஆறு வெள்ளம் பற்றி என்ன?', ps, 2); expect(hit[0]?.page).toBe(20);
    expect(topPassages('கிணறுகள் பற்றி', ps, 1)[0]?.page).toBe(21);
    expect(topPassages('volcano glass', ps, 1)[0]?.page).toBe(5);
  });
});
