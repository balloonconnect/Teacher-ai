import { describe, expect, it } from 'vitest';
import { client, DEMO, setup } from './helpers';
import { q } from '../server/db';
import { build } from '../server/services/bookStructure';
import { TEMPLATES, formatOf, Format } from '../server/services/learnTemplates';
import { ItemAiSchema, explainItem, ItemAiError } from '../server/services/itemLearn';
import { backfillChapterLessons } from '../server/services/chapterLessons';

/* All sample texts are invented for the tests. */
const W = 'அலர் மலர்ந்த கனியும் நிலவு ஒளிரும் தென்றல் வீசும் ஆறு பாயும் வானம் தெளிந்த மலை உயர்ந்த'.split(' ');
const verse = (n: number) => { const w = Array.from({ length: 7 }, (_, i) => W[(n + i) % W.length]); return [w.slice(0, 4).join(' '), w.slice(4).join(' ')]; };
const kuralPage = ['சோதனை அறிமுகம் இங்கே உள்ளது. இது கற்பனைச் சொற்களால் ஆனது.', '', 'அன்புடைமை', ...[1, 2, 3, 4].flatMap(n => ['', `${n}. ${verse(n)[0]}`, verse(n)[1], '', `பொருள் : சோதனைப் பொருள் ${n}.`])].join('\n');
const mixedPage = `நூல் வெளி
இது ஒரு கற்பனை நூலைப் பற்றிய சோதனைக் குறிப்பு ஆகும். இதில் உண்மைத் தகவல்கள் இல்லை.

கற்கண்டு
இது ஒரு கற்பனை இலக்கண விதி ஆகும். இதன் எடுத்துக்காட்டு சோதனை மட்டுமே.

பழமொழி
மலர்ந்த கனியும் நிலவு ஒளிரும் வானம்

மரபுத்தொடர்
தென்றல் வீசும் ஆறு பாயும் மலை

கடிதம்
இது ஒரு கற்பனைக் கடிதத்தின் அமைப்பு பற்றிய சோதனைக் குறிப்பு ஆகும்.

சொல்லும் பொருளும்
அலர் - மலர்

கற்பவை கற்றபின்
குறுவினா
1. சோதனை வினா ஒன்று எழுதுக.`;

describe('templates', () => {
  it('every content type has a complete template with the textbook text first and AI parts that the schema can hold', () => {
    const keys = new Set(Object.keys(ItemAiSchema.shape));
    for (const t of Object.values(TEMPLATES)) {
      expect(t.parts[0]).toMatchObject({ key: 'source', source: 'textbook' }); expect(t.task.length).toBeGreaterThan(10); expect(t.en && t.ta).toBeTruthy();
      expect(t.parts.some(p => p.key === 'quiz')).toBe(t.quiz);
      for (const p of t.parts.filter(p => p.source === 'ai')) expect(keys.has(p.key) || p.key === 'real_life', `${t.format}.${p.key}`).toBe(true);
    }
    expect(Object.keys(TEMPLATES).sort()).toEqual(['author', 'comprehension', 'devices', 'exercise', 'grammar', 'idiom', 'info', 'kural', 'poem', 'prose', 'proverb', 'stanza', 'story', 'vocab', 'writing']);
  });
  it('each item of a chapter gets the template that matches what it is', () => {
    const st = build([{ page: 1, text: mixedPage }, { page: 2, text: kuralPage }]); const by = (k: string) => st.items.filter(i => i.kind === k);
    expect(by('couplet').every(i => formatOf(i) === 'kural')).toBe(true); expect(by('word').every(i => formatOf(i) === 'vocab')).toBe(true); expect(by('question').every(i => formatOf(i) === 'exercise')).toBe(true);
    const fm = (section: string) => st.items.filter(i => i.section === section && ['paragraph', 'heading'].includes(i.kind)).map(i => formatOf(i));
    expect(fm('author')).toEqual(['author']); expect(fm('grammar')).toEqual(['grammar']); expect(fm('proverb')).toEqual(['proverb']); expect(fm('idiom')).toEqual(['idiom']); expect(fm('writing')).toEqual(['writing']);
    expect(formatOf({ kind: 'stanza', section: 'poem', lines: ['x'] })).toBe('stanza'); expect(formatOf({ kind: 'paragraph', section: 'prose', lines: ['நீண்ட பத்தி இது'] })).toBe('prose');
  });
  it('items of other kinds are not forced into the Thirukkural format', () => { const f = new Set<Format>(build([{ page: 1, text: mixedPage }]).items.map(i => formatOf(i))); expect(f.has('kural')).toBe(false); expect(f.size).toBeGreaterThan(4); });
});

const item = (over: any) => ({ id: 'i1', ord: 1, kind: 'paragraph', section: 'prose', page: 1, lines: ['மலர்ந்த கனியும் நிலவு ஒளிரும்', 'தென்றல் வீசும் ஆறு பாயும்'], flags: [], ...over });
const quiz = { question: 'எது ஒளிரும்?', options: ['நிலவு', 'ஆறு', 'மலை'], correct: 0, hint: 'முதல் வரியைப் பாருங்கள்', why: 'நிலவு ஒளிரும் என்று உள்ளது.' };
describe('model-written parts are validated', () => {
  const run = (it: any, reply: any, o: any = {}) => explainItem({ name: 'm', complete: async (a: any) => { run.last = a; return JSON.stringify(reply); } } as any, it, o.mode ?? 'explain', { chapter: 'x', ...o });
  run.last = {} as any;
  it('a Thirukkural card keeps its own words, a valid quiz and every part; the prompt names the class and the template', async () => {
    const it = item({ kind: 'couplet', section: 'body', number: '1' }); const ai = await run(it, { simple_ta: 'இது ஒரு எளிய விளக்கம் ஆகும்.', detailed: 'இது ஒரு விரிவான விளக்கம் ஆகும்.', real_life: 'பள்ளியில் நண்பர்களுக்கு உதவுதல் போன்றது இது.', takeaway: 'உதவுவது நல்லது என்பது கருத்து', word_meanings: [{ word: 'நிலவு', meaning: 'சந்திரன்' }, { word: 'கற்பனை', meaning: 'இல்லாத சொல்' }], quiz }, { classLevel: 8 });
    expect(ai.word_meanings).toEqual([{ word: 'நிலவு', meaning: 'சந்திரன்' }]); expect(ai.quiz).toEqual(quiz); expect(run.last.user).toContain('Thirukkural'); expect(run.last.user).toContain('Class 8'); expect(run.last.system).toMatch(/Do not add facts/);
  });
  it('a bad quiz (answer out of range, repeated options) is dropped but the explanation is kept', async () => {
    for (const bad of [{ ...quiz, correct: 5 }, { ...quiz, options: ['நிலவு', 'நிலவு', 'மலை'] }, { question: 'x', options: ['one'], correct: 0 }]) { const ai = await run(item({}), { simple_ta: 'இது ஒரு எளிய விளக்கம் ஆகும்.', quiz: bad }); expect(ai.quiz).toBeUndefined(); expect(ai.simple_ta).toBeTruthy(); }
  });
  it('grammar gets rule, examples and common mistakes; characters must be names in the text', async () => {
    const g = await run(item({ section: 'grammar' }), { definition: 'இது ஒரு சோதனை விதி ஆகும்.', simple_ta: 'இது எளிய விளக்கம் ஆகும்.', examples: ['மலர்'], mistakes: [{ wrong: 'தவறு', right: 'சரி', why: 'காரணம்' }] }); expect(g.mistakes).toHaveLength(1); expect(run.last.user).toMatch(/grammar/i);
    const s = await run(item({}), { simple_ta: 'இது எளிய விளக்கம் ஆகும்.', characters: [{ name: 'நிலவு', trait: 'ஒளி' }, { name: 'அரசன்', trait: 'இல்லை' }] }); expect(s.characters.map((c: any) => c.name)).toEqual(['நிலவு']);
  });
  it('English mode needs English; Tamil mode needs Tamil; empty answers are refused', async () => {
    expect((await run(item({}), { simple_ta: 'This text describes the moon shining over the river.' }, { lang: 'en' })).simple_ta).toMatch(/moon/); expect(run.last.user).toMatch(/clear English/);
    await expect(run(item({}), { simple_ta: 'இது ஒரு தமிழ் விளக்கம் ஆகும்.' }, { lang: 'en' })).rejects.toBeInstanceOf(ItemAiError);
    await expect(run(item({}), { simple_ta: 'This is English only explanation text here.' })).rejects.toBeInstanceOf(ItemAiError);
    await expect(run(item({}), {})).rejects.toBeInstanceOf(ItemAiError);
  });
  it('author notes are told to use only facts in the text', async () => { await run(item({ section: 'author' }), { summary: 'இது நூலின் சோதனைத் தொடர்பு ஆகும்.' }); expect(run.last.user).toMatch(/Add no biography/); });
});

const BOOK = 'book-t';
async function seed(t: any) {
  await q.run(t.db, "INSERT INTO textbooks(id,title,class_level,subject_id,medium,file_path,size,page_count,status,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", BOOK, 'T', 8, 'tamil', 'Tamil', 'x', 1, 1, 'ready', 'u', new Date().toISOString());
  await q.run(t.db, 'INSERT INTO textbook_chapters(id,textbook_id,ord,title,start_page,end_page,verified,source) VALUES (?,?,?,?,?,?,?,?)', 'c1', BOOK, 1, 'சோதனை', 1, 1, 0, 'test');
  await q.run(t.db, 'INSERT INTO textbook_pages(textbook_id,page,text) VALUES (?,?,?)', BOOK, 1, kuralPage); await backfillChapterLessons(t.db);
}
const LID = 'bk-book-t-1';
describe('API: templates, languages and per-item progress', () => {
  it('the item endpoint returns its template; progress, resume and revision lists follow the student', async () => {
    const t = await setup(); await seed(t); const s = client(t.app); await s.login(DEMO.student); const st = (await s.get(`/api/lessons/${LID}/structure`)).body.structure; const ks = st.items.filter((i: any) => i.kind === 'couplet');
    const it = (await s.get(`/api/lessons/${LID}/items/${ks[0].id}`)).body; expect(it.format).toBe('kural'); expect(it.template.parts.map((p: any) => p.key)).toContain('quiz'); expect(it.progress).toBeNull();
    expect((await s.get(`/api/lessons/${LID}/progress`)).body).toMatchObject({ total: 5, completed: 0, last: null, revision: [] });
    await s.post(`/api/lessons/${LID}/items/${ks[0].id}/progress`, { event: 'view' }); await s.post(`/api/lessons/${LID}/items/${ks[1].id}/progress`, { event: 'view' });
    await s.post(`/api/lessons/${LID}/items/${ks[1].id}/progress`, { event: 'quiz', correct: false }); await s.post(`/api/lessons/${LID}/items/${ks[0].id}/progress`, { event: 'complete' });
    const p = (await s.get(`/api/lessons/${LID}/progress`)).body; expect(p.completed).toBe(1); expect(p.last).toBe(ks[0].id); expect(p.revision).toEqual([ks[1].id]); expect(p.items[ks[1].id]).toMatchObject({ attempts: 1, wrong: 1, correct: 0 });
    await s.post(`/api/lessons/${LID}/items/${ks[1].id}/progress`, { event: 'quiz', correct: true }); await s.post(`/api/lessons/${LID}/items/${ks[1].id}/progress`, { event: 'quiz', correct: true });
    expect((await s.get(`/api/lessons/${LID}/progress`)).body.revision).toEqual([ks[1].id]); // tried, not yet marked learned
    await s.post(`/api/lessons/${LID}/items/${ks[1].id}/progress`, { event: 'complete' }); expect((await s.get(`/api/lessons/${LID}/progress`)).body.revision).toEqual([]); // learned, and two right answers outweigh the miss
    expect((await s.post(`/api/lessons/${LID}/items/${ks[0].id}/progress`, { event: 'quiz' })).status).toBe(400); expect((await s.post(`/api/lessons/${LID}/items/nope/progress`, { event: 'view' })).status).toBe(404);
    expect((await q.get<any>(t.db, 'SELECT COUNT(*) c FROM item_progress')).c).toBe(2);
    const teacher = client(t.app); await teacher.login(DEMO.teacher); expect((await teacher.post(`/api/lessons/${LID}/items/${ks[0].id}/progress`, { event: 'view' })).body.tracked).toBe(false);
  });
  it('Tamil and English explanations are stored separately; the model is told which language and the class', async () => {
    const calls: string[] = []; const llm = { name: 'mock', complete: async (a: any) => { calls.push(a.user); return JSON.stringify(/clear English/.test(a.user) ? { simple_ta: 'It describes the moon and the river clearly.' } : { simple_ta: 'இது ஒரு எளிய விளக்கம் ஆகும்.', quiz }); } };
    const t = await setup({ llm }); await seed(t); const s = client(t.app); await s.login(DEMO.student); const k = (await s.get(`/api/lessons/${LID}/structure`)).body.structure.items.find((i: any) => i.kind === 'couplet');
    const ta = await s.post(`/api/lessons/${LID}/items/${k.id}/ai`, {}); expect(ta.status).toBe(200); expect(ta.body.explanation).toMatchObject({ label: 'AI-generated', quiz: { correct: 0 } });
    const en = await s.post(`/api/lessons/${LID}/items/${k.id}/ai`, { lang: 'en' }); expect(en.body.explanation_en.simple_ta).toMatch(/moon/);
    const got = (await s.get(`/api/lessons/${LID}/items/${k.id}`)).body; expect(got.explanation.simple_ta).toMatch(/எளிய/); expect(got.explanation_en.simple_ta).toMatch(/moon/); expect(calls[0]).toContain('Class 8');
    expect((await q.all<any>(t.db, 'SELECT kind FROM item_ai ORDER BY kind')).map(x => x.kind)).toEqual(['explain', 'explain_en']);
  });
});
