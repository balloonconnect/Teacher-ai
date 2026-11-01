/**
 * Step-by-step teaching engine for the voice tutor.
 *
 * `ruleEngine` is the default and needs no AI model: it solves linear equations, teaches from the student's own class
 * lessons and class textbook pages, asks check questions, evaluates answers and gives progressive hints. It is deliberately
 * honest: when it has no verified source it says so instead of inventing curriculum content.
 * To use a real LLM or a local model, implement `TeachEngine` (same event stream) and pass it to `voiceRoutes`.
 */
import { DB, q } from '../db';
import { gradeAnswer } from './grading';
import { solveLinearFromText, Solution, fstr } from './solver';
import { topPassages, tokens } from './retrieval';
import { VKey, Visual, canSimplify, describeVisual, detectKey, labelMeaning } from '../../shared/visuals';
import { Bi, Lang, chapterSample, lessonPassages, parseGiven, hintFor, textbookHits } from './tutor';

export type Mode = 'teach' | 'explain' | 'hint' | 'practice' | 'revise';
export const MODES: Mode[] = ['teach', 'explain', 'hint', 'practice', 'revise'];
export type Check = { kind: 'ack' } | { kind: 'cloze'; answer: string; blank: string } | { kind: 'numeric'; answer: string; variable: string };
export type TStep = { n: number; en: string; ta: string; check?: Check };
export type Plan = { topic: Bi; grounded: 'lesson' | 'textbook' | 'solver' | 'none'; sources: string[]; refs: { bookId: string; page: number }[]; steps: TStep[]; solution?: { variable: string; answer: string } };
export type State = {
  mode: Mode; plan: Plan | null; idx: number; awaiting: 'check' | 'practice' | 'continue' | null; wrong: number; hintLevel: number;
  quiz: { qid: string; wrong: number; asked: string[]; correct: number; total: number; limit: number } | null; done: boolean;
  /** The diagram currently on screen, so follow-ups like “explain this diagram” know what the student means. */
  visual?: VKey;
  /** Set when the student chose a chapter: the tutor then teaches and answers only from these pages. */
  chapter?: { id: string; bookId: string; title: string; start: number; end: number };
};
export const initialState = (mode: Mode): State => ({ mode, plan: null, idx: 0, awaiting: null, wrong: 0, hintLevel: 0, quiz: null, done: false });
export type Ctx = { db: DB; userId: string; sessionId?: string; classLevel: number; lang: Lang; subjectId: string | null; lessonId: string | null; state: State };
export type TurnInput = { text: string; action?: string };
/** `chunk` = something to show and speak; `done` carries the new state. */
export type TurnEvent =
  | { type: 'ack' }
  | { type: 'chunk'; kind: 'step' | 'check' | 'feedback' | 'hint' | 'info' | 'question' | 'summary' | 'notice'; en: string; ta: string; say: Bi; step?: number; total?: number; math?: string[]; grounded?: string; sources?: string[]; refs?: { bookId: string; page: number }[]; vis?: VKey }
  | { type: 'visual'; at: number; visuals: Visual[] }
  | { type: 'done'; state: State; meta: { grounded: string; completed?: boolean } };
export interface TeachEngine { name: string; mock: boolean; turn(ctx: Ctx, input: TurnInput): AsyncGenerator<TurnEvent>; }

const J = (s: string) => JSON.parse(s);
const bi = (en: string, ta: string): Bi => ({ en, ta });

/** Turn written maths into something a person would say. The written equation stays on screen. */
export function speakable(s: string, lang: 'en' | 'ta'): string {
  const en = lang === 'en';
  let t = s.replace(/[−–]/g, '-').replace(/\*/g, '×');
  t = t.replace(/(\w|\))\s*\^\s*2\b/g, en ? '$1 squared' : '$1 இன் வர்க்கம்').replace(/²/g, en ? ' squared' : ' இன் வர்க்கம்');
  t = t.replace(/(\d+)\s*\/\s*(\d+)/g, en ? '$1 over $2' : '$1 மேல் $2');
  t = t.replace(/\s*=\s*/g, en ? ' equals ' : ' சமம் ').replace(/\s*\+\s*/g, en ? ' plus ' : ' கூட்டல் ').replace(/\s*×\s*/g, en ? ' times ' : ' பெருக்கல் ').replace(/\s*÷\s*/g, en ? ' divided by ' : ' வகுத்தல் ');
  t = t.replace(/(^|[\s(])-(?=\d|[a-z])/g, en ? '$1minus ' : '$1கழித்தல் ').replace(/\s-\s/g, en ? ' minus ' : ' கழித்தல் ');
  t = t.replace(/(\d)([a-z])\b/g, '$1 $2').replace(/[✓]/g, en ? 'correct' : 'சரி').replace(/[✗]/g, en ? 'not equal' : 'சமம் இல்லை').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  return t;
}
const sayOf = (b: Bi): Bi => bi(speakable(b.en, 'en'), speakable(b.ta, 'ta'));
export const equationsIn = (s: string) => (s.match(/[0-9a-z()+\-−×÷/.\s]*[a-z0-9)]\s*=\s*[0-9a-z(+\-−.][0-9a-z()+\-−×÷/.\s]*/gi) ?? []).map(x => x.trim()).filter(x => /\d|[a-z]/i.test(x) && x.length < 60);

const YES = /^(yes|yeah|yep|ok|okay|sure|got it|understood|i understand|next|continue|go on|ready|ஆம்|சரி|புரிந்தது|புரிந்துவிட்டது|அடுத்து|தொடர்|தொடரு)\b/i;
const NO = /^(no|nope|not really|i don.t|dont|i do not|don.t understand|confused|இல்லை|புரியவில்லை|புரியல)/i;

function praise(n: number): Bi { return [bi('Correct — well done!', 'சரியான விடை — பாராட்டுகள்!'), bi('Yes, that is right. Nice work!', 'ஆம், சரிதான். அருமை!'), bi('Exactly right!', 'மிகச் சரி!')][n % 3]; }

/** Hide one meaningful word of a sentence so the student can recall it. */
export function makeCloze(en: string, ta: string, lang: Lang): Check | undefined {
  const useTa = lang === 'ta'; const src = useTa ? ta : en;
  const words = (src.match(useTa ? /[஀-௿]{4,}/g : /[A-Za-z]{6,}/g) ?? []).filter(w => !/^(example|because|between|following)$/i.test(w));
  if (!words.length) return undefined;
  const answer = words.sort((a, b) => b.length - a.length)[0];
  return { kind: 'cloze', answer, blank: src.replace(answer, '_____') };
}

export function planFromSolution(sol: Solution, _text: string): Plan {
  const steps: TStep[] = sol.steps.map((s, i) => ({ n: i + 1, en: s.en, ta: s.ta, check: { kind: 'ack' as const } }));
  if (sol.x) steps[steps.length - 1].check = undefined;
  const answer = sol.x ? fstr(sol.x) : '';
  return { topic: bi(`Solving ${sol.lhsStr} = ${sol.rhsStr}`, `${sol.lhsStr} = ${sol.rhsStr} ஐத் தீர்த்தல்`), grounded: 'solver', sources: ['Worked out by the equation solver (not from a textbook)'], refs: [], steps, solution: answer ? { variable: sol.variable, answer } : undefined };
}

const CMD = new Set('revise revision teach explain start begin topic lesson chapter quiz practice go again please tell about தொடங்கு தொடங்கலாம் ஆரம்பி ஆரம்பிக்கலாம் சொல் சொல்லு கற்பி கற்றுக்கொடு விளக்கு பாடம் பாடத்தை மீண்டும் மறுபடி திருப்பு தேர்வு பயிற்சி'.split(' '));
/** “Revise this topic”, “start”, “teach me” and so on name no subject matter: inside a lesson they mean the lesson itself. */
export const isGeneric = (t: string) => !tokens(t).filter(w => !CMD.has(w)).length;

async function planFromLesson(db: DB, ctx: Ctx, text: string): Promise<Plan | null> {
  const rows = ctx.lessonId ? (await q.all<any>(db, "SELECT * FROM lessons WHERE id=?", ctx.lessonId)) : [];
  const l = rows[0]; const all = await lessonPassages(db, ctx.classLevel, ctx.subjectId ?? l?.subject_id);
  const own = l ? all.filter(p => p.lessonId === l.id) : [];
  const cand = (own.length ? own : all).map(p => ({ text: `${p.bi.en} ${p.bi.ta}`, source: p.label, p }));
  let picked: typeof cand = [];
  if (text.trim() && !isGeneric(text)) picked = topPassages(text, cand, 4) as any; else if (l) picked = cand.slice(0, 5);
  if (text.trim() && !picked.length && own.length !== cand.length) picked = [];
  if (!picked.length) return null;
  const steps: TStep[] = picked.map((c: any, i: number) => { const b = c.p.bi as Bi; return { n: i + 1, en: b.en, ta: b.ta, check: makeCloze(b.en, b.ta, ctx.lang) ?? { kind: 'ack' as const } }; });
  const sourcesAll = [...new Set(picked.map((c: any) => c.p.label))] as string[];
  return { topic: l ? bi(l.title_en, l.title_ta) : bi(text.slice(0, 60), text.slice(0, 60)), grounded: 'lesson', sources: sourcesAll, refs: [], steps };
}

export const scopeOf = (ctx: Ctx) => (ctx.state.chapter ? { bookId: ctx.state.chapter.bookId, start: ctx.state.chapter.start, end: ctx.state.chapter.end } : null);
async function planFromTextbook(db: DB, ctx: Ctx, text: string): Promise<Plan | null> {
  const scope = scopeOf(ctx);
  // "teach me this chapter": no subject matter named, so teach from pages spread across the chapter
  const hits = scope && (!text.trim() || isGeneric(text)) ? await chapterSample(db, ctx.classLevel, scope, 4) : (!text.trim() || isGeneric(text) ? [] : await textbookHits(db, ctx.classLevel, ctx.subjectId, text, 4, scope)); if (!hits.length) return null;
  const steps: TStep[] = hits.map((h, i) => { const t = h.text; return { n: i + 1, en: t, ta: t, check: makeCloze(t, t, 'en') ?? { kind: 'ack' as const } }; });
  return { topic: ctx.state.chapter && (!text.trim() || isGeneric(text)) ? bi(ctx.state.chapter.title, ctx.state.chapter.title) : bi(text.slice(0, 60), text.slice(0, 60)), grounded: 'textbook', sources: [...new Set(hits.map(h => `${h.source}, page ${h.page}`))], refs: hits.map(h => ({ bookId: h.bookId, page: h.page as number })), steps };
}

export async function buildPlan(db: DB, ctx: Ctx, text: string): Promise<Plan | null> {
  const sol = text.trim() ? solveLinearFromText(text) : null; if (sol && sol.x) return planFromSolution(sol, text);
  if (ctx.state.chapter && !ctx.lessonId) return planFromTextbook(db, ctx, text); // a chosen chapter: teach from that chapter only, not from other lessons
  return (await planFromLesson(db, ctx, text)) ?? (await planFromTextbook(db, ctx, text));
}

const ASK: Bi = bi('What would you like to learn? Ask a question — for example “What is an equation?” or “Solve 3x + 5 = 20” — or choose a chapter and press Continue.', 'எதைக் கற்க விரும்புகிறீர்கள்? ஒரு கேள்வியைக் கேளுங்கள் — எ.கா. “சமன்பாடு என்றால் என்ன?” அல்லது “3x + 5 = 20 ஐத் தீர்க்க” — அல்லது ஒரு பாடத்தைத் தேர்ந்தெடுத்து தொடரவும்.');
const NO_SOURCE: Bi = bi('I could not find verified Samacheer Kalvi material for that in your class lessons or class books, so I will not guess. Pick a lesson, ask about a term from it, or type an equation such as 2(x − 3) = 10.',
  'உங்கள் வகுப்புப் பாடங்களிலோ புத்தகங்களிலோ அதற்கான சரிபார்க்கப்பட்ட சமச்சீர்க் கல்விப் பொருள் கிடைக்கவில்லை; எனவே யூகிக்க மாட்டேன். ஒரு பாடத்தைத் தேர்ந்தெடுங்கள், பாடத்திலுள்ள சொல்லைக் கேளுங்கள், அல்லது 2(x − 3) = 10 போன்ற சமன்பாட்டை எழுதுங்கள்.');

/** `open` = the plan is still being written, so the number of steps is not known yet ("Step 1", not "Step 1 of 4"). */
function stepChunk(plan: Plan, i: number, open = false, total = plan.steps.length): TurnEvent {
  const s = plan.steps[i]; const b = bi(s.en, s.ta);
  return { type: 'chunk', kind: 'step', en: open ? `Step ${i + 1}: ${s.en}` : `Step ${i + 1} of ${total}: ${s.en}`, ta: open ? `படி ${i + 1}: ${s.ta}` : `படி ${i + 1} / ${total}: ${s.ta}`, say: sayOf(b), step: i, total: open ? undefined : total, math: equationsIn(s.en), grounded: plan.grounded, sources: plan.sources, refs: plan.refs };
}
function checkChunk(plan: Plan, i: number, _lang: Lang): TurnEvent | null {
  const c = plan.steps[i]?.check; const last = i === plan.steps.length - 1;
  if (!c && plan.solution && last) { const v = plan.solution.variable; return { type: 'chunk', kind: 'check', en: `Your turn: what is ${v}?`, ta: `இப்போது நீங்கள்: ${v} இன் மதிப்பு என்ன?`, say: bi(`Your turn. What is ${v}?`, `இப்போது நீங்கள். ${v} இன் மதிப்பு என்ன?`), step: i }; }
  if (!c) return null;
  if (c.kind === 'ack') return { type: 'chunk', kind: 'check', en: 'Did that make sense? Say “yes” to continue or “no” and I will explain it differently.', ta: 'புரிந்ததா? தொடர “ஆம்” என்று சொல்லுங்கள்; புரியவில்லை என்றால் “இல்லை” என்று சொல்லுங்கள், வேறு விதமாக விளக்குகிறேன்.', say: bi('Did that make sense? Say yes to continue, or no and I will explain it differently.', 'புரிந்ததா? தொடர ஆம் என்று சொல்லுங்கள்; புரியவில்லை என்றால் இல்லை என்று சொல்லுங்கள்.'), step: i };
  if (c.kind === 'cloze') return { type: 'chunk', kind: 'check', en: `Quick check — fill in the blank: ${c.blank}`, ta: `சிறு சோதனை — விடுபட்டதை நிரப்புங்கள்: ${c.blank}`, say: bi(`Quick check. Fill in the missing word.`, `சிறு சோதனை. விடுபட்ட சொல்லைக் கூறுங்கள்.`), step: i };
  return null;
}
function simplerOf(plan: Plan, i: number): Bi {
  const s = plan.steps[i]; const first = (t: string) => t.split(/(?<=[.:।])\s/)[0];
  return bi(`In simpler words: ${first(s.en)}. Think of it like a balance — whatever we do to one side, we do to the other side too.`, `எளிமையாகச் சொன்னால்: ${first(s.ta)}. இதை ஒரு தராசு போல நினையுங்கள் — ஒரு பக்கம் செய்வதை மறு பக்கமும் செய்ய வேண்டும்.`);
}
const norm = (s: string) => s.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}.\-/]/gu, '');

function nextOrFinish(ctx: Ctx, st: State, i: number): TurnEvent[] {
  const plan = st.plan!; const out: TurnEvent[] = [];
  if (i + 1 < plan.steps.length) { st.idx = i + 1; st.wrong = 0; st.hintLevel = 0; out.push(stepChunk(plan, st.idx)); const c = checkChunk(plan, st.idx, ctx.lang); if (c) { out.push(c); st.awaiting = 'check'; } else st.awaiting = 'continue'; return out; }
  st.awaiting = null; st.done = true; out.push(summaryChunk(plan)); return out;
}
function summaryChunk(plan: Plan): TurnEvent {
  const lines = plan.steps.map((s, i) => `${i + 1}. ${s.en.split(/(?<=[.:])\s/)[0]}`); const tl = plan.steps.map((s, i) => `${i + 1}. ${s.ta.split(/(?<=[.:।])\s/)[0]}`);
  return { type: 'chunk', kind: 'summary', en: `Summary of what we learned — ${plan.topic.en}:\n${lines.join('\n')}`, ta: `நாம் கற்றதன் சுருக்கம் — ${plan.topic.ta}:\n${tl.join('\n')}`, say: bi(`Well done. Here is a summary of ${plan.topic.en}. ${plan.steps.length} steps covered.`, `நன்று. ${plan.topic.ta} பற்றிய சுருக்கம். ${plan.steps.length} படிகளை முடித்தோம்.`) };
}

async function pickQuestion(db: DB, ctx: Ctx, asked: string[]) {
  const subj = ctx.subjectId ?? (await q.get<any>(db, 'SELECT subject_id FROM lessons WHERE id=?', ctx.lessonId ?? ''))?.subject_id ?? 'maths';
  const rows = (await q.all<any>(db, "SELECT * FROM questions WHERE origin='practice' AND status='published' AND class_level=? AND subject_id=? AND type!='short'", ctx.classLevel, subj));
  const pool = rows.filter(r => !asked.includes(r.id)); return pool.length ? pool[0] : null;
}
function presentQ(row: any): Bi {
  const opts = J(row.options) as string[]; const L = ['A', 'B', 'C', 'D']; const f = (t: string) => `${t}${opts.length ? '\n' + opts.map((o, k) => `${L[k]}. ${o}`).join('\n') : ''}`;
  return bi(f(row.text_en), f(row.text_ta ?? row.text_en));
}
async function askQuestion(ctx: Ctx, st: State): Promise<TurnEvent[]> {
  const qz = st.quiz!; const row = await pickQuestion(ctx.db, ctx, qz.asked);
  if (!row || qz.total >= qz.limit) {
    st.awaiting = null; st.done = true; const pct = qz.total ? Math.round((qz.correct / qz.total) * 100) : 0;
    return [{ type: 'chunk', kind: 'summary', en: `That is the end of the quiz. You got ${qz.correct} of ${qz.total} (${pct}%).${qz.correct < qz.total ? ' Ask me to “revise this topic” to go over the ones you missed.' : ' Excellent!'}`, ta: `வினாடி வினா முடிந்தது. ${qz.total} இல் ${qz.correct} சரி (${pct}%).${qz.correct < qz.total ? ' தவறியவற்றை மீண்டும் பார்க்க “இந்தப் பாடத்தைத் திருப்பு” என்று கேளுங்கள்.' : ' மிகச் சிறப்பு!'}`, say: bi(`That is the end of the quiz. You got ${qz.correct} of ${qz.total}.`, `வினாடி வினா முடிந்தது. ${qz.total} இல் ${qz.correct} சரி.`) }];
  }
  qz.qid = row.id; qz.asked.push(row.id); qz.wrong = 0; st.awaiting = 'practice'; const p = presentQ(row);
  return [{ type: 'chunk', kind: 'question', en: `Question ${qz.total + 1}: ${p.en}`, ta: `கேள்வி ${qz.total + 1}: ${p.ta}`, say: bi(`Question ${qz.total + 1}. ${speakable(row.text_en, 'en')}`, `கேள்வி ${qz.total + 1}. ${speakable(row.text_ta ?? row.text_en, 'ta')}`), math: equationsIn(row.text_en), grounded: 'bank', sources: ['Practice question bank'] }];
}
async function gradeQuiz(ctx: Ctx, st: State, text: string): Promise<TurnEvent[]> {
  const qz = st.quiz!; const row = (await q.get<any>(ctx.db, 'SELECT * FROM questions WHERE id=?', qz.qid));
  if (!row) return askQuestion(ctx, st);
  const g = gradeAnswer(row.type, J(row.answer), parseGiven(row, text), 1); const ok = g.kind === 'auto' && g.correct;
  const rec = async (c: boolean) => (await q.run(ctx.db, 'INSERT INTO voice_quiz(session_id,user_id,question_id,topic,given,correct,at) VALUES (?,?,?,?,?,?,?)', ctx.sessionId ?? '', ctx.userId, row.id, row.topic ?? null, text.slice(0, 80), c ? 1 : 0, new Date().toISOString()));
  if (ok) { await rec(true); qz.total++; qz.correct++; const p = praise(qz.total); return [{ type: 'chunk', kind: 'feedback', en: `${p.en} ${row.explanation_en ?? ''}`.trim(), ta: `${p.ta} ${row.explanation_ta ?? ''}`.trim(), say: sayOf(bi(`${p.en} ${row.explanation_en ?? ''}`, `${p.ta} ${row.explanation_ta ?? ''}`)) }, ...(await askQuestion(ctx, st))]; }
  qz.wrong++;
  if (qz.wrong === 1) return [{ type: 'chunk', kind: 'hint', en: `Not quite. Here is a hint: ${hintFor(row, 'en')} Try again, or say “show the answer”.`, ta: `சரியில்லை. ஒரு குறிப்பு: ${hintFor(row, 'ta')} மீண்டும் முயலுங்கள், அல்லது “விடையைக் காட்டு” என்று சொல்லுங்கள்.`, say: sayOf(bi(`Not quite. Here is a hint. ${hintFor(row, 'en')}`, `சரியில்லை. ஒரு குறிப்பு. ${hintFor(row, 'ta')}`)) }];
  await rec(false); qz.total++; const ans = row.type === 'mcq' || row.type === 'tf' ? (J(row.options) as string[])[J(row.answer)] : row.type === 'numeric' ? String(J(row.answer).value) : (J(row.answer).accept as string[])[0];
  return [{ type: 'chunk', kind: 'feedback', en: `The answer is ${ans}. ${row.explanation_en ?? ''}`.trim(), ta: `விடை: ${ans}. ${row.explanation_ta ?? ''}`.trim(), say: sayOf(bi(`The answer is ${ans}. ${row.explanation_en ?? ''}`, `விடை ${ans}. ${row.explanation_ta ?? ''}`)) }, ...(await askQuestion(ctx, st))];
}
const startQuiz = (limit: number): State['quiz'] => ({ qid: '', wrong: 0, asked: [], correct: 0, total: 0, limit });

function hintChunks(ctx: Ctx, st: State): TurnEvent[] {
  const plan = st.plan; if (!plan) return [{ type: 'chunk', kind: 'info', en: 'Tell me the question you want a hint for — for example an equation like 3x + 5 = 20.', ta: 'எந்தக் கேள்விக்குக் குறிப்பு வேண்டும் என்று சொல்லுங்கள் — எடுத்துக்காட்டாக 3x + 5 = 20 போன்ற சமன்பாடு.', say: bi('Tell me the question you want a hint for.', 'எந்தக் கேள்விக்குக் குறிப்பு வேண்டும் என்று சொல்லுங்கள்.') }];
  st.hintLevel++; const L = st.hintLevel;
  if (plan.grounded === 'solver') {
    if (L === 1) return [{ type: 'chunk', kind: 'hint', en: 'Hint 1: Get the letter by itself. First undo the number added or subtracted, then undo the number multiplying it — and always do the same to both sides.', ta: 'குறிப்பு 1: எழுத்தைத் தனியாகப் பெறுங்கள். முதலில் கூட்டிய அல்லது கழித்த எண்ணை நீக்குங்கள்; பிறகு பெருக்கிய எண்ணை நீக்குங்கள். இரு பக்கமும் ஒரே செயலைச் செய்யுங்கள்.', say: bi('Hint one. Get the letter by itself. First undo the number added or subtracted, then the number multiplying it, and do the same to both sides.', 'குறிப்பு ஒன்று. எழுத்தைத் தனியாகப் பெறுங்கள். முதலில் கூட்டிய அல்லது கழித்த எண்ணை நீக்குங்கள், பிறகு பெருக்கிய எண்ணை நீக்குங்கள்.') }];
    const upto = Math.min(L - 1, plan.steps.length); if (L - 1 >= plan.steps.length + 1 || upto === plan.steps.length) { st.done = true; return [{ type: 'chunk', kind: 'hint', en: `That is every step. The answer is ${plan.solution?.variable} = ${plan.solution?.answer}.`, ta: `எல்லாப் படிகளும் முடிந்தன. விடை ${plan.solution?.variable} = ${plan.solution?.answer}.`, say: bi(`That is every step. The answer is ${plan.solution?.variable} equals ${plan.solution?.answer}.`, `எல்லாப் படிகளும் முடிந்தன. விடை ${plan.solution?.variable} சமம் ${plan.solution?.answer}.`) }]; }
    const s = plan.steps[upto - 1]; return [{ type: 'chunk', kind: 'hint', en: `Hint ${L}: ${s.en}`, ta: `குறிப்பு ${L}: ${s.ta}`, say: sayOf(bi(s.en, s.ta)), math: equationsIn(s.en), step: upto - 1, total: plan.steps.length }];
  }
  const s = plan.steps[st.idx]; const c = s?.check;
  if (c?.kind === 'cloze') { const a = c.answer; if (L === 1) return [{ type: 'chunk', kind: 'hint', en: `Hint: the missing word starts with “${a.slice(0, 1)}” and has ${[...a].length} letters.`, ta: `குறிப்பு: விடுபட்ட சொல் “${[...a][0]}” என்ற எழுத்தில் தொடங்கி ${[...a].length} எழுத்துகள் கொண்டது.`, say: bi(`Hint. The missing word starts with ${a.slice(0, 1)} and has ${[...a].length} letters.`, `குறிப்பு. விடுபட்ட சொல் ${[...a][0]} என்ற எழுத்தில் தொடங்கும்.`) }];
    if (L === 2) return [{ type: 'chunk', kind: 'hint', en: `Hint 2: it begins “${[...a].slice(0, 3).join('')}…”.`, ta: `குறிப்பு 2: “${[...a].slice(0, 3).join('')}…” என்று தொடங்கும்.`, say: bi(`Hint two. It begins ${[...a].slice(0, 3).join(' ')}.`, `குறிப்பு இரண்டு. ${[...a].slice(0, 3).join(' ')} என்று தொடங்கும்.`) }];
    return [{ type: 'chunk', kind: 'hint', en: `The missing word is “${a}”.`, ta: `விடுபட்ட சொல்: “${a}”.`, say: bi(`The missing word is ${a}.`, `விடுபட்ட சொல் ${a}.`) }]; }
  return [{ type: 'chunk', kind: 'hint', en: 'Hint: re-read this step slowly and tell me the one key idea in your own words.', ta: 'குறிப்பு: இந்தப் படியை மெதுவாக மீண்டும் படித்து, முக்கிய கருத்தை உங்கள் சொந்த வார்த்தைகளில் சொல்லுங்கள்.', say: bi('Hint. Read this step slowly and tell me the key idea in your own words.', 'குறிப்பு. இந்தப் படியை மெதுவாகப் படித்து முக்கிய கருத்தைச் சொல்லுங்கள்.') }];
}

/** Builds the lesson plan for a question. The rule engine uses `buildPlan`; the LLM engine plugs in a model-written plan with this as its fallback. */
export type Planner = (db: DB, ctx: Ctx, text: string) => Promise<Plan | null>;
/** A plan that arrives piece by piece: a topic, then steps (each already checked), with the sources cited so far. */
export type PlanEvent = { type: 'head'; topic: Bi; total?: number } | { type: 'step'; step: TStep; sources: string[]; refs: Plan['refs']; grounded: Plan['grounded'] };
/** Returns null when this question should be planned the normal way (no streaming applies). */
export type StreamPlanner = (db: DB, ctx: Ctx, text: string) => Promise<AsyncGenerator<PlanEvent> | null>;
function introChunk(plan: Plan): TurnEvent {
  return { type: 'chunk', kind: 'info', en: `${plan.grounded === 'solver' ? 'Let us work through this' : `From ${plan.grounded === 'lesson' ? 'your class lesson' : 'your class book'}`}: ${plan.topic.en}`, ta: `${plan.grounded === 'solver' ? 'இதைப் படிப்படியாகப் பார்ப்போம்' : plan.grounded === 'lesson' ? 'உங்கள் வகுப்புப் பாடத்திலிருந்து' : 'உங்கள் வகுப்புப் புத்தகத்திலிருந்து'}: ${plan.topic.ta}`, say: sayOf(bi(`${plan.grounded === 'solver' ? 'Let us work through this' : 'From your class material'}: ${plan.topic.en}`, `${plan.grounded === 'solver' ? 'இதைப் படிப்படியாகப் பார்ப்போம்' : 'உங்கள் வகுப்புப் பொருளிலிருந்து'}: ${plan.topic.ta}`)), grounded: plan.grounded, sources: plan.sources, refs: plan.refs };
}
/**
 * Teach/explain from a plan that is still being written. The intro and step 1 are sent the moment step 1 has been checked, so the student hears
 * them while the model writes the rest; the turn finishes (and the saved state is complete) once the plan is. Returns false, having sent
 * nothing, when no step arrived — the caller then plans the normal way.
 */
async function* streamLesson(ctx: Ctx, st: State, mode: Mode, events: AsyncGenerator<PlanEvent>): AsyncGenerator<TurnEvent, boolean> {
  let plan: Plan | null = null; let topic: Bi | null = null; let known: number | undefined;
  try {
    for await (const ev of events) {
      if (ev.type === 'head') { topic = ev.topic; known = ev.total; continue; }
      if (!plan) {
        plan = { topic: topic ?? bi('This topic', 'இந்தத் தலைப்பு'), grounded: ev.grounded, sources: ev.sources, refs: ev.refs, steps: [] };
        st.plan = plan; st.idx = 0; st.wrong = 0; st.hintLevel = 0; st.done = false; st.quiz = null; st.awaiting = null;
        yield introChunk(plan);
      }
      plan.grounded = ev.grounded; plan.sources = ev.sources; plan.refs = ev.refs; plan.steps.push({ ...ev.step, n: plan.steps.length + 1 });
      const at = plan.steps.length - 1;
      if (mode === 'explain') yield stepChunk(plan, at, known === undefined, known);
      else if (at === 0) { yield stepChunk(plan, 0, known === undefined, known); const ck = checkChunk(plan, 0, ctx.lang); if (ck) { yield ck; st.awaiting = 'check'; } else st.awaiting = 'continue'; }
    }
  } catch { /* keep whatever steps were already checked and sent */ }
  if (!plan) { st.plan = null; return false; }
  if (mode === 'explain') { st.awaiting = null; st.done = true; yield summaryChunk(plan); yield { type: 'done', state: st, meta: { grounded: plan.grounded, completed: true } }; return true; }
  yield { type: 'done', state: st, meta: { grounded: plan.grounded, completed: false } }; return true;
}
async function* ruleTurn(ctx: Ctx, input: TurnInput, planFor: Planner = buildPlan, streamFor?: StreamPlanner): AsyncGenerator<TurnEvent> {
  const st = ctx.state; const text = input.text.trim(); const action = input.action ?? '';
  yield { type: 'ack' };
  const fin = (grounded?: string, completed = false): TurnEvent => ({ type: 'done', state: st, meta: { grounded: grounded ?? st.plan?.grounded ?? 'none', completed } });
  const emit = function* (xs: TurnEvent[]) { for (const x of xs) yield x; };

  if (action.startsWith('mode:')) { const m = action.slice(5) as Mode; if (MODES.includes(m)) { const keepPlan = st.plan; Object.assign(st, initialState(m)); st.plan = keepPlan; } }
  const mode = st.mode;

  // follow-ups about the diagram on screen
  const PIC = /diagram|figure|picture|image|label|படம்|வரைபட/i;
  if (text && (PIC.test(text) || (st.visual && labelMeaning(st.visual, text) && /what|mean|\?|என்ன|விளக்க/i.test(text)))) {
    const simpler = /simpler|easier|எளிய/i.test(text);
    if (!st.visual) {
      if (!detectKey(text)) { const m = bi('There is no diagram on screen yet. Ask about a topic such as the human heart, reflection of light or a right-angled triangle, and I will show one.', 'இன்னும் திரையில் படம் இல்லை. மனித இதயம், ஒளியின் எதிரொளிப்பு, செங்கோண முக்கோணம் போன்ற தலைப்பைக் கேளுங்கள்; படத்தைக் காட்டுகிறேன்.'); yield { type: 'chunk', kind: 'info', en: m.en, ta: m.ta, say: m }; yield fin(); return; }
    } else {
      const k = st.visual; const lm = labelMeaning(k, text);
      if (simpler) { const ok = canSimplify(k.id); const m = ok ? bi('Here is a simpler version with fewer labels.', 'குறைந்த குறிப்புகளுடன் எளிய வடிவம் இதோ.') : bi('This diagram is already simple. Let me explain it in words instead: ' + describeVisual(k).en, 'இந்தப் படம் ஏற்கனவே எளிமையானது. சொற்களில் விளக்குகிறேன்: ' + describeVisual(k).ta); yield { type: 'chunk', kind: 'info', en: m.en, ta: m.ta, say: m, vis: ok ? { id: k.id, lvl: 'simple' } : k }; yield fin(); return; }
      if (lm) { const t = { en: `${lm.label.name.en}: ${lm.label.meaning.en}`, ta: `${lm.label.name.ta}: ${lm.label.meaning.ta}` }; yield { type: 'chunk', kind: 'info', en: t.en, ta: t.ta, say: t, vis: { id: k.id, hl: lm.label.id, lvl: k.lvl } }; yield fin(); return; }
      const d = describeVisual(k); yield { type: 'chunk', kind: 'info', en: d.en, ta: d.ta, say: d, vis: { id: k.id, lvl: k.lvl, p: k.p } }; yield fin(); return;
    }
  }
  if (action === 'repeat') { if (st.plan && st.plan.steps[st.idx]) { yield stepChunk(st.plan, st.idx); const c = st.awaiting === 'check' ? checkChunk(st.plan, st.idx, ctx.lang) : null; if (c) yield c; } else yield { type: 'chunk', kind: 'info', en: 'There is nothing to repeat yet.', ta: 'மீண்டும் சொல்ல இன்னும் எதுவும் இல்லை.', say: bi('There is nothing to repeat yet.', 'மீண்டும் சொல்ல இன்னும் எதுவும் இல்லை.') }; yield fin(); return; }
  if (action === 'simpler' && st.plan?.steps[st.idx]) { const b = simplerOf(st.plan, st.idx); yield { type: 'chunk', kind: 'info', en: b.en, ta: b.ta, say: sayOf(b), step: st.idx, total: st.plan.steps.length, grounded: st.plan.grounded, sources: st.plan.sources }; yield fin(); return; }
  if (action === 'hint') { yield* emit(hintChunks(ctx, st)); yield fin(); return; }
  if (action === 'summary' && st.plan) { yield summaryChunk(st.plan); yield fin(); return; }

  // Answer to a pending question
  if (st.awaiting === 'practice' && st.quiz && text && !action.startsWith('mode:')) {
    const giveUp = /^(show (me )?the answer|விடையைக் காட்டு)/i.test(text); if (giveUp) st.quiz.wrong = 1;
    yield* emit(await gradeQuiz(ctx, st, giveUp ? '\u0000' : text)); yield fin('bank'); return;
  }
  if (st.awaiting === 'check' && st.plan && (text || action === 'next') && !action.startsWith('mode:')) {
    const plan = st.plan, i = st.idx, step = plan.steps[i], c = step.check;
    const isQuestion = /\?|^(what|why|how|explain|tell me|சொல்|விளக்கு|ஏன்|எப்படி)/i.test(text) && text.split(/\s+/).length > 3;
    if (action === 'next' || (YES.test(text) && (!c || c.kind === 'ack'))) { yield* emit(nextOrFinish(ctx, st, i)); yield fin(undefined, st.done); return; }
    if (NO.test(text)) { const b = simplerOf(plan, i); yield { type: 'chunk', kind: 'info', en: b.en, ta: b.ta, say: sayOf(b), step: i, total: plan.steps.length }; const ck = checkChunk(plan, i, ctx.lang); if (ck) yield ck; yield fin(); return; }
    if (!isQuestion) {
      const numeric = !c && plan.solution && i === plan.steps.length - 1;
      if (numeric || c?.kind === 'cloze') {
        const want = numeric ? plan.solution!.answer : (c as any).answer; const got = numeric ? (text.match(/-?\d+(?:\.\d+)?(?:\/\d+)?/)?.[0] ?? '') : text;
        const ok = numeric ? got === want : norm(got).includes(norm(want));
        if (ok) { const p = praise(i); yield { type: 'chunk', kind: 'feedback', en: p.en, ta: p.ta, say: p }; yield* emit(nextOrFinish(ctx, st, i)); yield fin(undefined, st.done); return; }
        st.wrong++;
        if (st.wrong === 1) { yield { type: 'chunk', kind: 'feedback', en: 'Not quite — have another go.', ta: 'சரியில்லை — மீண்டும் முயலுங்கள்.', say: bi('Not quite. Have another go.', 'சரியில்லை. மீண்டும் முயலுங்கள்.') }; st.hintLevel = 0; yield* emit(hintChunks(ctx, st).slice(0, 1)); yield fin(); return; }
        const reveal = numeric ? `The answer is ${plan.solution!.variable} = ${want}.` : `The missing word is “${want}”.`; const revTa = numeric ? `விடை ${plan.solution!.variable} = ${want}.` : `விடுபட்ட சொல்: “${want}”.`;
        yield { type: 'chunk', kind: 'feedback', en: `${reveal} Let us look at why, then move on.`, ta: `${revTa} ஏன் என்று பார்த்துவிட்டு முன்னேறுவோம்.`, say: bi(reveal, revTa) };
        yield* emit(nextOrFinish(ctx, st, i)); yield fin(undefined, st.done); return;
      }
    }
    // a follow-up question: fall through and teach it as a new topic
  }
  if (st.awaiting === 'continue' && st.plan && (action === 'next' || YES.test(text))) { yield* emit(nextOrFinish(ctx, st, st.idx)); yield fin(undefined, st.done); return; }

  // Starting something new
  if (mode === 'practice' || mode === 'revise') {
    if (mode === 'revise') {
      const plan = await planFor(ctx.db, ctx, text); st.plan = plan;
      if (!plan) { const m = text && !isGeneric(text) ? NO_SOURCE : ASK; yield { type: 'chunk', kind: text && !isGeneric(text) ? 'notice' : 'info', en: m.en, ta: m.ta, say: m, grounded: 'none' }; yield fin('none'); return; }
      const bullets = plan.steps.map((s, i) => `${i + 1}. ${s.en.split(/(?<=[.:])\s/)[0]}`).join('\n'); const bt = plan.steps.map((s, i) => `${i + 1}. ${s.ta.split(/(?<=[.:।])\s/)[0]}`).join('\n');
      yield { type: 'chunk', kind: 'summary', en: `Quick revision — ${plan.topic.en}:\n${bullets}`, ta: `விரைவுத் திருப்புதல் — ${plan.topic.ta}:\n${bt}`, say: bi(`Quick revision of ${plan.topic.en}. Here are the key points, then a short quiz.`, `${plan.topic.ta} பற்றிய விரைவுத் திருப்புதல். முக்கியக் குறிப்புகள், பிறகு ஒரு சிறு வினாடி வினா.`), grounded: plan.grounded, sources: plan.sources, refs: plan.refs };
      st.quiz = startQuiz(3);
    } else st.quiz = startQuiz(5);
    if (!(await pickQuestion(ctx.db, ctx, []))) { yield { type: 'chunk', kind: 'notice', en: 'I do not have practice questions for this subject and class yet.', ta: 'இந்த வகுப்பு மற்றும் பாடத்திற்கான பயிற்சிக் கேள்விகள் இன்னும் இல்லை.', say: bi('I do not have practice questions for this subject and class yet.', 'இந்த வகுப்பு மற்றும் பாடத்திற்கான பயிற்சிக் கேள்விகள் இன்னும் இல்லை.') }; yield fin('none'); return; }
    yield* emit(await askQuestion(ctx, st)); yield fin('bank', st.done); return;
  }
  if (mode === 'hint') {
    if (text) { st.plan = (await planFor(ctx.db, ctx, text)); st.hintLevel = 0; st.idx = 0; }
    if (!st.plan) { yield { type: 'chunk', kind: 'notice', en: text ? NO_SOURCE.en : 'Tell me the question you want a hint for — for example an equation like 3x + 5 = 20.', ta: text ? NO_SOURCE.ta : 'எந்தக் கேள்விக்குக் குறிப்பு வேண்டும் என்று சொல்லுங்கள் — எடுத்துக்காட்டாக 3x + 5 = 20.', say: text ? NO_SOURCE : bi('Tell me the question you want a hint for.', 'எந்தக் கேள்விக்குக் குறிப்பு வேண்டும் என்று சொல்லுங்கள்.'), grounded: 'none' }; yield fin('none'); return; }
    yield* emit(hintChunks(ctx, st)); yield fin(); return;
  }
  // teach / explain
  if (streamFor && text && (mode === 'teach' || mode === 'explain')) {
    const events = await streamFor(ctx.db, ctx, text);
    if (events) { if (yield* streamLesson(ctx, st, mode, events)) return; planFor = buildPlan; } // a stream that gave nothing is not retried: use the built-in lesson
  }
  const plan = text ? (await planFor(ctx.db, ctx, text)) : (st.plan ?? (await planFor(ctx.db, ctx, ''))); st.plan = plan; st.idx = 0; st.wrong = 0; st.hintLevel = 0; st.done = false; st.quiz = null;
  if (!plan) { st.awaiting = null; const m = text && !isGeneric(text) ? NO_SOURCE : ASK; yield { type: 'chunk', kind: text && !isGeneric(text) ? 'notice' : 'info', en: m.en, ta: m.ta, say: m, grounded: 'none' }; yield fin('none'); return; }
  yield introChunk(plan);
  if (mode === 'explain') {
    for (let i = 0; i < plan.steps.length; i++) yield stepChunk(plan, i);
    st.awaiting = null; st.done = true; yield summaryChunk(plan); yield fin(plan.grounded, true); return;
  }
  yield stepChunk(plan, 0); const ck = checkChunk(plan, 0, ctx.lang); if (ck) { yield ck; st.awaiting = 'check'; } else st.awaiting = 'continue';
  yield fin(plan.grounded);
}
export const ruleEngine: TeachEngine = { name: 'rule-engine', mock: true, turn: (ctx, input) => ruleTurn(ctx, input) };
/** Same teaching loop (checks, hints, quiz, visuals, replay) with a different way of writing the lesson plan. */
export const engineWith = (name: string, mock: boolean, planFor: Planner, streamFor?: StreamPlanner): TeachEngine => ({ name, mock, turn: (ctx, input) => ruleTurn(ctx, input, planFor, streamFor) });
