// Small keyword retriever used for source-grounded answers (lessons and user material).
const STOP = new Set('the a an is are was were of to in on and or for with what how why when which that this it as by be from at do does can you i me my about tell explain show give please also more some any like'.split(' '));
export const tokens = (s: string) => (s.toLowerCase().normalize('NFC').match(/[\p{L}\p{N}஀-௿]+/gu) ?? []).filter(t => t.length > 1 && !STOP.has(t));
export type Passage = { text: string; page?: number; source: string };
export function splitPassages(text: string, page?: number, source = 'document'): Passage[] {
  return text.split(/\n{1,}|(?<=[.!?।])\s+(?=[A-Z஀-௿])/).map(s => s.trim()).filter(s => s.length > 30).reduce<string[]>((acc, s) => {
    const last = acc[acc.length - 1]; if (last && last.length < 160) acc[acc.length - 1] = `${last} ${s}`; else acc.push(s); return acc;
  }, []).map(t => ({ text: t.slice(0, 700), page, source }));
}
const TAMIL_SCRIPT = /[\u0B80-\u0BFF]/;
/** Common Tamil case/plural endings, longest first. Tamil is agglutinative ("பாறை", "பாறைகளில்", "பாறைகளை"), so exact-word matching misses most inflected forms. */
const SUFFIX = ['ங்களுக்கு', 'களுக்கு', 'ங்களில்', 'களில்', 'ங்களை', 'களை', 'ங்களின்', 'களின்', 'ங்களால்', 'களால்', 'ங்கள்', 'கள்', 'இலிருந்து', 'ிலிருந்து', 'உடைய', 'ுடைய', 'இடம்', 'ிடம்', 'ோடு', 'ுடன்', 'ின்', 'ில்', 'ால்', 'ைக்', 'க்கு', 'ும்'];
/** A rough stem for a Tamil word: strips up to two common endings (case ending, then plural), keeping at least 3 code points. */
export function stem(w: string) {
  if (!TAMIL_SCRIPT.test(w)) return w; let cur = w;
  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    for (const suf of SUFFIX) {
      const n = [...suf].length; if ([...cur].length - n < 3 || !cur.endsWith(suf)) continue;
      cur = [...cur].slice(0, [...cur].length - n).join(''); changed = true;
      if (/[\u0B95-\u0BB9]$/.test(cur)) cur += '்'; // a vowel-sign ending leaves a bare consonant: restore its pulli (கிணறுகள → கிணறுகள்)
      break;
    }
    if (!changed) break;
  }
  return cur.replace(/்$/, '');
}
/** Tamil question words and fillers that appear in nearly every question and say nothing about the topic. */
const TA_STOP = new Set('என்ன என்றால் என்பது என்று ஏன் எப்படி எவை எவ்வாறு எது எவர் யார் யாவை எந்த எத்தனை எங்கு எப்போது பற்றி பற்றிய குறித்து குறித்த கூறுக கூறுங்கள் எழுதுக விளக்குக விளக்கம் சொல்லுங்கள் சொல் ஆகிய மற்றும் இந்த அந்த இது அது ஒரு உள்ள உள்ளது உண்டு இல்லை வேண்டும்'.split(' '));
const isTa = (t: string) => TAMIL_SCRIPT.test(t);
const stemEn = (w: string) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
/** Index terms for a word: stemmed Tamil, lightly stemmed English. */
const term = (t: string) => (isTa(t) ? stem(t) : stemEn(t));
const content = (s: string) => tokens(s).filter(t => !TA_STOP.has(t));
const GRAM = 3;
/** Character n-grams over code points. */
const grams = (w: string, n = GRAM) => { const c = [...w]; const out: string[] = []; for (let i = 0; i + n <= c.length; i++) out.push(c.slice(i, i + n).join('')); return out; };
/** Tamil text with everything but Tamil letters removed: "நடுவு நிலைமை" and "நடுவுநிலைமை" become the same stream (OCR often splits or joins words). */
const tamilStream = (s: string) => s.normalize('NFC').replace(/[^\u0B80-\u0BFF]/g, '');

export const RETRIEVAL_WEIGHTS = { k1: 1.2, b: 0.75, gram: 1, coverage: 0.7 };
const idf = (n: number, df: number) => Math.log(1 + (n - df + 0.5) / (df + 0.5));
const bm25 = (tf: number, len: number, avg: number, w = RETRIEVAL_WEIGHTS) => (tf * (w.k1 + 1)) / (tf + w.k1 * (1 - w.b + (w.b * len) / avg));

/**
 * Ranks passages for a question: BM25 over stemmed words plus BM25 over Tamil character 3-grams (which survives suffix changes, word splits and
 * small OCR errors). A passage is returned only with real evidence: a question word (or most of its letters) found in a rare place, or two
 * different question words — one common word such as "about" or "child" is not enough.
 */
export function topPassages(question: string, passages: Passage[], k = 3, o: { rareFraction?: number } = {}) {
  const qWords = [...new Set(content(question))]; if (!qWords.length || !passages.length) return [];
  const qTerms = [...new Set(qWords.map(term))].filter(t => [...t].length > 1);
  const qTa = qWords.filter(w => isTa(w) && [...stem(w)].length >= 3);
  const N = passages.length; const W = RETRIEVAL_WEIGHTS;
  const docs = passages.map(p => {
    const ws = tokens(p.text).map(term); const tf = new Map<string, number>(); for (const t of ws) tf.set(t, (tf.get(t) ?? 0) + 1);
    const stream = tamilStream(p.text); const g = grams(stream); const gtf = new Map<string, number>(); for (const x of g) gtf.set(x, (gtf.get(x) ?? 0) + 1);
    return { p, tf, len: ws.length || 1, stream, gtf, glen: g.length || 1 };
  });
  const avg = docs.reduce((a, d) => a + d.len, 0) / N || 1; const gavg = docs.reduce((a, d) => a + d.glen, 0) / N || 1;
  // document frequency of every query word and gram
  const df = new Map<string, number>(); for (const t of qTerms) df.set(t, docs.filter(d => d.tf.has(t)).length);
  const qGrams = [...new Set(qTa.flatMap(w => grams(stem(w))))]; const gdf = new Map<string, number>(); for (const g of qGrams) gdf.set(g, docs.filter(d => d.gtf.has(g)).length);
  // a Tamil query word is "covered" by a passage when most of its letters appear there in order-free 3-gram form
  const coverage = (d: (typeof docs)[number], w: string) => { const gs = grams(stem(w)); return gs.length ? gs.filter(g => d.gtf.has(g)).length / gs.length : 0; };
  const covered = qTa.map(w => docs.map(d => coverage(d, w) >= W.coverage));
  const coverN = covered.map(c => c.filter(Boolean).length);
  // "rare" = in at most 8% of the passages (inside one chosen chapter the topic word is common by design, so callers pass a larger fraction)
  const rare = Math.max(2, Math.floor(N * (o.rareFraction ?? 0.08)));
  // how much of the question's weight (rare words weigh more; words found nowhere weigh the most) a passage accounts for
  const qWeight = (t: string) => idf(N, df.get(t) ?? 0); const totalWeight = qTerms.reduce((a, t) => a + qWeight(t), 0) || 1;
  const scored = docs.map((d, di) => {
    let word = 0; const hitTerms: string[] = [];
    for (const t of qTerms) { const tf = d.tf.get(t); if (tf) { word += idf(N, df.get(t) ?? 0) * bm25(tf, d.len, avg); hitTerms.push(t); } }
    let gram = 0; for (const g of qGrams) { const tf = d.gtf.get(g); if (tf) gram += idf(N, gdf.get(g) ?? 0) * bm25(tf, d.glen, gavg); }
    gram = qGrams.length ? gram / Math.sqrt(qGrams.length) : 0;
    const coveredIdx = qTa.map((_, i) => i).filter(i => covered[i][di]);
    const strong = hitTerms.some(t => [...t].length >= (isTa(t) ? 3 : 4) && (df.get(t) ?? 0) <= rare) || coveredIdx.some(i => [...stem(qTa[i])].length >= 4 && coverN[i] <= rare);
    const matched = new Set([...hitTerms, ...coveredIdx.map(i => term(qTa[i]))]); const share = [...matched].reduce((a, t) => a + qWeight(t), 0) / totalWeight;
    // a lone matching word is only enough when it carries a real share of a multi-word question ("Einstein relativity doctrine" must not match on "doctrine")
    const lone = qTerms.length < 3 || share >= 0.4;
    return { p: d.p, score: word + W.gram * gram, ok: (hitTerms.length >= 2 || coveredIdx.length >= 2 || strong) && (matched.size >= 2 || lone) };
  });
  return scored.filter(x => x.ok && x.score > 0).sort((a, b) => b.score - a.score).slice(0, k).map(x => x.p);
}
