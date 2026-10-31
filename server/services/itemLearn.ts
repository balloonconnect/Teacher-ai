import { createHash } from 'node:crypto';
import { z } from 'zod';
import { LlmClient } from './llmEngine';
import { hasTamil, normalizeTamil, tamilShare } from './tamilText';
import { MAX_NODES, MapNode, MindMap, MindMapSchema } from './mindmap';
import { Item, ROLE_LABEL, Structure } from './bookStructure';
import { TEMPLATES, formatOf } from './learnTemplates';

/**
 * Learning material around ONE item of a book lesson. Two kinds, never mixed:
 *  - derived from the textbook text by rules (item mind maps, practice items): nothing is added that is not in the item;
 *  - written by a model (explanations, suggested answers): validated, stored apart, always labelled "AI-generated".
 */
export const itemHash = (it: Item) => createHash('sha1').update(JSON.stringify([it.kind, it.number, it.lines, it.meaning, it.device, it.question])).digest('hex').slice(0, 16);
const clip = (s: string, n: number) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`; };
const words = (s: string) => s.split(/\s+/).map(w => w.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '')).filter(Boolean);
export const itemLabel = (it: Item) => it.kind === 'couplet' ? `குறள் ${it.number}` : it.kind === 'stanza' ? `பாடல் ${it.number}` : it.kind === 'question' ? `வினா ${it.number ?? ''}`.trim() : it.title ?? clip(it.lines[0] ?? '', 30);
export const itemText = (it: Item) => it.lines.join('\n');

/** Mind map of one item, from the textbook text only (plus the stored AI keywords/idea when present, marked as such by the 'tip' kind). */
export function itemMindMap(lesson: { id: string; title_en: string; title_ta: string }, st: Structure, itemId: string, ai?: ItemAi | null): MindMap {
  const it = st.items.find(i => i.id === itemId); if (!it) throw new Error('unknown item');
  const nodes: MapNode[] = []; const add = (n: Omit<MapNode, 'level' | 'rev'> & { level?: MapNode['level']; rev?: boolean }) => { if (nodes.length < MAX_NODES) nodes.push({ level: 'detailed', rev: false, ...n } as MapNode); };
  const lab = itemLabel(it); add({ id: 'root', parent: null, kind: 'topic', level: 'simple', rev: true, en: clip(lab, 80), ta: clip(lab, 80) });
  const T = (s: string, n = 80) => ({ en: clip(s, n), ta: clip(s, n) });
  if (it.lines.length) {
    add({ id: 'text', parent: 'root', kind: 'branch', level: 'simple', rev: true, ...T(it.kind === 'couplet' ? 'குறள்' : 'மூலப் பாடம்', 60) });
    it.lines.slice(0, 8).forEach((l, i) => add({ id: `text-${i}`, parent: 'text', kind: 'fact', level: i < 3 ? 'simple' : 'detailed', rev: i === 0, ...T(l, 90), detail_en: clip(l, 300), detail_ta: clip(l, 300) }));
  }
  if (it.meaning?.length) {
    add({ id: 'mean', parent: 'root', kind: 'branch', level: 'simple', rev: true, ...T('பாடநூல் பொருள்', 60) });
    const parts = it.meaning.join(' ').split(/(?<=[.!?।])\s+/).filter(Boolean).slice(0, 4);
    (parts.length ? parts : it.meaning).forEach((m, i) => add({ id: `mean-${i}`, parent: 'mean', kind: 'definition', rev: i === 0, ...T(m, 90), detail_en: clip(m, 300), detail_ta: clip(m, 300) }));
  }
  if (it.device) { add({ id: 'dev', parent: 'root', kind: 'branch', level: 'detailed', rev: true, ...T('அணி', 40) }); add({ id: 'dev-0', parent: 'dev', kind: 'fact', rev: true, ...T(it.device, 60) }); }
  if (it.kind === 'couplet' && it.group) { add({ id: 'grp', parent: 'root', kind: 'branch', level: 'detailed', rev: false, ...T('அதிகாரம்', 40) }); add({ id: 'grp-0', parent: 'grp', kind: 'fact', ...T(it.group, 60) }); }
  if (ai) {
    if (ai.central_idea) { add({ id: 'idea', parent: 'root', kind: 'branch', level: 'simple', rev: true, ...T('AI: மையக் கருத்து', 60) }); add({ id: 'idea-0', parent: 'idea', kind: 'tip', rev: true, ...T(ai.central_idea, 90), detail_en: clip(ai.central_idea, 300), detail_ta: clip(ai.central_idea, 300) }); }
    if (ai.keywords?.length) { add({ id: 'kw', parent: 'root', kind: 'branch', level: 'simple', rev: true, ...T('AI: முக்கிய சொற்கள்', 60) }); ai.keywords.slice(0, 6).forEach((k, i) => add({ id: `kw-${i}`, parent: 'kw', kind: 'tip', rev: true, ...T(k, 40) })); }
  }
  return MindMapSchema.parse({ lessonId: lesson.id, title_en: clip(lab, 80), title_ta: clip(lab, 80), source: nodes.length > 1 ? 'lesson' : 'general', defaultMode: 'detailed', nodes,
    sourceNote: ai ? 'Branches headed “AI:” were written by the AI; all other branches are the textbook’s own text.' : 'Built only from the textbook text of this item.' });
}

/** One map for the whole chapter: a branch for each part of the book (in book order) and one short leaf per item. */
export function chapterMap(lesson: { id: string; title_en: string; title_ta: string }, st: Structure): MindMap {
  const nodes: MapNode[] = []; const add = (n: Omit<MapNode, 'level' | 'rev'> & { level?: MapNode['level']; rev?: boolean }) => { if (nodes.length < MAX_NODES) nodes.push({ level: 'detailed', rev: false, ...n } as MapNode); };
  add({ id: 'root', parent: null, kind: 'topic', level: 'simple', rev: true, en: clip(lesson.title_en, 80), ta: clip(lesson.title_ta, 80) });
  const byId = new Map(st.items.map(i => [i.id, i])); const perSeg = Math.max(2, Math.floor((MAX_NODES - st.segments.length * 2 - 1) / Math.max(1, st.segments.length)));
  st.segments.forEach((s, si) => {
    const [en, ta] = ROLE_LABEL[s.role]; const id = `s${si}`; add({ id, parent: 'root', kind: 'branch', level: 'simple', rev: true, en, ta });
    const its = s.itemIds.map(x => byId.get(x)!).filter(i => i && !['heading'].includes(i.kind) && !(i.kind === 'poem' && !i.lines.length));
    its.slice(0, perSeg).forEach((it, k) => { const t = `${['couplet', 'stanza', 'question'].includes(it.kind) ? itemLabel(it) + ': ' : ''}${it.word ? it.word.term : clip(it.lines[0] ?? it.title ?? '', 50)}`; add({ id: `${id}-${k}`, parent: id, kind: it.kind === 'word' ? 'definition' : 'fact', level: k < 3 ? 'simple' : 'detailed', rev: k < 3, en: clip(t, 70), ta: clip(t, 70), detail_en: clip(itemText(it), 300) || undefined, detail_ta: clip(itemText(it), 300) || undefined }); });
  });
  return MindMapSchema.parse({ lessonId: lesson.id, title_en: lesson.title_en, title_ta: lesson.title_ta, source: nodes.length > 1 ? 'lesson' : 'general', defaultMode: nodes.length > 40 ? 'simple' : 'detailed', nodes,
    sourceNote: 'Built only from the textbook’s own headings and items, in the book’s order.' });
}

/** Rule-made practice from the textbook text of one item. Labelled "generated from the textbook"; the answer is the hidden word, which is in the text. */
export type Practice = { id: string; type: 'fill' | 'mcq'; stem: string; options: string[]; correct: number; origin: 'generated'; note: string };
export function itemPractice(st: Structure, itemId: string, max = 3): Practice[] {
  const it = st.items.find(i => i.id === itemId); if (!it || !['couplet', 'stanza', 'paragraph'].includes(it.kind)) return [];
  const text = itemText(it).replace(/\n/g, ' '); const own = words(text).filter(w => [...w].length >= 4);
  const pool = [...new Set(st.items.flatMap(i => words(itemText(i))).filter(w => [...w].length >= 4 && hasTamil(w)))];
  const out: Practice[] = []; const seed = parseInt(createHash('sha1').update(it.id + text).digest('hex').slice(0, 6), 16);
  const picks = [...new Set(own)]; for (let n = 0; n < Math.min(max, picks.length); n++) {
    const ans = picks[(seed + n * 3) % picks.length]; if (out.some(o => o.options[o.correct] === ans)) continue;
    const dist = pool.filter(w => w !== ans && !text.includes(w)).sort((a, b) => ((a.length * 7 + seed) % 13) - ((b.length * 7 + seed) % 13)).slice(0, 3); if (dist.length < 3) continue;
    const opts = [...dist]; const at = (seed + n) % 4; opts.splice(at, 0, ans);
    out.push({ id: `${it.id}-p${n}`, type: 'mcq', stem: text.replace(ans, '_____'), options: opts, correct: at, origin: 'generated', note: 'Made from the textbook text by the app. Not a textbook question.' });
  }
  return out;
}

/* ---------- model-written explanations ---------- */
const Str = (n: number) => z.string().max(n);
export const QuizSchema = z.object({ question: Str(300), options: z.array(Str(160)).min(2).max(4), correct: z.number().int().min(0).max(3), hint: Str(240).optional(), why: Str(500).optional() })
  .refine(q => q.correct < q.options.length && new Set(q.options.map(o => o.trim())).size === q.options.length, 'quiz options must be distinct and the answer must be one of them');
export const ItemAiSchema = z.object({
  word_meanings: z.array(z.object({ word: Str(60), meaning: Str(200) })).max(12).default([]),
  simple_ta: Str(1200).optional(), detailed: Str(1600).optional(), central_idea: Str(300).optional(), moral: Str(300).optional(), takeaway: Str(300).optional(), example: Str(500).optional(), real_life: Str(500).optional(),
  keywords: z.array(Str(40)).max(8).default([]), memory_tip: Str(300).optional(), exam_notes: Str(600).optional(), imagery: Str(400).optional(),
  line_notes: z.array(z.object({ line: Str(200), note: Str(300) })).max(16).default([]), summary: Str(700).optional(), devices: z.array(Str(160)).max(6).default([]),
  key_points: z.array(Str(240)).max(10).default([]), sequence: z.array(Str(240)).max(10).default([]), cause_effect: z.array(Str(240)).max(8).default([]),
  characters: z.array(z.object({ name: Str(60), trait: Str(200) })).max(10).default([]), types: z.array(Str(200)).max(8).default([]), examples: z.array(Str(240)).max(8).default([]), compare: Str(500).optional(),
  mistakes: z.array(z.object({ wrong: Str(160), right: Str(160), why: Str(300).optional() })).max(6).default([]), structure: z.array(Str(200)).max(10).default([]), steps: z.array(Str(240)).max(10).default([]), definition: Str(500).optional(),
  answer: Str(1200).optional(), why: Str(500).optional(), english: Str(600).optional(), quiz: QuizSchema.optional(),
});
export type ItemAi = z.infer<typeof ItemAiSchema>;
export class ItemAiError extends Error { constructor(m: string, public status = 502) { super(m); } }
export type Lang = 'ta' | 'en';
const SYS = 'You are Karikai AI\'s expert Tamil teacher for school students. Explain ONLY the text you are given. Preserve the intended meaning, names, facts and order. Do not change, correct or rewrite the source text. Do not add facts about it that you cannot see in it (no outside biography, no invented story details, no invented answers). If you are unsure of a meaning, leave that part out. The text may come from a scanned page and contain reading errors: never guess a garbled word, and never describe pictures, diagrams or tables you cannot see. Keep everything safe and suitable for a school child. Fill only the parts that really apply; use empty lists for the rest. Reply with one JSON object and nothing else.';
const parseJson = (raw: string) => { const m = raw.replace(/^```[a-z]*\n?|\n?```$/gi, '').trim(); const a = m.indexOf('{'), b = m.lastIndexOf('}'); if (a < 0 || b < a) throw new ItemAiError('The model did not return a usable answer. Nothing was saved.', 422); try { return JSON.parse(m.slice(a, b + 1)); } catch { throw new ItemAiError('The model did not return a usable answer. Nothing was saved.', 422); } };
export const aiKind = (mode: 'explain' | 'answer', lang: Lang) => (mode === 'answer' ? 'answer' : lang === 'en' ? 'explain_en' : 'explain');

export async function explainItem(client: LlmClient, it: Item, mode: 'explain' | 'answer', ctx: { chapter: string; signal?: AbortSignal; lang?: Lang; classLevel?: number; lessonKind?: 'story' | 'prose' }): Promise<ItemAi> {
  const lang = ctx.lang ?? 'ta'; const src = normalizeTamil(itemText(it)); if (!src.trim()) throw new ItemAiError('This item has no text to explain.', 400);
  const tpl = mode === 'answer' ? TEMPLATES.exercise : TEMPLATES[formatOf(it, ctx.lessonKind)];
  const langRule = lang === 'en' ? 'Write every explanation in clear English. Keep quoted Tamil words and lines exactly as in the text.' : 'Write every explanation in natural, correct Tamil script.';
  const user = `${tpl.task}\n${langRule}${ctx.classLevel ? `\nThe student is in Class ${ctx.classLevel}; match vocabulary and depth to that class.` : ''}\nChapter: ${ctx.chapter}\nItem: ${itemLabel(it)}${it.question ? ` (question, ${it.question.category ?? it.question.type}${it.question.options?.length ? '; options: ' + it.question.options.join(' | ') : ''})` : ''}\n${it.meaning?.length ? `The textbook's own meaning: ${it.meaning.join(' ')}\n` : ''}Text:\n---\n${src}\n---\nReturn JSON of this shape (omit parts that do not apply):\n${tpl.shape}`;
  let raw: string; try { raw = await client.complete({ system: SYS, user, maxTokens: 2200, signal: ctx.signal }); } catch { throw new ItemAiError('The AI service could not be reached. Please try again.', 502); }
  const j = parseJson(raw); if (j && typeof j === 'object' && j.quiz) { const qz = QuizSchema.safeParse(j.quiz); if (!qz.success) delete j.quiz; } // a bad quiz is dropped; the rest of the answer is still useful
  const parsed = ItemAiSchema.safeParse(j); if (!parsed.success) throw new ItemAiError('The model’s answer was not in the expected form. Nothing was saved.', 422);
  const ai = parsed.data;
  // every quoted word or line must really be in the item; every Tamil-mode field must be Tamil
  ai.word_meanings = ai.word_meanings.filter(w => src.includes(w.word) && w.meaning.trim());
  ai.line_notes = ai.line_notes.filter(l => src.includes(l.line.trim()) && l.note.trim());
  ai.characters = ai.characters.filter(c => src.includes(c.name));
  if (lang === 'ta') for (const f of ['simple_ta', 'detailed', 'central_idea', 'summary', 'moral', 'takeaway', 'answer', 'real_life'] as const) { const v = ai[f]; if (v && tamilShare(v) < 0.5) throw new ItemAiError('Part of the model’s answer was not in Tamil, so nothing was saved.', 422); }
  else for (const f of ['simple_ta', 'detailed', 'summary', 'answer'] as const) { const v = ai[f]; if (v && tamilShare(v) > 0.5) throw new ItemAiError('Part of the model’s answer was not in English, so nothing was saved.', 422); }
  if (mode === 'answer' && !ai.answer) throw new ItemAiError('The model gave no answer. Nothing was saved.', 422);
  if (mode === 'explain' && !(ai.simple_ta || ai.summary || ai.key_points.length || ai.word_meanings.length || ai.line_notes.length || ai.definition || ai.steps.length || ai.structure.length)) throw new ItemAiError('The model gave no explanation. Nothing was saved.', 422);
  return ai;
}

/**
 * Three guided hints for a textbook question, built from the chapter's own text (no AI): where to look, which words matter, and the passage itself.
 * They never invent an answer; the last hint shows the textbook's own lines that best match the question.
 */
export type Hint = { level: 1 | 2 | 3; en: string; ta: string; page?: number; lines?: string[] };
export function questionHints(st: Structure, itemId: string): Hint[] {
  const q = st.items.find(i => i.id === itemId); if (!q || q.kind !== 'question') return [];
  const qWords = new Set(words(itemText(q)).filter(w => [...w].length >= 3).map(w => w.toLowerCase()));
  let best: { it: Item; score: number } | null = null;
  for (const it of st.items) {
    if (it.id === q.id || it.kind === 'question' || it.kind === 'heading' || !it.lines.length) continue;
    const ws = new Set(words(itemText(it)).filter(w => [...w].length >= 3).map(w => w.toLowerCase())); let score = 0; qWords.forEach(w => { if (ws.has(w)) score++; });
    if (score > 0 && (!best || score > best.score)) best = { it, score };
  }
  if (!best) return [{ level: 1, en: 'Read the question slowly and underline the key words. Then look through the chapter for those words.', ta: 'வினாவை மெதுவாகப் படித்து முக்கிய சொற்களுக்குக் கீழ் கோடிடுங்கள். பிறகு பாடத்தில் அந்தச் சொற்களைத் தேடுங்கள்.' }];
  const p = best.it; const heading = st.segments.find(s => s.itemIds.includes(p.id))?.heading ?? '';
  const shared = [...new Set(words(itemText(p)).filter(w => qWords.has(w.toLowerCase())))].slice(0, 4);
  return [
    { level: 1, en: `Look at page ${p.page}${heading ? ` — “${heading}”` : ''}. The answer is in that part of the chapter.`, ta: `பக்கம் ${p.page}${heading ? ` — “${heading}”` : ''} பகுதியைப் பாருங்கள். விடை அந்தப் பகுதியில் உள்ளது.`, page: p.page },
    { level: 2, en: `Find these words in the text and read the lines around them: ${shared.join(', ')}.`, ta: `இந்தச் சொற்களை உரையில் தேடி, அவற்றைச் சுற்றியுள்ள வரிகளைப் படியுங்கள்: ${shared.join(', ')}.`, page: p.page },
    { level: 3, en: 'These lines from the textbook help most. Use them to write the answer in your own words.', ta: 'பாடநூலின் இந்த வரிகள் மிகவும் உதவும். இவற்றைக் கொண்டு விடையை உங்கள் சொற்களில் எழுதுங்கள்.', page: p.page, lines: p.lines.slice(0, 6) },
  ];
}
