import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * Mind maps are built deterministically from the lesson content already stored in the app.
 * Nothing is invented: every node's text comes from the lesson. (An AI-generated map would have to pass the
 * same MindMapSchema before it could be shown.)
 */
export const NODE_KINDS = ['topic', 'branch', 'definition', 'formula', 'example', 'fact', 'tip', 'mistake'] as const;
export const MAX_NODES = 120;
const Text = z.string().trim().min(1).max(400);
export const NodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  parent: z.string().regex(/^[a-z0-9-]{1,40}$/).nullable(),
  kind: z.enum(NODE_KINDS),
  level: z.enum(['simple', 'detailed']),   // simple map shows only 'simple' nodes
  rev: z.boolean(),                         // shown in Quick Revision mode
  en: Text, ta: Text,
  detail_en: Text.optional(), detail_ta: Text.optional(),
});
export const MindMapSchema = z.object({
  lessonId: z.string(), title_en: Text, title_ta: Text, source: z.enum(['lesson', 'general']), sourceNote: z.string().max(300),
  defaultMode: z.enum(['simple', 'detailed', 'revision']),
  nodes: z.array(NodeSchema).min(1).max(MAX_NODES),
}).superRefine((m, ctx) => {
  const ids = new Set<string>(); let roots = 0;
  for (const n of m.nodes) { if (ids.has(n.id)) ctx.addIssue({ code: 'custom', message: `duplicate id ${n.id}` }); ids.add(n.id); if (n.parent === null) roots++; }
  if (roots !== 1) ctx.addIssue({ code: 'custom', message: 'exactly one root required' });
  for (const n of m.nodes) if (n.parent !== null && !ids.has(n.parent)) ctx.addIssue({ code: 'custom', message: `unknown parent for ${n.id}` });
  // no cycles: walk each node up at most MAX_NODES steps
  const by = new Map(m.nodes.map(n => [n.id, n]));
  for (const n of m.nodes) { let c: typeof n | undefined = n, i = 0; while (c && c.parent !== null && i++ <= MAX_NODES) c = by.get(c.parent); if (i > MAX_NODES) ctx.addIssue({ code: 'custom', message: 'cycle detected' }); }
});
export type MindMap = z.infer<typeof MindMapSchema>;
export type MapNode = z.infer<typeof NodeSchema>;

const clip = (s: string, n: number) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`; };
const sentences = (s: string) => String(s).replace(/\s+/g, ' ').split(/(?<=[.!?।])\s+(?=\S)/).map(x => x.trim()).filter(Boolean);
const FORMULA_RE = /[=+\-×÷*/]\s*\d|\d\s*[x×=]|=/;
const FORMULA = { test: (t: string) => t.length <= 40 && FORMULA_RE.test(t) };

const cache = new Map<string, MindMap>();

/** Builds (and caches by content hash) the map for a lesson row. Throws if the result does not validate. */
export function buildMindMap(lesson: { id: string; title_en: string; title_ta: string; content: any; source?: string }): MindMap {
  const sample = !lesson.source || lesson.source.startsWith('Sample');
  const key = `${lesson.id}:${createHash('sha1').update(JSON.stringify(lesson.content) + (lesson.source ?? '') + lesson.title_en + lesson.title_ta).digest('hex')}`;
  const hit = cache.get(key); if (hit) return hit;
  const c = lesson.content ?? {}; const nodes: MapNode[] = [];
  const add = (n: Omit<MapNode, 'level' | 'rev'> & { level?: MapNode['level']; rev?: boolean }) => { if (nodes.length < MAX_NODES) nodes.push({ level: 'detailed', rev: false, ...n } as MapNode); };
  add({ id: 'root', parent: null, kind: 'topic', level: 'simple', rev: true, en: clip(lesson.title_en, 80), ta: clip(lesson.title_ta, 80) });

  const obj = c.objectives; if (obj?.en?.length) {
    add({ id: 'goals', parent: 'root', kind: 'branch', level: 'simple', rev: true, en: 'What you will learn', ta: 'இதில் நீங்கள் கற்பது' });
    obj.en.slice(0, 5).forEach((e: string, i: number) => add({ id: `goal-${i}`, parent: 'goals', kind: 'fact', rev: true, en: clip(e, 70), ta: clip(obj.ta?.[i] ?? e, 80), detail_en: clip(e, 300), detail_ta: clip(obj.ta?.[i] ?? e, 300) }));
  }
  (c.sections ?? []).slice(0, 8).forEach((s: any, i: number) => {
    const id = `sec-${i}`; add({ id, parent: 'root', kind: 'branch', level: 'simple', rev: true, en: clip(s.h_en, 60), ta: clip(s.h_ta, 70), detail_en: clip(s.en, 400), detail_ta: clip(s.ta || s.en, 400) });
    const se = sentences(s.en), st = sentences(s.ta || '');
    if (se.length > 1) se.slice(0, 5).forEach((x, j) => {
      const isF = FORMULA.test(x); const aligned = !!s.ta && se.length === st.length;
      add({ id: `${id}-${j}`, parent: id, kind: isF ? 'formula' : 'fact', rev: isF || j === 0, en: clip(x, 80), ta: clip(aligned ? st[j] : (s.ta ?? x), 90), detail_en: clip(x, 300), detail_ta: clip(aligned ? st[j] : (s.ta ?? x), 300) });
    });
  });
  if (c.vocab?.length) {
    add({ id: 'vocab', parent: 'root', kind: 'branch', level: 'simple', rev: true, en: 'Key words', ta: 'முக்கிய சொற்கள்' });
    c.vocab.slice(0, 8).forEach((v: any, i: number) => add({ id: `vocab-${i}`, parent: 'vocab', kind: 'definition', level: i < 2 ? 'simple' : 'detailed', rev: true, en: clip(v.en, 40), ta: clip(v.ta, 40), detail_en: clip(`${v.en}: ${v.meaning}${v.example ? ` (e.g. ${v.example})` : ''}`, 300), detail_ta: clip(`${v.ta} — ${v.meaning}${v.example ? ` (எ.கா. ${v.example})` : ''}`, 300) }));
  }
  if (c.examples?.length) {
    add({ id: 'ex', parent: 'root', kind: 'branch', level: 'simple', rev: false, en: 'Worked example', ta: 'எடுத்துக்காட்டு' });
    c.examples.slice(0, 3).forEach((e: any, i: number) => {
      add({ id: `ex-${i}`, parent: 'ex', kind: 'example', rev: true, en: clip(e.q_en, 70), ta: clip(e.q_ta, 80), detail_en: clip((e.steps_en ?? []).join(' → '), 400), detail_ta: clip((e.steps_ta ?? []).join(' → '), 400) });
      (e.steps_en ?? []).slice(0, 5).forEach((st: string, j: number) => add({ id: `ex-${i}-${j}`, parent: `ex-${i}`, kind: FORMULA.test(st) ? 'formula' : 'fact', rev: false, en: clip(st, 70), ta: clip(e.steps_ta?.[j] ?? st, 80) }));
    });
  }
  if (c.realLife?.en) { add({ id: 'real', parent: 'root', kind: 'branch', level: 'detailed', rev: false, en: 'In real life', ta: 'நிஜ வாழ்வில்' }); add({ id: 'real-0', parent: 'real', kind: 'example', rev: false, en: clip(c.realLife.en, 90), ta: clip(c.realLife.ta ?? c.realLife.en, 100), detail_en: clip(c.realLife.en, 400), detail_ta: clip(c.realLife.ta ?? c.realLife.en, 400) }); }
  if (c.mistakes?.length) {
    add({ id: 'mist', parent: 'root', kind: 'branch', level: 'detailed', rev: true, en: 'Common mistakes', ta: 'பொதுவான தவறுகள்' });
    c.mistakes.slice(0, 4).forEach((m: any, i: number) => add({ id: `mist-${i}`, parent: 'mist', kind: 'mistake', rev: true, en: clip(m.en, 80), ta: clip(m.ta, 90), detail_en: clip(m.en, 300), detail_ta: clip(m.ta, 300) }));
  }
  const detailedCount = nodes.length;
  const map: MindMap = {
    lessonId: lesson.id, title_en: lesson.title_en, title_ta: lesson.title_ta, source: nodes.length > 1 ? 'lesson' : 'general',
    sourceNote: nodes.length > 1 ? (sample ? 'Built only from this lesson’s content. The lessons in this prototype are sample content, not official textbook text.' : 'Built only from the short textbook excerpt shown in this lesson (Samacheer Kalvi). It is not a map of the whole textbook lesson.') : 'This lesson has no detailed content yet, so only the topic is shown.',
    defaultMode: detailedCount > 40 ? 'simple' : 'detailed', nodes,
  };
  const ok = MindMapSchema.parse(map); cache.set(key, ok); return ok;
}
export const _clearMindMapCache = () => cache.clear();
