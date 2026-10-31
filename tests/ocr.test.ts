import { beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { client, DEMO, setup } from './helpers';
import { setOcrEngine, textQuality, cleanOcr, type OcrEngine } from '../server/services/ocr';
import { ocrQueue, resumeOcr } from '../server/services/textbookIngest';
import { q as dq } from '../server/db';
import { textbookHits } from '../server/services/tutor';

const hasPoppler = spawnSync('pdftoppm', ['-v']).status !== null;
let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { ctx = await setup(); });
async function makePdf(pages: string[]): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default; const doc = new PDFDocument(); const bufs: Buffer[] = []; doc.on('data', (b: Buffer) => bufs.push(b));
  pages.forEach((t, i) => { if (i) doc.addPage(); if (t) doc.text(t); else doc.rect(50, 50, 200, 100).fill('#ccc'); }); doc.end(); await new Promise(r => doc.on('end', r)); return Buffer.concat(bufs);
}
const admin = async () => { const c = client(ctx.app); await c.login(DEMO.admin); return { c, csrf: (await c.get('/api/auth/me')).body.csrf }; };
const upload = async (a: any, pages: string[], medium = 'English') => a.c.agent.post('/api/textbooks').set('x-csrf-token', a.csrf).field('title', 'Scanned unit').field('classLevel', '8').field('medium', medium).attach('file', await makePdf(pages), 'b.pdf');
const fake = (texts: (n: number) => string, calls: number[] = []): OcrEngine => ({ name: 'fake', async recognize() { calls.push(calls.length + 1); return texts(calls.length); } });

it('drops the pipe and bracket debris OCR makes from page borders', () => { expect(cleanOcr('— | | | & [|||] — நதிகள் கடல்')).toBe('— & — நதிகள் கடல்'); });
describe('text-layer quality', () => {
  it('trusts clean text, rejects empty, doubled-virama (legacy Tamil encoding) and spaced-out text', () => {
    expect(textQuality('The volcano erupts every forty years and forms volcanic glass when lava cools.', 'English').ok).toBe(true);
    expect(textQuality('', 'English')).toEqual({ ok: false, reason: 'no text' });
    expect(textQuality('நதிகள்்  கடலுக்கு நீரைக் கொண்்டு செல்கின்்றன. மழைக்�காலத்தில் ஆறுகளில் வெள்்ளம் பெருகும்்.', 'Tamil').ok).toBe(false);
    expect(textQuality('ந தி க ள் க ட லு க் கு நீ ர ை க் கொ ண் டு செ ல் கி ன் ற ன . ம ழை க் கா ல த் தி ல் வெ ள் ள ம் பெ ரு கு ம்', 'Tamil').ok).toBe(false);
    expect(textQuality('நதிகள் கடலுக்கு நீரைக் கொண்டு செல்கின்றன. மழைக்காலத்தில் ஆறுகளில் வெள்ளம் பெருகும்.', 'Tamil').ok).toBe(true);
    expect(textQuality('This is English text inside a Tamil-medium book page about grammar rules and so on.', 'Tamil').ok).toBe(true);
  });
  it('removes the zero-width marks Tesseract adds after Tamil virama', () => { expect(cleanOcr('பயன்‌படுத்த​  முடியாது\n\n\n\nஎன்பதால்')).toBe('பயன்படுத்த முடியாது\n\nஎன்பதால்'); });
});

describe.skipIf(!hasPoppler)('scanned books are read in the background', () => {
  it('a scanned upload opens at once as “processing”, then becomes ready with searchable text page by page', async () => {
    const calls: number[] = []; setOcrEngine(fake(n => `Page ${n}. The Zephyrian obsidian volcano erupts every forty years and forms volcanic glass.`, calls));
    const a = await admin(); const up = await upload(a, ['', '', '']); expect(up.status).toBe(201); expect(up.body.textbook.status).toBe('processing'); expect(up.body.textbook.note).toMatch(/OCR/);
    const id = up.body.textbook.id;
    const s = client(ctx.app); await s.login(DEMO.student); expect((await s.get('/api/textbooks')).body.textbooks.map((b: any) => b.id)).toContain(id); // students can already open it
    await ocrQueue.idle();
    const done = (await a.c.get(`/api/textbooks/${id}`)).body.textbook; expect(done.status).toBe('ready'); expect(calls.length).toBe(3);
    expect((await a.c.get(`/api/textbooks/${id}/pages/2`)).body.text).toMatch(/Zephyrian/);
    const hits = await textbookHits(ctx.db, 8, null, 'When does the Zephyrian obsidian volcano erupt?', 3); expect(hits.length).toBeGreaterThan(0);
  });
  it('"Re-read all pages" replaces the stored text of every page, while plain "Read pages" only fills gaps', async () => {
    const calls: number[] = []; let version = 'old'; setOcrEngine(fake(n => `Page ${n} ${version} reading about the Zephyrian obsidian volcano and its glass.`, calls));
    const a = await admin(); const up = await upload(a, ['', '', '']); const id = up.body.textbook.id; await ocrQueue.idle(); expect(calls.length).toBe(3);
    expect((await a.c.post(`/api/textbooks/${id}/ocr`, {})).status).toBe(409); // nothing missing
    version = 'new'; const again = await a.c.post(`/api/textbooks/${id}/ocr`, { all: true }); expect(again.status).toBe(202); await ocrQueue.idle(); expect(calls.length).toBe(6);
    expect((await a.c.get(`/api/textbooks/${id}/pages/2`)).body.text).toMatch(/new reading/);
  });
  it('good text-layer pages are kept and only the bad pages are sent to OCR', async () => {
    const calls: number[] = []; setOcrEngine(fake(() => 'Recovered scanned page about rivers and the water cycle in detail.', calls));
    const a = await admin(); const up = await upload(a, ['Page one has a perfectly readable text layer about volcanoes and lava flows.', '', 'Page three is readable too and talks about earthquakes and tectonic plates.']);
    expect(up.body.textbook.status).toBe('processing'); await ocrQueue.idle();
    expect(calls.length).toBe(1); const rows = await dq.all<any>(ctx.db, 'SELECT page,text FROM textbook_pages WHERE textbook_id=? ORDER BY page', up.body.textbook.id);
    expect(rows.map((r: any) => r.page)).toEqual([1, 2, 3]); expect(rows[0].text).toMatch(/volcanoes/); expect(rows[1].text).toMatch(/water cycle/);
  });
  it('a failing OCR engine leaves the book honest: pages it could not read are reported, nothing is invented', async () => {
    setOcrEngine({ name: 'broken', async recognize() { throw new Error('boom'); } });
    const a = await admin(); const up = await upload(a, ['', '']); await ocrQueue.idle();
    const b = (await a.c.get(`/api/textbooks/${up.body.textbook.id}`)).body.textbook; expect(b.status).toBe('needs_ocr'); expect(b.note).toMatch(/No readable text/);
  });
  it('without any OCR engine a scanned book says so; a restart resumes half-read books; admin can re-run OCR later', async () => {
    const a = await admin(); const up = await upload(a, ['', '']); expect(up.body.textbook.status).toBe('needs_ocr'); const id = up.body.textbook.id;
    expect((await a.c.post(`/api/textbooks/${id}/ocr`, {})).status).toBe(501);
    setOcrEngine(fake(n => `Resumed page ${n} with enough words to be kept by the importer.`));
    await dq.run(ctx.db, "UPDATE textbooks SET status='processing' WHERE id=?", id); expect(await resumeOcr(ctx.db)).toBe(1); await ocrQueue.idle();
    expect((await a.c.get(`/api/textbooks/${id}`)).body.textbook.status).toBe('ready');
    expect((await a.c.post(`/api/textbooks/${id}/ocr`, {})).status).toBe(409); // nothing left to read
    const s = client(ctx.app); await s.login(DEMO.student); expect((await s.post(`/api/textbooks/${id}/ocr`, {})).status).toBe(403);
  });
});
describe('legacy Latin-gibberish Tamil', () => {
  it('rejects Tamil rendered as Latin letters but accepts real English on a Tamil-medium page', () => {
    expect(textQuality('Gjpd; vOj;Jfs; tbtq;fs; mike;jd. ghWfspy; nra;Jk;NghJ tisNfhLfisg; gad;gLj;j KbahJ vd;gjhy; Neh;Nfhl;Lfs;', 'Tamil').ok).toBe(false);
  });
});
describe('subtly corrupted Tamil (measured on a real textbook)', () => {
  it('rejects a legacy-font text layer that looks Tamil but is broken, and accepts clean OCR output', () => {
    const legacy = 'நதிகள் கடலுக்கு நீ ்த�ை க் கொ ்த்டு செல் கின் றன. ம ்த ழைக் காைலத்தி ல் ஆ ்த றுகளில் வெ ்த்ள ளம் பெ ருகு ம் ்த்து ்த�ே ம் ்தன';
    const clean = 'நதிகள் கடலுக்கு நீரைக் கொண்டு செல்கின்றன. மழைக்காலத்தில் ஆறுகளில் வெள்ளம் பெருகும். விவசாயிகள் அந்த நீரை வயல்களுக்குப் பாய்ச்சுகிறார்கள்.';
    expect(textQuality(legacy, 'Tamil').ok).toBe(false); expect(textQuality(clean, 'Tamil').ok).toBe(true);
  });
});
