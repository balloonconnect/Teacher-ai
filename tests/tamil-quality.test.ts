import { readFileSync, existsSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { client, DEMO, setup } from './helpers';
import { chunkText, normalizeTamil } from '../shared/tamil';
import { cleanLines, isCleanLine, isFurniture, missingProtected, tamilShare } from '../server/services/tamilText';
import { checkResult, transformTamil, TamilAiError } from '../server/services/tamilAi';
import { ocrNoise, illFormedTamil } from '../server/services/ocr';
import { buildSections } from '../server/services/chapterLessons';

const S1 = 'கல்வியின் முக்கியத்துவம் மனித வாழ்க்கையில் மிகவும் இன்றியமையாதது.';
const S2 = 'உங்கள் குடும்பத்தின் மகிழ்ச்சியான தருணங்களை அழகான புகைப்படங்களாகப் பதிவு செய்யுங்கள்.';
const S3 = 'நாளை காலை 10 மணிக்கு நடைபெறும் நிகழ்ச்சிக்கான முன்பதிவை உறுதிப்படுத்தவும்.';
// What the OCR produced for page 37 of the Class 8 book (the screenshot that started this work)
const NOISE = 'ன் பபற்ற்னு ஓ (உக ந';
const FOOTER = ' 8th Std Tamil CBSE - Unit 2.indd 27 ஓ 23-01-2025 16:50:14';

describe('Tamil text hygiene', () => {
  it('normalises to NFC and removes zero-width characters, but keeps punctuation, digits, paragraphs and English', () => {
    expect(normalizeTamil('கொ')).toBe('கொ'); // two-part vowel sign composed
    expect(normalizeTamil('மரம்‌ என்பது​ மனித')).toBe('மரம் என்பது மனித');
    expect(normalizeTamil('ஒன்று,  இரண்டு!\r\n\r\n\r\nWhatsApp 😊 ₹1,500 ☎ 98430 12345')).toBe('ஒன்று, இரண்டு!\n\nWhatsApp 😊 ₹1,500 ☎ 98430 12345');
    expect(normalizeTamil(S1 + S2)).toBe(S1 + S2); expect(normalizeTamil('')).toBe(''); expect(normalizeTamil(null as any)).toBe('');
  });
  it('the representative sentences are clean, fully Tamil and well formed', () => {
    for (const s of [S1, S2, S3]) { expect(isCleanLine(s)).toBe(true); expect(illFormedTamil(s)).toBe(0); expect(tamilShare(s)).toBeGreaterThan(0.95); expect(normalizeTamil(s)).toBe(s); }
  });
  it('recognises the OCR noise and the print footer from the screenshot', () => {
    expect(isCleanLine(NOISE)).toBe(false); expect(isFurniture(FOOTER)).toBe(true); expect(isCleanLine(FOOTER)).toBe(false); expect(isFurniture('— iz & Ei” —')).toBe(true);
    const c = cleanLines(`${NOISE}\n${S1}\n${FOOTER}\n${S2}`); expect(c.text).toBe(`${S1}\n${S2}`); expect(c.dropped).toBe(2); expect(c.quality).toBe(0.5);
  });
  it('page noise score separates clean OCR from garbage', () => { expect(ocrNoise(`${S1}\n${S2}\n${S3}`)).toBeLessThan(1); expect(ocrNoise(`${NOISE}\nம பட்ட மாம ர ர. we Ober்்`)).toBeGreaterThan(5); });
  it('lessons drop noisy lines and print furniture, and keep real text', () => {
    const sec = buildSections([{ page: 37, text: `${NOISE}\nகவிதைப்பேழை\n${S1} ${S2}\n${S3}\n${FOOTER}` }], true);
    const all = sec.map(x => x.ta).join(' '); expect(all).toContain('கல்வியின்'); expect(all).not.toContain('indd'); expect(all).not.toContain('பபற்ற்னு');
  });
  it('keeps dates, amounts, phone numbers and names that must not change', () => {
    const src = 'முன்பதிவு எண் 98430 12345, தொகை ₹1,500, நாள் 12-03-2026, Karthik Raja, ௧௦ மணி';
    expect(missingProtected(src, src)).toEqual([]);
    expect(missingProtected(src, 'முன்பதிவு எண் 98430 12345, தொகை ₹1,500, நாள் 12-03-2026, 10 மணி')).toEqual(['karthik', 'raja']);
    expect(missingProtected('10 மணி', 'பத்து மணி')).toEqual(['10']);
  });
  it('splits long text into speakable chunks without cutting words, and never returns an empty chunk', () => {
    const long = Array.from({ length: 40 }, () => S1).join(' '); const ch = chunkText(long, 280);
    expect(ch.length).toBeGreaterThan(5); expect(ch.every(c => c.length > 0 && c.length <= 280)).toBe(true); expect(ch.join(' ').replace(/\s+/g, ' ')).toBe(long);
    const noSpaces = 'அ'.repeat(700); expect(chunkText(noSpaces, 280).every(c => c.length <= 280)).toBe(true);
    expect(chunkText('')).toEqual([]); expect(chunkText('சரி.')).toEqual(['சரி.']);
  });
});

const llm = (reply: string | ((u: string) => string)) => ({ name: 'mock-llm', complete: async (a: any) => (typeof reply === 'function' ? reply(a.user) : reply) });
describe('Tamil language checks', () => {
  it('accepts a faithful correction', async () => { const r = await transformTamil(llm(S3) as any, { action: 'correct', text: 'நாளை காலை 10 மணிக்கு நடைபெறும் நிகழ்ச்சிகான முன்பதிவை உறுதிபடுத்தவும்.' }); expect(r.text).toBe(S3); expect(r.changed).toBe(true); expect(r.original).toContain('நிகழ்ச்சிகான'); });
  it('removes quotes and labels the model adds around its answer', async () => { expect((await transformTamil(llm(`"${S1}"`) as any, { action: 'correct', text: S1 })).text).toBe(S1); expect((await transformTamil(llm(`Corrected: ${S1}`) as any, { action: 'correct', text: S1 })).changed).toBe(false); });
  it('rejects a result that drops a date or amount, is not Tamil, or invents extra content', async () => {
    await expect(transformTamil(llm('நாளை காலை மணிக்கு நடைபெறும் நிகழ்ச்சிக்கான முன்பதிவை உறுதிப்படுத்தவும்.') as any, { action: 'correct', text: S3 })).rejects.toThrow(/dropped details/);
    await expect(transformTamil(llm('Please confirm the booking for tomorrow at 10 am.') as any, { action: 'correct', text: S3 })).rejects.toThrow(/not in Tamil/);
    await expect(transformTamil(llm(`${S1} ${S2} ${S1} ${S2} ${S1} ${S2}`) as any, { action: 'correct', text: S1 })).rejects.toThrow(/longer or shorter/);
    await expect(transformTamil(llm(S1) as any, { action: 'to_english', text: S1 })).rejects.toThrow(/not translated/);
    expect(checkResult('correct', S1, '')).toMatch(/nothing/);
  });
  it('translation keeps digits but may change names; English result is accepted', async () => {
    const r = await transformTamil(llm('Please confirm the booking for the event at 10 tomorrow morning.') as any, { action: 'to_english', text: S3 }); expect(r.text).toContain('10');
    expect(checkResult('to_tamil', 'Confirm the 10 am booking', 'காலை 10 மணி முன்பதிவை உறுதிப்படுத்தவும்')).toBeNull();
  });
  it('validates input: empty, English-only for a Tamil action, too long, unknown action; model failure leaves the text alone', async () => {
    await expect(transformTamil(llm('x') as any, { action: 'correct', text: '   ' })).rejects.toThrow(/no text/);
    await expect(transformTamil(llm('x') as any, { action: 'correct', text: 'Hello there' })).rejects.toThrow(/no Tamil/);
    await expect(transformTamil(llm('x') as any, { action: 'correct', text: 'அ'.repeat(4001) })).rejects.toMatchObject({ status: 413 });
    await expect(transformTamil(llm('x') as any, { action: 'bogus' as any, text: S1 })).rejects.toMatchObject({ status: 400 });
    await expect(transformTamil({ name: 'down', complete: async () => { throw new Error('boom'); } } as any, { action: 'correct', text: S1 })).rejects.toBeInstanceOf(TamilAiError);
  });
  it('sends the Tamil system instruction and the source text, once', async () => {
    let calls = 0, seen: any; await transformTamil({ name: 'm', complete: async (a: any) => { calls++; seen = a; return S1; } } as any, { action: 'formal', text: S1 });
    expect(calls).toBe(1); expect(seen.system).toMatch(/expert Tamil language and educational content engine/); expect(seen.user).toContain(S1); expect(seen.user).toMatch(/formal written Tamil/);
  });
});

let t: Awaited<ReturnType<typeof setup>>;
const login = async (email = DEMO.student) => { const c = client(t.app); expect((await c.login(email)).status).toBe(200); return c; };
describe('Tamil API', () => {
  beforeEach(async () => { t = await setup({ llm: null, voiceTts: null }); });
  it('needs sign-in, and says plainly when no model or voice is configured', async () => {
    expect((await client(t.app).get('/api/tamil/config')).status).toBe(401);
    const s = await login(); const cfg = (await s.get('/api/tamil/config')).body; expect(cfg.llm.enabled).toBe(false); expect(cfg.tts.enabled).toBe(false); expect(cfg.tts.locale).toBe('ta-IN');
    const tr = await s.post('/api/tamil/transform', { action: 'correct', text: S1 }); expect(tr.status).toBe(501); expect(tr.body.error).toMatch(/not set up/);
    const sp = await s.post('/api/tamil/tts', { text: S1 }); expect(sp.status).toBe(501); expect(sp.body.error).toMatch(/browser/);
  });
  it('chunks text for the player', async () => { const s = await login(); const r = await s.post('/api/tamil/chunks', { text: Array(30).fill(S2).join(' ') }); expect(r.status).toBe(200); expect(r.body.chunks.every((c: string) => c.length <= 280)).toBe(true); });
});
describe('Tamil API with a model and a voice', () => {
  let tts = 0;
  beforeEach(async () => { tts = 0; t = await setup({ llm: llm(S3), voiceTts: { name: 'mock-tts', synth: async () => { tts++; return { audio: Buffer.from('ID3-audio'), mime: 'audio/mpeg' }; } } }); });
  it('transforms text, rejects unsafe results with 422, validates input', async () => {
    const s = await login(); const ok = await s.post('/api/tamil/transform', { action: 'correct', text: 'நாளை காலை 10 மணிக்கு நடைபெறும் நிகழ்ச்சிகான முன்பதிவை உறுதிபடுத்தவும்.' });
    expect(ok.status).toBe(200); expect(ok.body).toMatchObject({ text: S3, changed: true, action: 'correct' });
    const lost = await s.post('/api/tamil/transform', { action: 'correct', text: 'நாளை 11 மணிக்கு நிகழ்ச்சி நடைபெறும் என்பதை உறுதிப்படுத்தவும்.' }); expect(lost.status).toBe(422); expect(lost.body.error).toMatch(/original text is unchanged/);
    expect((await s.post('/api/tamil/transform', { action: 'nope', text: S1 })).status).toBe(400); expect((await s.post('/api/tamil/transform', { action: 'correct', text: '' })).status).toBe(400);
    expect((await s.post('/api/tamil/transform', { action: 'correct', text: 'அ'.repeat(9000) })).status).toBe(400);
  });
  it('speaks one chunk, caches repeats, limits length and the daily allowance', async () => {
    const s = await login(); const a = await s.post('/api/tamil/tts', { text: S1 }); expect(a.status).toBe(200); expect(a.headers['content-type']).toMatch(/audio\/mpeg/); expect(a.headers['x-audio-cache']).toBe('miss');
    const b = await s.post('/api/tamil/tts', { text: S1 }); expect(b.headers['x-audio-cache']).toBe('server-hit'); expect(tts).toBe(1);
    expect((await s.post('/api/tamil/tts', { text: 'அ'.repeat(501) })).status).toBe(413); expect((await s.post('/api/tamil/tts', { text: '   ' })).status).toBe(400);
    process.env.VOICE_TTS_DAILY_CHARS = '10'; try { expect((await s.post('/api/tamil/tts', { text: S2 })).status).toBe(429); } finally { delete process.env.VOICE_TTS_DAILY_CHARS; }
  });
  it('a failing voice service gives a clear error, not another language', async () => {
    t = await setup({ llm: null, voiceTts: { name: 'down', synth: async () => { const { TtsError } = await import('../server/services/tts'); throw new TtsError('The voice service took too long.', 504); } } });
    const s = await login(); const r = await s.post('/api/tamil/tts', { text: S1 }); expect(r.status).toBe(504); expect(r.body.error).toMatch(/too long/);
  });
});

describe('Tamil font and rendering setup', () => {
  const css = readFileSync('src/styles/global.css', 'utf8') + readFileSync('src/styles/tokens.css', 'utf8'); const main = readFileSync('src/main.tsx', 'utf8'); const html = readFileSync('index.html', 'utf8');
  it('self-hosts Noto Sans Tamil (no dependency on Google Fonts) with a Tamil-capable fallback stack', () => {
    expect(main).toMatch(/@fontsource\/noto-sans-tamil\/400\.css/); expect(existsSync('node_modules/@fontsource/noto-sans-tamil/files/noto-sans-tamil-tamil-400-normal.woff2')).toBe(true);
    expect(css).not.toMatch(/fonts\.googleapis\.com/); expect(html).not.toMatch(/fonts\.googleapis\.com/);
    expect(css).toMatch(/--font-ta:'Noto Sans Tamil'.*'Nirmala UI'.*'Latha'/); expect(html).toMatch(/<meta charset="utf-8"/i);
  });
  it('never uses artificial letter spacing on Tamil text', () => {
    const rule = css.match(/:lang\(ta\),\.ta,\.tamil-text\{[^}]*\}/)![0]; expect(rule).toMatch(/letter-spacing:normal/); expect(rule).toMatch(/word-break:normal/); expect(rule).toMatch(/line-height:1\.8/); expect(rule).not.toMatch(/letter-spacing:[^n]/);
  });
});
