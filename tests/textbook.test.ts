import { beforeEach, describe, expect, it } from 'vitest';
import { client, DEMO, setup } from './helpers';
import { MindMapSchema } from '../server/services/mindmap';
import { textbookLessons, upsertTextbookLessons } from '../server/curriculum';
import { q } from '../server/db';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { ctx = await setup(); });
const ids = () => textbookLessons().map(l => l.id);

describe('Class 8 English textbook lessons', () => {
  it('has real textbook excerpts with a source and page reference, and no invented Tamil body text', () => {
    const ls = textbookLessons(); expect(ls.length).toBeGreaterThanOrEqual(6);
    for (const l of ls) { expect(l.class_level).toBe(8); expect(l.subject_id).toBe('english'); expect(l.source).toMatch(/Samacheer Kalvi.*starts on page \d+/); expect(l.content.sections.length).toBeGreaterThan(0); for (const s of l.content.sections) { expect(s.en.length).toBeGreaterThan(20); expect(s.ta).toBeUndefined(); } }
  });
  it('is loaded by seed, and re-importing is idempotent and keeps student data', async () => {
    const n = async (sql: string) => ((await q.get<any>(ctx.db, sql))!).n;
    const before = await n("SELECT COUNT(*) n FROM lessons WHERE subject_id='english' AND class_level=8");
    const c = client(ctx.app); await c.login(DEMO.student); await c.post('/api/lessons/c8-english-u1-prose/open');
    expect(await upsertTextbookLessons(ctx.db)).toBe(ids().length);
    expect(await n("SELECT COUNT(*) n FROM lessons WHERE subject_id='english' AND class_level=8")).toBe(before);
    expect(await n("SELECT COUNT(*) n FROM lesson_progress WHERE lesson_id='c8-english-u1-prose'")).toBe(1);
  });
  it('appears in the Class 8 curriculum and opens as a lesson', async () => {
    const c = client(ctx.app); await c.login(DEMO.student);
    const cur = (await c.get('/api/curriculum?class=8')).body; const eng = cur.subjects.find((s: any) => s.id === 'english');
    expect(eng.lessons.map((l: any) => l.id)).toEqual(expect.arrayContaining(ids()));
    const r = (await c.get('/api/lessons/c8-english-u1-prose')).body; expect(r.lesson.title_en).toBe('The Nose-Jewel'); expect(r.lesson.source).toMatch(/Textbook and Educational Services/);
  });
  it('builds a valid mind map for every textbook lesson', async () => {
    const c = client(ctx.app); await c.login(DEMO.student);
    for (const id of ids()) { const r = await c.get(`/api/lessons/${id}/mindmap`); expect(r.status).toBe(200); expect(MindMapSchema.safeParse(r.body.map).success).toBe(true); expect(r.body.map.nodes.length).toBeGreaterThan(4); }
  });
  it('tutor answers from the textbook lesson and cites it', async () => {
    const c = client(ctx.app); await c.login(DEMO.student);
    const conv = (await c.post('/api/tutor/conversations', { lessonId: 'c8-english-u1-prose', lang: 'en' })).body.conversation;
    const r = await c.post(`/api/tutor/conversations/${conv.id}/messages`, { text: 'What did the male sparrow find and bring to the nest?', lang: 'en' });
    expect(r.status).toBe(200); const a = r.body.messages[1]; expect(a.meta.grounded).toBe('lesson'); expect(a.meta.sources.join(' ')).toMatch(/Samacheer Kalvi textbook/);
  });
});
