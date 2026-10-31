import { beforeEach, describe, expect, it } from 'vitest';
import { client, DEMO, setup } from './helpers';
import { q } from '../server/db';
import { parseContents, detectChapters } from '../server/services/chapters';
import { gatherSources } from '../server/services/llmEngine';
import { initialState } from '../server/services/teach';

describe('contents parsing', () => {
  it('reads English entries with dotted leaders, chapter numbers and *-marks', () => {
    const e = parseContents('Contents\n1. Forces and Motion ........ 5\nUnit 2  Light and Sound 14\n3 Heat* . . . . 23\nPage numbers\n');
    expect(e).toEqual([{ title: 'Forces and Motion', printed: 5 }, { title: 'Unit 2 Light and Sound', printed: 14 }, { title: 'Heat', printed: 23 }]);
  });
  it('reads Tamil entries (titles end in vowel signs), trailing months and stray specks, Tamil digits', () => {
    const e = parseContents('பொருளடக்கம்\nமொழி தமிழ்மொழி வாழ்த்து” 2\nதமிழ் இன்பம் வரிவடிவ வளர்ச்சி 8 ஜூன்\nகல்வி கரையில பல்துறைக் கல்வி ௫௨ ae\n௫. புத்தியைத் தீட்டு 5௦ ௫\n');
    expect(e.map(x => x.printed)).toEqual([2, 8, 52, 50]);
    expect(e[1].title).toBe('தமிழ் இன்பம் வரிவடிவ வளர்ச்சி'); expect(e[3].title).toMatch(/புத்தியைத் தீட்டு/);
  });
  it('ignores prose and lines without a trailing page number', () => { expect(parseContents('This book has many lessons.\nPublished in the year of the dragon\n')).toEqual([]); });
});

const body = (title: string, extra = '') => `${title}\nThis lesson explains ${title.toLowerCase()} in simple words for students of class eight. ${extra}`.trim();
function book(offset = 2, tocLines?: string[]) {
  const toc = tocLines ?? [`Forces 1`, `Light 3`, `Sound 5`, `Heat 7`]; const pages: Record<number, string> = { 1: 'Class 8 Science textbook', 2: `Contents\n${toc.join('\n')}` };
  [['Forces', 1], ['Light', 3], ['Sound', 5], ['Heat', 7]].forEach(([t, pr]) => { pages[(pr as number) + offset] = body(t as string); pages[(pr as number) + offset + 1] = `More about ${String(t).toLowerCase()} and its uses in daily life for every student.`; });
  return Object.entries(pages).map(([page, text]) => ({ page: Number(page), text }));
}
describe('chapter detection', () => {
  it('finds chapters and the printed-to-PDF page offset', () => {
    const c = detectChapters(book(2), 10); expect(c.map(x => [x.title, x.startPage, x.endPage, x.verified])).toEqual([['Forces', 3, 4, true], ['Light', 5, 6, true], ['Sound', 7, 8, true], ['Heat', 9, 10, true]]);
  });
  it('works with a different offset', () => { expect(detectChapters(book(4).concat([{ page: 11, text: 'x'.repeat(30) }, { page: 12, text: 'y'.repeat(30) }]), 12).map(x => x.startPage)).toEqual([5, 7, 9, 11]); });
  it('survives one misread page number without losing the chapters after it', () => {
    const c = detectChapters(book(2, ['Forces 1', 'Light 93', 'Sound 5', 'Heat 7']), 10); expect(c.map(x => x.title)).toEqual(['Forces', 'Sound', 'Heat']);
  });
  it('returns nothing when there is no contents page, or the titles do not match any page', () => {
    expect(detectChapters(book(2).filter(p => p.page !== 2), 10)).toEqual([]);
    expect(detectChapters(book(2, ['Volcanoes 1', 'Oceans 3', 'Deserts 5', 'Glaciers 7']), 10)).toEqual([]);
  });
});

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { t = await setup(); });
async function makePdf(pages: string[]): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default; const doc = new PDFDocument(); const bufs: Buffer[] = []; doc.on('data', (b: Buffer) => bufs.push(b));
  pages.forEach((x, i) => { if (i) doc.addPage(); doc.text(x); }); doc.end(); await new Promise(r => doc.on('end', r)); return Buffer.concat(bufs);
}
const PAGES = [
  'Class 8 Science textbook',
  'Contents\nForces 1\nLight 3\nSound 5\nHeat 7',
  'Forces\nA force is a push or a pull acting on an object. Friction is the force that opposes motion between two surfaces in contact.',
  'More about forces. Gravity pulls every object towards the centre of the earth and gives it weight, which we measure with a spring balance.',
  'Light\nLight travels in straight lines. Refraction is the bending of light when it passes from air into water or glass, because its speed changes.',
  'More about light. A prism splits white light into seven colours, a spectrum, because each colour is refracted by a different amount.',
  'Sound\nSound is made by vibrations and needs a medium such as air to travel. Echo is the sound that we hear after it is reflected from a wall.',
  'More about sound. Pitch depends on the frequency of vibration, and loudness depends on the amplitude of the wave reaching the ear.',
  'Heat\nHeat flows from a hot object to a cold object. Conduction is the transfer of heat through a solid without the solid itself moving.',
  'More about heat. Convection carries heat in liquids and gases as the warm fluid rises and the cooler fluid sinks to take its place.',
];
const login = async (email: string) => { const c = client(t.app); expect((await c.login(email)).status).toBe(200); return c; };
async function upload(medium = 'English', classLevel = 8) {
  const a = await login(DEMO.admin); const csrf = (await a.get('/api/auth/me')).body.csrf;
  const r = await a.agent.post('/api/textbooks').set('x-csrf-token', csrf).field('title', 'Class 8 Science').field('classLevel', String(classLevel)).field('medium', medium).attach('file', await makePdf(PAGES), 'b.pdf');
  expect(r.status).toBe(201); return { a, id: r.body.textbook.id as string };
}

describe('chapters API', () => {
  it('detects chapters when a text book is uploaded; the student of that class can list them', async () => {
    const { id } = await upload(); const s = await login(DEMO.student);
    const list = (await s.get(`/api/textbooks/${id}/chapters`)).body.chapters; expect(list.map((c: any) => [c.title, c.startPage, c.endPage])).toEqual([['Forces', 3, 4], ['Light', 5, 6], ['Sound', 7, 8], ['Heat', 9, 10]]);
  });
  it('students of another class cannot list them; the admin can re-detect and edit', async () => {
    const { a, id } = await upload('English', 10); const s = await login(DEMO.student); expect((await s.get(`/api/textbooks/${id}/chapters`)).status).toBe(404);
    expect((await s.post(`/api/textbooks/${id}/chapters/detect`)).status).toBe(403); expect((await s.put(`/api/textbooks/${id}/chapters`, { chapters: [] })).status).toBe(403);
    const d = await a.post(`/api/textbooks/${id}/chapters/detect`); expect(d.status).toBe(200); expect(d.body.chapters).toHaveLength(4);
    const bad = await a.put(`/api/textbooks/${id}/chapters`, { chapters: [{ title: 'A', startPage: 3, endPage: 5 }, { title: 'B', startPage: 5, endPage: 8 }] }); expect(bad.status).toBe(400);
    const out = await a.put(`/api/textbooks/${id}/chapters`, { chapters: [{ title: 'Whole book', startPage: 1, endPage: 10 }] }); expect(out.body.chapters).toEqual([expect.objectContaining({ title: 'Whole book', source: 'admin' })]);
    expect((await q.get<any>(t.db, 'SELECT COUNT(*) c FROM textbook_chapters WHERE textbook_id=?', id)).c).toBe(1);
    expect((await a.del(`/api/textbooks/${id}`)).status).toBe(200); expect((await q.get<any>(t.db, 'SELECT COUNT(*) c FROM textbook_chapters WHERE textbook_id=?', id)).c).toBe(0);
  });
  it('re-detecting says so plainly when the book has no contents page', async () => {
    const a = await login(DEMO.admin); const csrf = (await a.get('/api/auth/me')).body.csrf;
    const r = await a.agent.post('/api/textbooks').set('x-csrf-token', csrf).field('title', 'No contents').field('classLevel', '8').attach('file', await makePdf(['Just some text about rivers and mountains that goes on for a while.', 'Second page about lakes and valleys in the northern region.']), 'b.pdf');
    const d = await a.post(`/api/textbooks/${r.body.textbook.id}/chapters/detect`); expect(d.status).toBe(422); expect(d.body.error ?? d.body.message).toMatch(/No contents page/);
  });
});

describe('tutor inside a chapter', () => {
  const turn = async (c: any, sid: string, text: string, action?: string) => (await c.post(`/api/voice/sessions/${sid}/turn`, { text, action })).body.events as any[];
  const chunks = (ev: any[]) => ev.filter(e => e.type === 'chunk');
  async function session(chapterTitle: string, body: any = {}) {
    const { id } = await upload(); const s = await login(DEMO.student); const ch = (await s.get(`/api/textbooks/${id}/chapters`)).body.chapters.find((c: any) => c.title === chapterTitle);
    const r = await s.post('/api/voice/sessions', { lang: 'en', mode: 'teach', chapterId: ch.id, ...body }); return { s, r, id, ch };
  }
  it('answers from the chosen chapter only, with its own book pages as references', async () => {
    const { s, r } = await session('Light'); expect(r.status).toBe(201); expect(r.body.session.topic).toBe('Light'); expect(r.body.session.state.chapter).toMatchObject({ title: 'Light', start: 5, end: 6 });
    const ev = await turn(s, r.body.session.id, 'What is refraction of light?'); const step = chunks(ev).find(e => e.kind === 'step'); expect(step.grounded).toBe('textbook');
    expect(step.refs.every((x: any) => x.page >= 5 && x.page <= 6)).toBe(true); expect(JSON.stringify(ev)).toMatch(/Refraction/);
  });
  it('does not answer a question that belongs to a different chapter', async () => {
    const { s, r } = await session('Light'); const ev = await turn(s, r.body.session.id, 'Explain conduction of heat in a solid');
    expect(chunks(ev)[0].grounded).toBe('none'); expect(JSON.stringify(ev)).not.toMatch(/Conduction is the transfer/);
  });
  it('"teach me this chapter" teaches from pages of that chapter, in book order, and nothing else', async () => {
    const { s, r } = await session('Heat'); const ev = await turn(s, r.body.session.id, 'teach me this chapter');
    const intro = chunks(ev)[0]; expect(intro.en).toMatch(/Heat/); const step = chunks(ev).find(e => e.kind === 'step'); expect(step.refs.every((x: any) => x.page >= 9 && x.page <= 10)).toBe(true);
    expect(JSON.stringify(ev)).not.toMatch(/Refraction|Echo|Friction/);
  });
  it('keeps the chapter across turns and mode changes', async () => {
    const { s, r } = await session('Sound'); const sid = r.body.session.id; await turn(s, sid, 'teach me this chapter'); await turn(s, sid, '', 'mode:explain');
    const st = (await s.get(`/api/voice/sessions/${sid}`)).body.session.state; expect(st.chapter).toMatchObject({ title: 'Sound', start: 7, end: 8 }); expect(st.mode).toBe('explain');
  });
  it('rejects a chapter from another class’s book, or an unknown chapter', async () => {
    const { id } = await upload('English', 10); const a = await login(DEMO.admin); const ch = (await a.get(`/api/textbooks/${id}/chapters`)).body.chapters[0];
    const s = await login(DEMO.student); expect((await s.post('/api/voice/sessions', { lang: 'en', mode: 'teach', chapterId: ch.id })).status).toBe(404);
    expect((await s.post('/api/voice/sessions', { lang: 'en', mode: 'teach', chapterId: 'nope' })).status).toBe(404);
  });
  it('the model path is given sources from the chosen chapter only', async () => {
    const { r, id } = await session('Light'); const state = r.body.session.state;
    const ctx: any = { db: t.db, userId: 'u', classLevel: 8, lang: 'en', subjectId: null, lessonId: null, state };
    const specific = await gatherSources(t.db, ctx, 'what is refraction'); expect(specific.length).toBeGreaterThan(0); expect(specific.every(x => x.page! >= 5 && x.page! <= 6 && x.bookId === id)).toBe(true);
    const generic = await gatherSources(t.db, ctx, 'teach me this chapter'); expect(generic.length).toBeGreaterThan(0); expect(generic.every(x => x.page! >= 5 && x.page! <= 6)).toBe(true);
    const other = await gatherSources(t.db, ctx, 'conduction of heat in solids'); expect(other).toEqual([]);
    expect(initialState('teach').chapter).toBeUndefined();
  });
});
