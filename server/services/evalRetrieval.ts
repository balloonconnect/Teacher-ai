import { DB } from '../db';
import { textbookHits } from './tutor';

export type EvalItem = { q: string; pages: number[] };
export type EvalReport = { n: number; answerable: number; hitAt1: number; hitAt3: number; hitAt5: number; mrr: number; noAnswerCorrect: number; noAnswerTotal: number; misses: { q: string; wanted: number[]; got: number[] }[] };

/** Scores retrieval against labelled questions: for answerable ones, is a right page in the top 1/3/5 and where does the first right page rank; for questions the books cannot answer, does retrieval return nothing. */
export async function evaluate(db: DB, classLevel: number, items: EvalItem[], search = textbookHits): Promise<EvalReport> {
  const r: EvalReport = { n: items.length, answerable: 0, hitAt1: 0, hitAt3: 0, hitAt5: 0, mrr: 0, noAnswerCorrect: 0, noAnswerTotal: 0, misses: [] };
  for (const it of items) {
    const hits = await search(db, classLevel, null, it.q, 5); const got = hits.map(h => h.page as number);
    if (!it.pages.length) { r.noAnswerTotal++; if (!got.length) r.noAnswerCorrect++; else r.misses.push({ q: it.q, wanted: [], got }); continue; }
    r.answerable++; const rank = got.findIndex(p => it.pages.includes(p));
    if (rank === 0) r.hitAt1++; if (rank >= 0 && rank < 3) r.hitAt3++; if (rank >= 0) { r.hitAt5++; r.mrr += 1 / (rank + 1); } else r.misses.push({ q: it.q, wanted: it.pages, got });
  }
  r.mrr = r.answerable ? r.mrr / r.answerable : 0; return r;
}
export const fmt = (r: EvalReport) => {
  const p = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : '–');
  return [`questions: ${r.n} (${r.answerable} answerable, ${r.noAnswerTotal} not in the book)`, `right page ranked 1st: ${r.hitAt1}/${r.answerable} (${p(r.hitAt1, r.answerable)})`, `right page in top 3: ${r.hitAt3}/${r.answerable} (${p(r.hitAt3, r.answerable)})`, `right page in top 5: ${r.hitAt5}/${r.answerable} (${p(r.hitAt5, r.answerable)})`, `mean reciprocal rank: ${r.mrr.toFixed(2)}`, `correctly returned nothing: ${r.noAnswerCorrect}/${r.noAnswerTotal}`].join('\n');
};
