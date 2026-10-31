#!/usr/bin/env node
/**
 * Adds a textbook PDF to a running Karkai AI server (local or deployed), as the platform admin, and waits until its pages are read.
 *   node scripts/import-book.mjs <file.pdf> --class 8 --subject tamil --medium Tamil [--title "..."] [--url http://localhost:3001]
 * Credentials: ADMIN_EMAIL and ADMIN_PASSWORD (environment). Subjects: maths, science, english, social, tamil (omit for all subjects).
 * It does the same thing as Admin -> Class books in the app, including chapter detection once the book is ready.
 */
import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { apiClient, sleep } from './lib/api.mjs';

const args = process.argv.slice(2); const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const file = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--'));
if (!file || !existsSync(file)) { console.error('Usage: node scripts/import-book.mjs <file.pdf> --class 8 [--subject tamil] [--medium Tamil|English] [--title "..."] [--url http://localhost:3001]\nNeeds ADMIN_EMAIL and ADMIN_PASSWORD.'); process.exit(2); }
const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env; if (!ADMIN_EMAIL || !ADMIN_PASSWORD) { console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD.'); process.exit(2); }
const api = apiClient(flag('url', process.env.PUBLIC_URL || 'http://localhost:3001'));
await api.login(ADMIN_EMAIL, ADMIN_PASSWORD);
const fd = new FormData(); fd.set('title', flag('title', basename(file, '.pdf').replace(/[_-]+/g, ' '))); fd.set('classLevel', flag('class', '8')); fd.set('medium', flag('medium', 'English'));
if (flag('subject')) fd.set('subjectId', flag('subject')); fd.set('file', new Blob([readFileSync(file)], { type: 'application/pdf' }), basename(file));
let r = (await api.post('/textbooks', fd)).textbook; console.log(`uploaded: ${r.title}  status=${r.status}  pages=${r.page_count}${r.note ? `\n  ${r.note}` : ''}`);
if (r.status === 'needs_ocr') { try { await api.post(`/textbooks/${r.id}/ocr`, {}); r.status = 'processing'; } catch (e) { console.error(`\nThe book was uploaded but could not be read: ${e.message}`); console.error(r.note ?? ''); process.exit(1); } }
const t0 = Date.now(); let last = '';
while (r.status === 'processing') {
  await sleep(5000); r = (await api.get('/textbooks')).textbooks.find(b => b.id === r.id) ?? r;
  const line = `${r.note ?? 'reading pages…'}  (${Math.round((Date.now() - t0) / 1000)} s)`; if (line !== last) { process.stdout.write(`\r${line}   `); last = line; }
}
console.log(`\nfinal status: ${r.status}`); if (r.status !== 'ready') { console.error('The book did not become ready.'); process.exit(1); }
try { let c = (await api.get(`/textbooks/${r.id}/chapters`)).chapters; if (!c.length) c = (await api.post(`/textbooks/${r.id}/chapters/detect`, {})).chapters; console.log(`chapters found: ${c.length}`); } catch (e) { console.log(`chapter detection: ${e.message}`); }
console.log(`done. Students of class ${flag('class', '8')} can open it now.`);
