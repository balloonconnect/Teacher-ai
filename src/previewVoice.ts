/** Browser-only demo tutor for the UI preview (Vercel). Not the real engine: it solves simple linear equations
 *  (ax + b = c) and walks through them one step at a time so the whole voice-tutor interface can be tried. */
import { visualsFor, detectKey, labelMeaning, describeVisual, VKey, Visual } from '../shared/visuals';
type Ev = { type: 'visual'; at: number; visuals: Visual[] } | { type: 'chunk'; kind: string; en: string; ta: string; say: { en: string; ta: string }; step?: number; total?: number; math?: string[]; sources?: string[] } | { type: 'done'; state: any; meta: any };
type Demo = { eq: string; a: number; b: number; c: number; idx: number; awaiting: boolean; hint: number } | null;
let D: Demo = null;
const SRC = ['Worked out by the equation solver (not from a textbook) — UI preview demo'];
const sg = (n: number) => (n < 0 ? '−' : '+');
const parse = (t: string) => { const m = t.replace(/\s+/g, '').replace(/−/g, '-').match(/(-?\d*)x([+-]\d+)?=(-?\d+)/i); if (!m) return null; const a = m[1] === '' ? 1 : m[1] === '-' ? -1 : +m[1]; return { a, b: m[2] ? +m[2] : 0, c: +m[3] }; };
const steps = (d: NonNullable<Demo>) => { const r = d.c - d.b, x = r / d.a; const fx = Number.isInteger(x) ? String(x) : x.toFixed(2);
  return [
    { en: `Start with the equation: ${d.eq}`, ta: `சமன்பாட்டுடன் தொடங்குவோம்: ${d.eq}`, math: [d.eq] },
    { en: `Move the ${Math.abs(d.b)} to the other side: ${d.a === 1 ? '' : d.a}x = ${d.c} ${d.b < 0 ? '+' : '−'} ${Math.abs(d.b)} = ${r}`, ta: `${Math.abs(d.b)} ஐ மறுபக்கம் கொண்டு செல்வோம்: ${d.a === 1 ? '' : d.a}x = ${r}`, math: [`${d.a === 1 ? '' : d.a}x = ${r}`] },
    { en: `Divide both sides by ${d.a}: x = ${r} ÷ ${d.a} = ${fx}`, ta: `இரு பக்கமும் ${d.a} ஆல் வகுக்க: x = ${fx}`, math: [`x = ${fx}`] },
    { en: `Check: ${d.a}(${fx}) ${sg(d.b)} ${Math.abs(d.b)} = ${d.c}. It matches, so x = ${fx}.`, ta: `சரிபார்ப்பு: ${d.a}(${fx}) ${sg(d.b)} ${Math.abs(d.b)} = ${d.c}. சரியாக உள்ளது; x = ${fx}.`, math: [`x = ${fx}`] },
  ]; };
const say = (s: string) => ({ en: s.replace(/x/g, ' x ').replace(/=/g, ' equals ').replace(/−/g, ' minus ').replace(/÷/g, ' divided by ').replace(/\+/g, ' plus '), ta: s.replace(/=/g, ' சமம் ') });
const bi = (en: string, ta: string, kind: string, extra: any = {}): Ev => ({ type: 'chunk', kind, en, ta, say: { en, ta }, ...extra });
const done = (): Ev => ({ type: 'done', state: { mode: 'teach', plan: D ? { topic: { en: `Solving ${D.eq}`, ta: `${D.eq} தீர்த்தல்` } } : null, idx: D?.idx ?? 0 }, meta: { grounded: D ? 'solver' : 'none' } });
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

let LAST: VKey | null = null;
export async function* previewTurn(body: { text?: string; action?: string }): AsyncGenerator<Ev> {
  let n = 0; for await (const ev of inner(body)) { yield ev; if (ev.type === 'chunk') { const at = n++; try { const vs = visualsFor({ student: body.text ?? '', chunkText: ev.en, kind: ev.kind, first: at === 0, math: ev.math, solver: !!D, mode: 'teach', step: ev.step, total: ev.total, want: (ev as any).vis }); if (vs.length) { LAST = vs[vs.length - 1].key; yield { type: 'visual', at, visuals: vs }; } } catch { /* the lesson continues without the picture */ } } }
}
async function* inner(body: { text?: string; action?: string }): AsyncGenerator<Ev> {
  await wait(120);
  const t = (body.text ?? '').trim(); const act = body.action ?? '';
  const eq = parse(t);
  if (eq && eq.a !== 0) {
    D = { eq: t.replace(/^.*?(-?\d*x.*=\s*-?\d+).*$/i, '$1').trim(), ...eq!, idx: 0, awaiting: false, hint: 0 };
  } else if (act.startsWith('mode:') || act === 'start') {
    if (!D) { yield bi('Type an equation such as 3x + 5 = 20 and I will teach it one step at a time.', 'ஒரு சமன்பாட்டை (எ.கா. 3x + 5 = 20) தட்டச்சு செய்யுங்கள்; ஒவ்வொரு படியாகக் கற்றுத் தருகிறேன்.', 'info'); yield done(); return; }
  } else if (!D && detectKey(t)) {
    const k = detectKey(t)!; const d = describeVisual(k); yield bi(d.en, d.ta, 'info', { sources: ['Original diagram drawn by Karkai AI · UI preview demo, not a textbook'] }); yield done(); return;
  } else if (/diagram|figure|picture|label|படம்/i.test(t) && LAST) {
    if (/simpler|easier|எளிய/i.test(t)) { yield bi('Here is a simpler version with fewer labels.', 'குறைந்த குறிப்புகளுடன் எளிய வடிவம் இதோ.', 'info', { vis: { id: LAST.id, lvl: 'simple' } }); yield done(); return; }
    const lm = labelMeaning(LAST, t); if (lm) { yield bi(`${lm.label.name.en}: ${lm.label.meaning.en}`, `${lm.label.name.ta}: ${lm.label.meaning.ta}`, 'info', { vis: { id: LAST.id, hl: lm.label.id } }); yield done(); return; }
    const d = describeVisual(LAST); yield bi(d.en, d.ta, 'info', { vis: { id: LAST.id, p: LAST.p } }); yield done(); return;
  } else if (!D) {
    yield bi('This is the UI preview demo. It can walk through a linear equation like 3x + 5 = 20, or show diagrams for “the human heart”, “reflection of light” and “right-angled triangle”. The real tutor uses your class lessons and books.', 'இது UI முன்னோட்டம். 3x + 5 = 20 போன்ற சமன்பாட்டை மட்டுமே இது விளக்கும்; உண்மையான ஆசிரியர் உங்கள் பாடங்களையும் புத்தகங்களையும் பயன்படுத்தும்.', 'notice', { sources: ['No verified source — nothing was invented'] }); yield done(); return;
  }
  const d = D!; const S = steps(d);
  if (act === 'hint') {
    d.hint++; yield bi(d.hint === 1 ? 'Hint: what number is added to 3x? Undo it first, on both sides.' : 'Hint 2: subtract that number from both sides, then divide by the number beside x.', d.hint === 1 ? 'குறிப்பு: x உடன் கூட்டப்பட்ட எண்ணை முதலில் இரு பக்கமும் நீக்குங்கள்.' : 'குறிப்பு 2: இரு பக்கமும் கழித்து, x க்கு அருகிலுள்ள எண்ணால் வகுக்கவும்.', 'hint'); yield done(); return;
  }
  const no = /^(no|illai|இல்லை)/i.test(t) || act === 'simpler'; const rep = act === 'repeat';
  if (no) { const s = S[Math.max(0, d.idx - 1)]; yield bi(`Let me say it more simply. ${s.en.replace(/^Start with the equation: /, 'We balance the scale: ')}`, `இன்னும் எளிமையாகச் சொல்கிறேன். ${s.ta}`, 'info', { math: s.math }); yield bi('Does that help? Say “yes” to continue.', 'இப்போது புரிந்ததா? தொடர “ஆம்” என்று சொல்லுங்கள்.', 'check'); d.awaiting = true; yield done(); return; }
  if (rep && d.idx > 0) d.idx--;
  if (d.idx >= S.length) { yield bi(`Summary: ${d.eq} gives x = ${(d.c - d.b) / d.a}. Try another equation to practise.`, `சுருக்கம்: ${d.eq} என்பதற்கு x = ${(d.c - d.b) / d.a}. பயிற்சிக்கு மற்றொரு சமன்பாட்டை முயலுங்கள்.`, 'summary'); D = null; yield done(); return; }
  const s = S[d.idx]; yield bi(`Step ${d.idx + 1} of ${S.length}: ${s.en}`, `படி ${d.idx + 1} / ${S.length}: ${s.ta}`, 'step', { step: d.idx + 1, total: S.length, math: s.math, sources: SRC });
  d.idx++; await wait(80);
  if (d.idx < S.length) yield bi('Did that make sense? Say “yes” to continue or “no” and I will explain it differently.', 'புரிந்ததா? தொடர “ஆம்” என்று சொல்லுங்கள்; புரியவில்லை என்றால் “இல்லை” என்று சொல்லுங்கள்.', 'check');
  else yield bi('That is the whole solution. Say “yes” for a short summary.', 'முழு தீர்வும் இதுதான். சுருக்கத்திற்கு “ஆம்” என்று சொல்லுங்கள்.', 'check');
  yield done();
}
void say;
