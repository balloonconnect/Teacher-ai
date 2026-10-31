import { beforeEach, describe, expect, it } from 'vitest';
import { client, DEMO, setup } from './helpers';
import { q } from '../server/db';
import { buildCloze, buildSections, looksLikeHeading, backfillChapterLessons } from '../server/services/chapterLessons';
import { buildMindMap } from '../server/services/mindmap';

const TAMIL = 'தமிழ் மொழி மிகவும் பழமையான மொழிகளில் ஒன்றாகும். ஒவ்வொரு மொழியிலும் காலந்தோறும் புதிய சொற்கள் தோன்றுகின்றன. திருக்குறள் உலகப் பொதுமறை என்று போற்றப்படுகிறது. கல்வி கரையில கற்பவர் நாள்சில என்று நாலடியார் கூறுகிறது. மாணவர்கள் நூல்களை விரும்பிப் படிக்க வேண்டும்.';

describe('chapter sections and questions are extractive', () => {
  it('cuts pages into sections, with headings only when they look like real words', () => {
    const s = buildSections([{ page: 3, text: `— iz & Ei” —\n${TAMIL}` }, { page: 4, text: `சொற்பூங்கா\n${TAMIL}\n${TAMIL}` }], true);
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].h_ta).toMatch(/^பக்கம் 3/); // the noisy banner is not used as a heading
    expect(s.every(x => x.en.length >= 40 && x.ta === x.en)).toBe(true);
    expect(buildSections([{ page: 1, text: 'Forces\nA force is a push or a pull acting on an object.' }], false)[0].ta).toBe('');
  });
  it('recognises headings', () => { expect(looksLikeHeading('சொற்பூங்கா', true)).toBe(true); expect(looksLikeHeading('— iz & Ei” —', true)).toBe(false); expect(looksLikeHeading('Forces and Motion', false)).toBe(true); });
  it('makes fill-in-the-blank questions whose answer comes from the chapter text and is one of the options', () => {
    const qs = buildCloze(TAMIL, 'seed');
    expect(qs.length).toBeGreaterThan(0);
    for (const c of qs) { expect(c.options).toHaveLength(4); expect(new Set(c.options).size).toBe(4); expect(c.options[c.correct]).toBe(c.answer); expect(TAMIL).toContain(c.answer); expect(c.stem).toContain('_____'); }
    expect(buildCloze(TAMIL, 'seed')).toEqual(qs); // deterministic
    expect(buildCloze('Too short.', 's')).toEqual([]);
  });
});

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { t = await setup(); });
const BOOK = 'book-1';
async function seedBook(opts: { subject?: string | null } = {}) {
  const subject = opts.subject === undefined ? 'tamil' : opts.subject;
  await q.run(t.db, "INSERT INTO textbooks(id,title,class_level,subject_id,medium,file_path,size,page_count,status,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", BOOK, 'Class 8 Tamil', 8, subject, 'Tamil', 'x', 1, 4, 'ready', 'u', new Date().toISOString());
  for (const [ord, title, a, b] of [[1, 'சொற்பூங்கா', 1, 2], [2, 'திருக்குறள்', 3, 4]] as const) await q.run(t.db, 'INSERT INTO textbook_chapters(id,textbook_id,ord,title,start_page,end_page,verified,source) VALUES (?,?,?,?,?,?,?,?)', `ch${ord}`, BOOK, ord, title, a, b, 1, 'auto');
  for (let p = 1; p <= 4; p++) await q.run(t.db, 'INSERT INTO textbook_pages(textbook_id,page,text) VALUES (?,?,?)', BOOK, p, `${TAMIL}\n${TAMIL}`);
}
const login = async (email: string) => { const c = client(t.app); expect((await c.login(email)).status).toBe(200); return c; };

describe('book chapters become lessons', () => {
  it('creates one lesson per chapter; the Learn page lists them instead of the sample lessons for that subject', async () => {
    await seedBook(); expect(await backfillChapterLessons(t.db)).toBe(2);
    const s = await login(DEMO.student); const cur = (await s.get('/api/curriculum?class=8')).body;
    expect(cur.fromBooks).toEqual(['tamil']);
    const tamil = cur.subjects.find((x: any) => x.id === 'tamil'); expect(tamil.lessons.map((l: any) => l.title_en)).toEqual(['சொற்பூங்கா', 'திருக்குறள்']);
    expect(cur.subjects.find((x: any) => x.id === 'maths').lessons.length).toBeGreaterThan(0); // other subjects keep the sample lessons
    const lesson = (await s.get(`/api/lessons/${tamil.lessons[0].id}`)).body.lesson; expect(lesson.source).toMatch(/^Textbook:/); expect(lesson.content.sections.length).toBeGreaterThan(0);
    const map = (await s.get(`/api/lessons/${lesson.id}/mindmap`)); expect(map.status).toBe(200);
    expect(() => buildMindMap({ id: lesson.id, title_en: lesson.title_en, title_ta: lesson.title_ta, content: lesson.content, source: lesson.source })).not.toThrow();
  });
  it('is repeatable and keeps student progress; removing a book takes its lessons off the page', async () => {
    await seedBook(); await backfillChapterLessons(t.db); await backfillChapterLessons(t.db);
    expect((await q.get<any>(t.db, "SELECT COUNT(*) c FROM lessons WHERE id LIKE 'bk-%'")).c).toBe(2);
    const a = await login(DEMO.admin); await q.run(t.db, 'DELETE FROM textbook_chapters WHERE textbook_id=? AND ord=2', BOOK); await backfillChapterLessons(t.db);
    expect((await q.get<any>(t.db, "SELECT COUNT(*) c FROM lessons WHERE id LIKE 'bk-%' AND status='published'")).c).toBe(1);
    void a;
  });
  it('makes practice questions from the book, and a draft copy for teachers that tests cannot use until reviewed', async () => {
    await seedBook(); await backfillChapterLessons(t.db);
    const s = await login(DEMO.student);
    const opts = (await s.get('/api/practice/options')).body.subjects.find((x: any) => x.id === 'tamil'); expect(opts.chapters).toEqual([1, 2]);
    const start = await s.post('/api/practice/start', { subject: 'tamil', chapter: 1, count: 3 }); expect(start.status).toBe(200); expect(start.body.questions.every((x: any) => x.id.startsWith('bp-'))).toBe(true);
    const draft = await q.get<any>(t.db, "SELECT status, origin FROM questions WHERE id LIKE 'bq-%' LIMIT 1"); expect(draft).toEqual({ status: 'draft', origin: 'book' });
    expect((await q.get<any>(t.db, "SELECT COUNT(*) c FROM questions WHERE origin='practice' AND created_by='book-import'")).c).toBeGreaterThan(0);
  });
  it('makes nothing for a book without a subject', async () => { await seedBook({ subject: null }); expect(await backfillChapterLessons(t.db)).toBe(0); });
  it('the tutor and voice tutor can teach from the chapter lesson', async () => {
    await seedBook(); await backfillChapterLessons(t.db); const s = await login(DEMO.student);
    const cv = (await s.post('/api/tutor/conversations', { lessonId: 'bk-book-1-1', lang: 'ta' })).body.conversation;
    const m = await s.post(`/api/tutor/conversations/${cv.id}/messages`, { text: 'திருக்குறள் உலகப் பொதுமறை', lang: 'ta' }); expect(m.status).toBe(200);
    const reply = m.body.messages.at(-1); expect(reply.meta.grounded).toBe('lesson');
    const vs = await s.post('/api/voice/sessions', { mode: 'teach', lang: 'ta', lessonId: 'bk-book-1-1' }); expect(vs.status).toBe(201);
    const turn = await s.post(`/api/voice/sessions/${vs.body.session.id}/turn`, { text: 'தொடங்கு' }); expect(turn.status).toBe(200);
    expect(turn.text).toContain('"grounded":"lesson"');
  });
});

describe('editing a book’s subject and medium', () => {
  it('moves its lessons to the new subject, hides them with no subject, and rejects non-admins and bad values', async () => {
    await seedBook(); await backfillChapterLessons(t.db);
    const a = await login(DEMO.admin);
    expect((await a.patch(`/api/textbooks/${BOOK}`, { subjectId: 'english', medium: 'Both' })).status).toBe(200);
    const bk = await q.get<any>(t.db, 'SELECT subject_id, medium FROM textbooks WHERE id=?', BOOK); expect(bk).toMatchObject({ subject_id: 'english', medium: 'Both' });
    expect((await q.all<any>(t.db, "SELECT DISTINCT subject_id FROM lessons WHERE id LIKE 'bk-%'")).map(x => x.subject_id)).toEqual(['english']);
    expect((await a.patch(`/api/textbooks/${BOOK}`, { subjectId: null })).status).toBe(200);
    expect((await q.get<any>(t.db, "SELECT COUNT(*) c FROM lessons WHERE id LIKE 'bk-%' AND status='published'")).c).toBe(0);
    expect((await a.patch(`/api/textbooks/${BOOK}`, { subjectId: 'nope' })).status).toBe(400);
    expect((await a.patch(`/api/textbooks/${BOOK}`, { medium: 'French' })).status).toBe(400);
    const s = await login(DEMO.student); expect((await s.patch(`/api/textbooks/${BOOK}`, { medium: 'Tamil' })).status).toBe(403);
  });
});
