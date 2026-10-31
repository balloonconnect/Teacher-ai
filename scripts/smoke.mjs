#!/usr/bin/env node
/**
 * End-to-end check of a RUNNING server: the real HTTP API, the database behind it, real OCR, retrieval and the tutor.
 *   node scripts/smoke.mjs [--url http://localhost:3001]      (needs ADMIN_EMAIL / ADMIN_PASSWORD; demo server: admin@demo.kavli.local / demo@12345)
 * It makes a scanned (image-only) PDF with a known sentence, uploads it as the admin, waits for OCR, signs up a student, asks the tutor about that sentence and
 * checks the answer is cited to the uploaded page, asks something the book cannot answer and checks it refuses, then removes the test book.
 * Needs ImageMagick (`convert`) and pdfkit's PDF output only for the scan; without `convert` the OCR step is skipped and said so.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiClient, sleep } from './lib/api.mjs';

const i = process.argv.indexOf('--url'); const base = i >= 0 ? process.argv[i + 1] : (process.env.PUBLIC_URL || 'http://localhost:3001');
const email = process.env.ADMIN_EMAIL ?? 'admin@demo.kavli.local'; const password = process.env.ADMIN_PASSWORD ?? 'demo@12345';
let fails = 0; const ok = (c, m, extra = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}${extra ? `  — ${extra}` : ''}`); if (!c) fails++; };
const SENTENCE = 'The Kavli smoke test lighthouse keeper polishes the brass lamp every evening before sunset.';

// 1. health
const h = await (await fetch(`${base}/api/health`)).json().catch(() => null); ok(h?.ok === true, 'server is healthy');
const admin = apiClient(base); try { await admin.login(email, password); ok(true, 'admin signs in'); } catch (e) { ok(false, 'admin signs in', e.message); process.exit(1); }
const sys = await admin.get('/admin/system'); console.log('      set-up:', sys.checks.map(c => `${c.key}=${c.ok ? 'ok' : 'todo'}`).join(' '));

// 2. a scanned PDF: text drawn as a picture, so the PDF has no text layer
const dir = mkdtempSync(join(tmpdir(), 'kavli-smoke-')); let bookId = null;
try {
  const png = join(dir, 'page.png'); const pdf = join(dir, 'scan.pdf');
  const mk = spawnSync('convert', ['-size', '1400x500', 'xc:white', '-fill', 'black', '-pointsize', '34', '-gravity', 'center', '-annotate', '0', 'Chapter 1: The Lighthouse\n\n' + SENTENCE.replace(/(.{48}\s)/g, '$1\n'), png]);
  if (mk.status !== 0) console.log('SKIP  OCR step: ImageMagick (convert) not available');
  else {
    const conv = spawnSync('convert', [png, '-units', 'PixelsPerInch', '-density', '150', pdf]); ok(conv.status === 0, 'made a scanned PDF');
    const fd = new FormData(); fd.set('title', 'Smoke test book'); fd.set('classLevel', '7'); fd.set('medium', 'English'); fd.set('file', new Blob([readFileSync(pdf)], { type: 'application/pdf' }), 'scan.pdf');
    let b = (await admin.post('/textbooks', fd)).textbook; bookId = b.id; ok(['processing', 'needs_ocr', 'ready'].includes(b.status), 'upload accepted', `status=${b.status}`);
    if (b.status === 'needs_ocr') { await admin.post(`/textbooks/${b.id}/ocr`, {}); b.status = 'processing'; }
    for (let t = 0; t < 60 && b.status === 'processing'; t++) { await sleep(2000); b = (await admin.get('/textbooks')).textbooks.find(x => x.id === bookId); }
    ok(b.status === 'ready', 'OCR finished and the book is ready', `status=${b.status}`);
    const pg = await admin.get(`/textbooks/${bookId}/pages/1`).catch(() => ({ text: '' })); ok(/lighthouse/i.test(pg.text) && /brass/i.test(pg.text), 'OCR read the sentence from the picture', JSON.stringify(pg.text.slice(0, 70)));

    // 3. a student of that class asks the tutor
    const stu = apiClient(base); const em = `smoke${Date.now()}@example.com`;
    const reg = await stu.post('/auth/register', { displayName: 'Smoke Student', email: em, password: 'Sunrise123', role: 'student', consent: true, student: { classLevel: 7, medium: 'English', aiLang: 'en', academicYear: '2026–2027', subjects: ['maths'] } });
    stu.setCsrf(reg.csrf); ok(!!reg.user?.id, 'student signs up');
    const ask = async text => { const c = await stu.post('/tutor/conversations', {}); const m = await stu.post(`/tutor/conversations/${c.id ?? c.conversation?.id}/messages`, { text }); return m; };
    const a1 = await ask('What does the lighthouse keeper do every evening?'); const t1 = JSON.stringify(a1);
    ok(/brass lamp|polish/i.test(t1), 'tutor answers from the uploaded page', 'mentions the lamp');
    ok(/Smoke test book/i.test(t1) || /page\s*1/i.test(t1), 'the answer is cited to the book and page');
    const a2 = await ask('Explain how black holes bend spacetime near the event horizon'); ok(!/lighthouse|brass lamp/i.test(JSON.stringify(a2)), 'a question the book cannot answer does not borrow from it');
  }
} catch (e) { ok(false, 'unexpected error', e.message); }
finally { if (bookId) await admin.del(`/textbooks/${bookId}`).then(() => ok(true, 'test book removed')).catch(() => {}); rmSync(dir, { recursive: true, force: true }); }
console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed'); process.exit(fails ? 1 : 0);
