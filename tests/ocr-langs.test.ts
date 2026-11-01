import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { client, DEMO, setup } from './helpers';
import { type OcrEngine, setInstalledOcrLangs, setOcrEngine } from '../server/services/ocr';
import { systemStatus } from '../server/services/status';

/** Tesseract does not fail when Tamil data is missing; it reads Tamil as English and returns junk. The app must refuse instead. */
let ctx: Awaited<ReturnType<typeof setup>>; let calls = 0;
const engine: OcrEngine = { name: 'tesseract', async recognize() { calls++; return 'junk'; } };
beforeEach(async () => { calls = 0; ctx = await setup(); setOcrEngine(engine); });
afterEach(() => { setOcrEngine(null); setInstalledOcrLangs(undefined); });
async function blankPdf(n = 3) { const PDFDocument = (await import('pdfkit')).default; const doc = new PDFDocument(); const b: Buffer[] = []; doc.on('data', (x: Buffer) => b.push(x)); for (let i = 0; i < n; i++) { if (i) doc.addPage(); doc.text(' '); } doc.end(); await new Promise(r => doc.on('end', r)); return Buffer.concat(b); }
const upload = async (medium: 'Tamil' | 'English') => { const a = client(ctx.app); await a.login(DEMO.admin); const csrf = (await a.get('/api/auth/me')).body.csrf; const r = await a.agent.post('/api/textbooks').set('x-csrf-token', csrf).field('title', 'Scan').field('classLevel', '8').field('medium', medium).attach('file', await blankPdf(), 'b.pdf'); return { a, csrf, r }; };

describe('OCR language data', () => {
  it('a Tamil book is not OCR-read without Tamil data, and says what to install', async () => {
    setInstalledOcrLangs(['eng', 'osd']); const { a, csrf, r } = await upload('Tamil'); expect(r.status).toBe(201);
    expect(r.body.textbook.status).toBe('needs_ocr'); expect(r.body.textbook.note).toMatch(/language data is missing.*tam/); expect(calls).toBe(0);
    const again = await a.agent.post(`/api/textbooks/${r.body.textbook.id}/ocr`).set('x-csrf-token', csrf).send({}); expect(again.status).toBe(501); expect(again.body.error).toMatch(/tesseract-ocr-tam/);
  });
  it('an English book still works without Tamil data', async () => {
    setInstalledOcrLangs(['eng']); const { r } = await upload('English'); expect(r.body.textbook.status).toBe('processing');
  });
  it('a Tamil book is read when the data is installed', async () => {
    setInstalledOcrLangs(['eng', 'tam']); const { r } = await upload('Tamil'); expect(r.body.textbook.status).toBe('processing');
  });
  it('the admin set-up check names the missing Tamil data', async () => {
    setInstalledOcrLangs(['eng']); const c = (await systemStatus(ctx.db)).checks.find((x: any) => x.key === 'ocr')!; expect(c.ok).toBe(false); expect(c.detail).toMatch(/Tamil data missing/); expect(c.advice).toMatch(/tesseract-ocr-tam/);
    setInstalledOcrLangs(['eng', 'tam']); expect((await systemStatus(ctx.db)).checks.find((x: any) => x.key === 'ocr')!.ok).toBe(true);
  });
});
