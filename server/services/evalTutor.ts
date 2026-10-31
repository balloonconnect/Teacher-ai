import { DB } from '../db';
import { initialState } from './teach';
import { LlmClient, llmPlanner, llmStreamPlanner } from './llmEngine';
import type { EvalItem } from './evalRetrieval';

/**
 * Checks a real tutor model against labelled questions about the imported books.
 * Per question: did the model give a usable plan, did every step carry a book citation, did it cite the right page, was the Tamil real Tamil,
 * how long until the first step (streamed) and until the whole plan. For questions the books cannot answer: did the tutor refuse instead of answering.
 */
export type TutorRow = { q: string; answerable: boolean; ok: boolean; steps: number; cited: boolean; rightPage: boolean; tamil: boolean; firstStepMs: number | null; totalMs: number; fallback?: string; problem?: string };
export type TutorReport = { rows: TutorRow[]; answerable: number; usable: number; rightPage: number; allCited: number; tamilOk: number; refused: number; refusalTotal: number; fallbacks: number; p50FirstMs: number | null; p50TotalMs: number | null; p95TotalMs: number | null };
const TA = /[஀-௿]/;
const pct = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

export async function checkTutor(db: DB, client: LlmClient, classLevel: number, items: EvalItem[], o: { lang?: 'en' | 'ta' | 'both'; timeoutMs?: number; onRow?: (r: TutorRow) => void } = {}): Promise<TutorReport> {
  const rows: TutorRow[] = [];
  for (const it of items) {
    let fallback: string | undefined; const onFallback = (w: string) => { fallback = w; };
    const ctx = { db, userId: 'tutor-check', classLevel, lang: o.lang ?? 'both', subjectId: null, lessonId: null, state: initialState('teach') } as any;
    const t0 = Date.now(); let firstStepMs: number | null = null; let steps = 0; const texts: string[] = []; const refs = new Set<number>(); let allCited = true; let problem: string | undefined;
    try {
      const sp = client.stream ? await llmStreamPlanner(client, { onFallback, timeoutMs: o.timeoutMs })(db, ctx, it.q) : null;
      if (sp) {
        for await (const ev of sp) if (ev.type === 'step') { steps++; firstStepMs ??= Date.now() - t0; texts.push(ev.step.ta); for (const r of ev.refs ?? []) refs.add(r.page); if (!ev.sources?.length) allCited = false; }
      } else {
        const pl = await llmPlanner(client, { onFallback, timeoutMs: o.timeoutMs })(db, ctx, it.q); if (!pl) throw new Error("no plan"); steps = pl.steps.length;
        for (const s of pl.steps) texts.push(s.ta); for (const r of pl.refs) refs.add(r.page); allCited = pl.grounded !== 'none' && pl.sources.length > 0;
      }
    } catch (e: any) { problem = String(e?.message ?? e).slice(0, 100); }
    const totalMs = Date.now() - t0; const answerable = it.pages.length > 0;
    const tamil = !answerable || o.lang === 'en' || texts.some(t => TA.test(t));
    const rightPage = answerable && it.pages.some(p => refs.has(p));
    // For unanswerable questions "ok" means the tutor produced no model-written book-cited lesson at all (fallback to the honest rule answer is fine).
    const ok = answerable ? steps > 0 && allCited && !problem : (!fallback ? steps === 0 : true) && !refs.size;
    const row: TutorRow = { q: it.q, answerable, ok, steps, cited: steps > 0 && allCited, rightPage, tamil, firstStepMs, totalMs, fallback, problem };
    rows.push(row); o.onRow?.(row);
  }
  const ans = rows.filter(r => r.answerable); const first = ans.map(r => r.firstStepMs).filter((x): x is number => x != null); const tot = rows.map(r => r.totalMs);
  const neg = rows.filter(r => !r.answerable);
  return { rows, answerable: ans.length, usable: ans.filter(r => r.ok).length, rightPage: ans.filter(r => r.rightPage).length, allCited: ans.filter(r => r.cited).length, tamilOk: ans.filter(r => r.tamil && r.steps > 0).length, refused: neg.filter(r => r.ok).length, refusalTotal: neg.length, fallbacks: rows.filter(r => r.fallback).length, p50FirstMs: pct(first, 0.5), p50TotalMs: pct(tot, 0.5), p95TotalMs: pct(tot, 0.95) };
}
export function fmtTutor(r: TutorReport) {
  const p = (n: number, d: number) => `${n}/${d} (${d ? Math.round((100 * n) / d) : 0}%)`; const ms = (x: number | null) => (x == null ? '–' : `${(x / 1000).toFixed(1)} s`);
  return [`usable cited lesson: ${p(r.usable, r.answerable)}`, `cited the right book page: ${p(r.rightPage, r.answerable)}`, `Tamil present: ${p(r.tamilOk, r.answerable)}`, `refused when not in the book: ${p(r.refused, r.refusalTotal)}`, `fell back to rule-based: ${r.fallbacks}/${r.rows.length}`, `time to first step (median): ${ms(r.p50FirstMs)}   whole plan median/95th: ${ms(r.p50TotalMs)} / ${ms(r.p95TotalMs)}`].join('\n');
}
