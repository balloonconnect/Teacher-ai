import { beforeEach, describe, expect, it } from 'vitest';
import { client, DEMO, setup } from './helpers';
import { q } from '../server/db';
import { build } from '../server/services/bookStructure';
import { chapterMap, itemMindMap, itemPractice, explainItem, ItemAiError } from '../server/services/itemLearn';
import { backfillChapterLessons } from '../server/services/chapterLessons';
import { MIGRATIONS } from '../server/migrations';

/* Every text below is invented for the tests (made-up Tamil words). No textbook text is used. */
const W = 'அலர் மலர்ந்த கனியும் நிலவு ஒளிரும் தென்றல் வீசும் ஆறு பாயும் வானம் தெளிந்த மலை உயர்ந்த கடல் அலையும் பறவை பாடும் வயல் விளையும் நெல் கதிரும் தோட்டம் மணக்கும் கிளை அசையும் நதி ஓடும் வெயில் காயும் மழை பெய்யும் பூமி குளிரும்'.split(' ');
const kural = (n: number) => { const w = Array.from({ length: 7 }, (_, i) => W[(n * 2 + i) % W.length]); return [w.slice(0, 4).join(' '), w.slice(4).join(' ')]; };
const meaning = (n: number) => `இது எண் ${n} ஆம் சோதனைப் பாடலின் பொருள். ${W[n]} என்பது இதன் கருத்து.`;
function kuralPage(opts: { skipMeaning?: number; misread?: Record<number, string> } = {}) {
  const out = ['சோதனைப் பாடம் ஒன்றின் அறிமுகம் இங்கே உள்ளது. இது கற்பனைச் சொற்களால் ஆனது.', '', 'அன்புடைமை'];
  for (let n = 1; n <= 10; n++) { const [a, b] = kural(n); out.push('', `${opts.misread?.[n] ?? n}. ${a}`, b); if (n !== opts.skipMeaning) out.push('', `பொருள் : ${meaning(n)}`); }
  return out.join('\n');
}
const poemPage = `கவிதைப்பேழை
சோதனைப் பூங்கா
இந்தப் பாடல் ஒரு கற்பனைக் கவிஞரால் எழுதப்பட்டது. இது சோதனைக்காக மட்டுமே உருவாக்கப்பட்ட நீண்ட அறிமுக வரிகள் ஆகும்.

மலர்ந்த கனியும் நிலவு ஒளிரும்
தென்றல் வீசும் ஆறு பாயும்

வானம் தெளிந்த மலை உயர்ந்த
கடல் அலையும் பறவை பாடும்

மழை பெய்யும் பூமி குளிரும்
வயல் விளையும் நெல் கதிரும்
- கற்பனை கவிஞர்

சொல்லும் பொருளும்
அலர் - மலர் தென்றல் - காற்று`;
const prosePage = `உரைநடை உலகம்
முதல் பகுதி
இது முதல் பத்தி. இதில் சோதனைக்கான கற்பனைச் செய்திகள் மட்டுமே உள்ளன.

இது இரண்டாம் பத்தி. இதுவும் சோதனைக்கான கற்பனைச் செய்திகள் ஆகும்.

இரண்டாம் பகுதி
இது மூன்றாம் பத்தி. இதன் வரிகள் கற்பனை மட்டுமே.`;
const qaPage = `கற்பவை கற்றபின்
சரியான விடையைத் தேர்ந்தெடுத்து எழுதுக.
1. சோதனை வினா ஒன்று எது?
அ) மலர் ஆ) கனி இ) நிலவு ஈ) தென்றல்
2. சோதனை வினா இரண்டு எது?
அ) ஆறு ஆ) வானம் இ) மலை ஈ) கடல்
சிறுவினா
1. சோதனை சிறு வினா ஒன்று எழுதுக.
2. சோதனை சிறு வினா இரண்டு எழுதுக.
நெடுவினா
1. சோதனை நெடு வினாவுக்கு விடை எழுதுக.`;
const pg = (text: string, page = 1) => [{ page, text }];

describe('Thirukkural-style chapter', () => {
  it('1+2. keeps all 10 couplets in order with numbers, each with its own textbook meaning', () => {
    const st = build(pg(kuralPage())); const ks = st.items.filter(i => i.kind === 'couplet');
    expect(st.template).toBe('kural'); expect(ks.map(k => k.number)).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 1)));
    ks.forEach((k, i) => { expect(k.lines).toEqual(kural(i + 1)); expect(k.meaning?.[0]).toContain(`எண் ${i + 1} `); expect(k.group).toBe('அன்புடைமை'); expect(k.flags).toEqual([]); });
    expect(new Set(st.items.map(i => i.id)).size).toBe(st.items.length);
  });
  it('11. flags a misread number, a missing meaning and a wrong-shaped couplet instead of guessing', () => {
    const st = build(pg(kuralPage({ skipMeaning: 3, misread: { 4: '2' } }))); const ks = st.items.filter(i => i.kind === 'couplet');
    expect(ks[3].number).toBe('4'); expect(ks[3].numberRead).toBe('2'); expect(ks[3].flags).toContain('number_misread');
    expect(ks[2].flags).toContain('meaning_missing'); expect(ks[2].meaning).toBeUndefined();
    const odd = build(pg(kuralPage().replace(kural(5)[1], 'ஒரு'))); expect(odd.items.filter(i => i.kind === 'couplet')[4].flags).toContain('shape_irregular');
    expect(build(pg('')).flags).toContain('no_structure_found');
  });
  it('2+3. every couplet has its own mind map and the chapter has a combined one', () => {
    const st = build(pg(kuralPage())); const lesson = { id: 'l', title_en: 'சோதனை', title_ta: 'சோதனை' };
    const maps = st.items.filter(i => i.kind === 'couplet').map(k => itemMindMap(lesson, st, k.id));
    expect(maps).toHaveLength(10); expect(new Set(maps.map(m => m.title_ta)).size).toBe(10);
    for (const m of maps) { const text = JSON.stringify(m.nodes); const k = st.items.find(i => `குறள் ${i.number}` === m.title_ta)!; expect(text).toContain(k.lines[0].split(' ')[0]); expect(m.nodes.some(n => n.parent === 'mean')).toBe(true); }
    const cm = chapterMap(lesson, st); expect(cm.nodes.length).toBeGreaterThan(10); expect(cm.nodes.filter(n => /^குறள் \d+:/.test(n.ta))).toHaveLength(10);
  });
  it('makes practice only from the item text and labels it as generated', () => {
    const st = build(pg(kuralPage())); const p = itemPractice(st, 'i' + (st.items.findIndex(i => i.kind === 'couplet') + 1));
    expect(p.length).toBeGreaterThan(0); for (const x of p) { expect(x.origin).toBe('generated'); expect(x.options).toHaveLength(4); expect(x.stem).toContain('_____'); expect(new Set(x.options).size).toBe(4); }
  });
});

describe('poem, prose, questions', () => {
  it('4. a poem keeps its stanzas, line breaks, title, poet and word meanings', () => {
    const st = build(pg(poemPage)); const stanzas = st.items.filter(i => i.kind === 'stanza');
    expect(st.items.find(i => i.kind === 'poem')).toMatchObject({ title: 'சோதனைப் பூங்கா', by: 'கற்பனை கவிஞர்' });
    expect(stanzas.map(s => s.lines.length)).toEqual([2, 2, 2]); expect(stanzas[0].lines[0]).toBe('மலர்ந்த கனியும் நிலவு ஒளிரும்'); expect(stanzas.map(s => s.parent)).toEqual(Array(3).fill(st.items.find(i => i.kind === 'poem')!.id));
    expect(st.items.filter(i => i.kind === 'word').map(w => w.word)).toEqual([{ term: 'அலர்', meaning: 'மலர்' }, { term: 'தென்றல்', meaning: 'காற்று' }]);
  });
  it('5. prose keeps its headings and paragraph order', () => {
    const st = build(pg(prosePage)); expect(st.items.map(i => [i.kind, i.lines[0].split(' ').slice(0, 2).join(' ')])).toEqual([['heading', 'முதல் பகுதி'], ['paragraph', 'இது முதல்'], ['paragraph', 'இது இரண்டாம்'], ['heading', 'இரண்டாம் பகுதி'], ['paragraph', 'இது மூன்றாம்']]);
  });
  it('6. questions keep original numbers, categories and options; wrong sequences are flagged', () => {
    const st = build(pg(qaPage)); const qs = st.items.filter(i => i.kind === 'question');
    expect(qs.map(x => [x.question!.category, x.number])).toEqual([['சரியான விடை', '1'], ['சரியான விடை', '2'], ['சிறுவினா', '1'], ['சிறுவினா', '2'], ['நெடுவினா', '1']]);
    expect(qs[0].question).toMatchObject({ type: 'mcq', options: ['அ) மலர்', 'ஆ) கனி', 'இ) நிலவு', 'ஈ) தென்றல்'] }); expect(qs.every(x => x.flags.length === 0)).toBe(true);
    const bad = build(pg(qaPage.replace('2. சோதனை வினா இரண்டு', '4. சோதனை வினா இரண்டு').replace('இ) மலை ஈ) கடல்', 'இ) மலை'))).items.filter(i => i.kind === 'question');
    expect(bad[1].flags).toEqual(expect.arrayContaining(['number_out_of_order', 'options_incomplete']));
  });
  it('flags OCR noise lines but keeps them in place', () => {
    const st = build(pg(`${prosePage}\n\nrz Ei ~~ |@\n`)); expect(st.items.length).toBeGreaterThanOrEqual(5);
  });
});

describe('performance and storage', () => {
  it('10. a very long chapter builds quickly and is capped', () => {
    const big = Array.from({ length: 200 }, (_, p) => ({ page: p + 1, text: prosePage })); const t0 = Date.now(); const st = build(big);
    expect(Date.now() - t0).toBeLessThan(2000); expect(st.items.length).toBeLessThanOrEqual(400); expect(st.flags).toContain('truncated');
    expect(chapterMap({ id: 'l', title_en: 'x', title_ta: 'x' }, st).nodes.length).toBeLessThanOrEqual(120);
  });
  it('has a migration for AI item text', () => { expect(MIGRATIONS.some(m => m.name === 'item_ai')).toBe(true); });
});

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { t = await setup(); });
const BOOK = 'book-s';
async function seed() {
  await q.run(t.db, "INSERT INTO textbooks(id,title,class_level,subject_id,medium,file_path,size,page_count,status,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", BOOK, 'Test Tamil', 8, 'tamil', 'Tamil', 'x', 1, 2, 'ready', 'u', new Date().toISOString());
  await q.run(t.db, 'INSERT INTO textbook_chapters(id,textbook_id,ord,title,start_page,end_page,verified,source) VALUES (?,?,?,?,?,?,?,?)', 'c1', BOOK, 1, 'சோதனை அதிகாரம்', 1, 2, 0, 'test');
  await q.run(t.db, 'INSERT INTO textbook_pages(textbook_id,page,text) VALUES (?,?,?)', BOOK, 1, kuralPage()); await q.run(t.db, 'INSERT INTO textbook_pages(textbook_id,page,text) VALUES (?,?,?)', BOOK, 2, qaPage);
  await backfillChapterLessons(t.db);
}
const as = async (email: string) => { const c = client(t.app); expect((await c.login(email)).status).toBe(200); return c; };
const LID = 'bk-book-s-1';

describe('API', () => {
  it('1+3. the lesson carries the structure; endpoints give items, per-item and chapter maps; 12. old endpoints still work', async () => {
    await seed(); const s = await as(DEMO.student);
    const st = (await s.get(`/api/lessons/${LID}/structure`)).body; expect(st.structure.items.filter((i: any) => i.kind === 'couplet')).toHaveLength(10); expect(st.aiEnabled).toBe(false);
    expect((await s.get(`/api/lessons/${LID}/chapter-map`)).body.map.nodes.length).toBeGreaterThan(10);
    const k3 = st.structure.items.find((i: any) => i.number === '3' && i.kind === 'couplet'); const it = (await s.get(`/api/lessons/${LID}/items/${k3.id}`)).body;
    expect(it.item.lines).toEqual(kural(3)); expect(it.prev).toBeTruthy(); expect(it.next).toBeTruthy(); expect(it.official.hasAnswer).toBe(false);
    expect((await s.get(`/api/lessons/${LID}/items/${k3.id}/mindmap`)).body.map.title_ta).toBe('குறள் 3');
    expect((await s.get(`/api/lessons/${LID}/mindmap`)).status).toBe(200); expect((await s.get(`/api/lessons/${LID}`)).body.lesson.content.sections.length).toBeGreaterThan(0);
    expect((await s.get(`/api/lessons/nope/structure`)).status).toBe(404); expect((await client(t.app).get(`/api/lessons/${LID}/structure`)).status).toBe(401);
  });
  it('7. with no model it says so and writes nothing; with a model the answer is stored apart and labelled AI-generated', async () => {
    await seed(); const s = await as(DEMO.student); const st = (await s.get(`/api/lessons/${LID}/structure`)).body.structure;
    const qn = st.items.find((i: any) => i.kind === 'question'); const k = st.items.find((i: any) => i.kind === 'couplet');
    expect((await s.post(`/api/lessons/${LID}/items/${k.id}/ai`, {})).status).toBe(501);
    const { buildApp } = await import('../server/app'); void buildApp;
    const llm = { name: 'mock', complete: async (a: any) => (a.user.includes('"answer"') ? JSON.stringify({ answer: 'மலர் என்பதே சரியான விடை ஆகும்.', why: 'சோதனை' }) : JSON.stringify({ simple_ta: 'இது ஒரு எளிய தமிழ் விளக்கம் ஆகும்.', central_idea: 'சோதனை மையக் கருத்து ஆகும்', keywords: ['மலர்'], word_meanings: [{ word: k.lines[0].split(' ')[0], meaning: 'சோதனை பொருள்' }, { word: 'இல்லாதசொல்', meaning: 'கற்பனை' }] })) };
    const ex = await explainItem(llm as any, k, 'explain', { chapter: 'x' });
    expect(ex.word_meanings).toHaveLength(1); // the invented word is dropped
    const ans = await explainItem(llm as any, qn, 'answer', { chapter: 'x' }); expect(ans.answer).toContain('மலர்');
    await expect(explainItem({ name: 'm', complete: async () => '{"simple_ta":"english only text here"}' } as any, k, 'explain', { chapter: 'x' })).rejects.toBeInstanceOf(ItemAiError);
    await expect(explainItem({ name: 'm', complete: async () => 'not json' } as any, k, 'explain', { chapter: 'x' })).rejects.toBeInstanceOf(ItemAiError);
  });
  it('teacher check: students see AI text as a draft; a teacher can mark it checked, students cannot, and rewriting clears the mark', async () => {
    await seed(); const s = await as(DEMO.student); const k = (await s.get(`/api/lessons/${LID}/structure`)).body.structure.items.find((i: any) => i.kind === 'couplet');
    const { itemHash } = await import('../server/services/itemLearn'); const st = (await s.get(`/api/lessons/${LID}/structure`)).body.structure;
    await q.run(t.db, 'INSERT INTO item_ai(lesson_id,item_id,kind,content,source_hash,model,created_at) VALUES (?,?,?,?,?,?,?)', LID, k.id, 'explain', JSON.stringify({ simple_ta: 'சோதனை விளக்கம்' }), itemHash(st.items.find((x: any) => x.id === k.id)), 'mock', new Date().toISOString());
    expect((await s.get(`/api/lessons/${LID}/items/${k.id}`)).body.explanation.verified).toBeNull();
    expect((await s.post(`/api/lessons/${LID}/items/${k.id}/verify`, { kind: 'explain', verified: true })).status).toBe(403);
    const tc = await as(DEMO.teacher);
    expect((await tc.post(`/api/lessons/${LID}/items/${k.id}/verify`, { kind: 'explain', verified: true })).status).toBe(200);
    expect((await s.get(`/api/lessons/${LID}/items/${k.id}`)).body.explanation.verified).toMatchObject({ by: expect.any(String) });
    expect((await tc.post(`/api/lessons/${LID}/items/${k.id}/verify`, { kind: 'answer', verified: true })).status).toBe(404);
    const rv = (await tc.get('/api/lesson-review')).body.lessons.find((l: any) => l.id === LID); expect(rv).toMatchObject({ ai_total: 1, ai_checked: 1 });
    expect((await s.get('/api/lesson-review')).status).toBe(403);
    expect((await tc.post(`/api/lessons/${LID}/items/${k.id}/verify`, { kind: 'explain', verified: false })).status).toBe(200);
    expect((await s.get(`/api/lessons/${LID}/items/${k.id}`)).body.explanation.verified).toBeNull();
  });
  it('revision packs fit their time, put missed items first, and the API checks the minutes', async () => {
    await seed(); const s = await as(DEMO.student); const st = (await s.get(`/api/lessons/${LID}/structure`)).body.structure;
    const { buildPack } = await import('../server/services/revisionPack');
    const sizes = [1, 5, 15, 30].map(m => buildPack(st, m)); for (const [k, m] of [1, 5, 15, 30].entries()) { expect(sizes[k].total).toBeLessThanOrEqual(m + 0.01); expect(sizes[k].steps.length).toBeGreaterThan(0); }
    expect(sizes[3].covered).toBeGreaterThanOrEqual(sizes[1].covered); expect(sizes[1].covered).toBeGreaterThanOrEqual(sizes[0].covered);
    expect(sizes[0].steps.every(x => x.kind === 'glance')).toBe(true); expect(sizes[2].steps.some(x => x.kind === 'quiz')).toBe(true);
    const k7 = st.items.filter((i: any) => i.kind === 'couplet')[6]; expect(buildPack(st, 1, [k7.id]).steps[0].itemId).toBe(k7.id);
    expect((await s.get(`/api/lessons/${LID}/revision-pack?minutes=5`)).body.pack.minutes).toBe(5); expect((await s.get(`/api/lessons/${LID}/revision-pack?minutes=7`)).status).toBe(400);
  });
  it('a chapter whose title says story gets the story format', async () => {
    const { lessonKindOf, formatOf } = await import('../server/services/learnTemplates');
    expect(lessonKindOf('ஒரு சிறுகதை', {})).toBe('story'); expect(lessonKindOf('Poem chapter', {})).toBeUndefined();
    expect(formatOf({ kind: 'paragraph', section: 'body', lines: ['x'], title: '' } as any, 'story')).toBe('story');
  });
  it('question hints come from the chapter text, step by step, with no AI and no answer invented', async () => {
    await seed(); const s = await as(DEMO.student); const st = (await s.get(`/api/lessons/${LID}/structure`)).body.structure;
    const qn = st.items.find((i: any) => i.kind === 'question'); const r = (await s.get(`/api/lessons/${LID}/items/${qn.id}/hints`)); expect(r.status).toBe(200);
    const h = r.body.hints; expect(h.length).toBeGreaterThan(0); expect(h.map((x: any) => x.level)).toEqual(h.map((_: any, i: number) => i + 1));
    if (h.length === 3) { expect(h[0].page).toBeGreaterThan(0); expect(h[2].lines.length).toBeGreaterThan(0); const text = st.items.flatMap((i: any) => i.lines).join('\n'); for (const l of h[2].lines) expect(text).toContain(l); }
    const k = st.items.find((i: any) => i.kind === 'couplet'); expect((await s.get(`/api/lessons/${LID}/items/${k.id}/hints`)).body.hints).toEqual([]); // only questions have hints
  });
});
