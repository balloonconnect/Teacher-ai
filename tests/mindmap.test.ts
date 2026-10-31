import { beforeEach, describe, expect, it } from 'vitest';
import { client, DEMO, setup } from './helpers';
import { MindMapSchema, buildMindMap } from '../server/services/mindmap';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { ctx = await setup(); });
const L = 'c8-maths-linear';

describe('mind map service', () => {
  it('builds a valid tree from lesson content only', () => {
    const m = buildMindMap({ id: 'x', title_en: 'T', title_ta: 'த', content: { sections: [{ h_en: 'A', h_ta: 'அ', en: 'x = 1. y = 2.', ta: 'x = 1. y = 2.' }], vocab: [{ en: 'Var', ta: 'மாறி', meaning: 'unknown' }] } });
    expect(MindMapSchema.safeParse(m).success).toBe(true); expect(m.nodes[0].parent).toBeNull(); expect(m.nodes.some(n => n.kind === 'definition')).toBe(true);
  });
  it('rejects malformed maps (cycle, duplicate id, unknown parent, two roots)', () => {
    const n = (id: string, parent: string | null) => ({ id, parent, kind: 'fact', level: 'simple', rev: false, en: 'a', ta: 'அ' });
    const base = { lessonId: 'x', title_en: 'T', title_ta: 'த', source: 'lesson', sourceNote: '', defaultMode: 'simple' };
    expect(MindMapSchema.safeParse({ ...base, nodes: [n('a', null), n('b', 'zz')] }).success).toBe(false);
    expect(MindMapSchema.safeParse({ ...base, nodes: [n('a', null), n('a', 'a')] }).success).toBe(false);
    expect(MindMapSchema.safeParse({ ...base, nodes: [n('a', null), n('b', null)] }).success).toBe(false);
    expect(MindMapSchema.safeParse({ ...base, nodes: [n('a', null), n('b', 'c'), n('c', 'b')] }).success).toBe(false);
  });
  it('gives a lesson with no detail a topic-only map', () => {
    const m = buildMindMap({ id: 'e', title_en: 'T', title_ta: 'த', content: {} }); expect(m.nodes).toHaveLength(1); expect(m.source).toBe('general');
  });
});

describe('mind map API', () => {
  it('returns the lesson map with Tamil and English labels and the right context', async () => {
    const c = client(ctx.app); await c.login(DEMO.student);
    const r = await c.get(`/api/lessons/${L}/mindmap`); expect(r.status).toBe(200);
    expect(r.body.map.lessonId).toBe(L); expect(r.body.classLevel).toBe(8); expect(r.body.map.nodes.length).toBeGreaterThan(8);
    expect(r.body.map.nodes.every((n: any) => n.en && n.ta)).toBe(true); expect(MindMapSchema.safeParse(r.body.map).success).toBe(true);
  });
  it('uses simple mode by default for young classes', async () => {
    const c = client(ctx.app); await c.login(DEMO.student);
    expect((await c.get('/api/lessons/c3-maths-intro/mindmap')).body.map.defaultMode).toBe('simple');
  });
  it('saves understood/revision marks per student and drops unknown ids', async () => {
    const a = client(ctx.app); await a.login(DEMO.student);
    const ids = (await a.get(`/api/lessons/${L}/mindmap`)).body.map.nodes.map((n: any) => n.id);
    const put = await a.put(`/api/lessons/${L}/mindmap/state`, { understood: [ids[1], 'bogus'], revision: [ids[2], ids[1]] });
    expect(put.status).toBe(200); expect(put.body.understood).toEqual([ids[1]]); expect(put.body.revision).toEqual([ids[2]]);
    expect((await a.get(`/api/lessons/${L}/mindmap`)).body.state.revision).toEqual([ids[2]]);
    expect((await a.get('/api/mindmaps/recent')).body.recent[0]).toMatchObject({ lessonId: L, understood: 1, revision: 1 });
    const other = client(ctx.app); await other.login(DEMO.arun);
    expect((await other.get(`/api/lessons/${L}/mindmap`)).body.state.understood).toEqual([]);
  });
  it('requires a student session and a real lesson', async () => {
    expect((await client(ctx.app).get(`/api/lessons/${L}/mindmap`)).status).toBe(401);
    const t = client(ctx.app); await t.login(DEMO.teacher); expect((await t.get(`/api/lessons/${L}/mindmap`)).status).toBe(403);
    const s = client(ctx.app); await s.login(DEMO.student); expect((await s.get('/api/lessons/nope/mindmap')).status).toBe(404);
    expect((await s.put(`/api/lessons/${L}/mindmap/state`, { understood: 'x', revision: [] })).status).toBe(400);
  });
});
