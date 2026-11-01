// Pure grading helpers — no I/O, unit tested. All scoring happens on the server.
export type QType = 'mcq' | 'tf' | 'fill' | 'numeric' | 'short';
export type GradeOutcome = { kind: 'auto'; marks: number; correct: boolean } | { kind: 'manual' };

export const normalize = (s: unknown) => String(s ?? '').normalize('NFC').trim().toLowerCase().replace(/[\s.,;:!?'"]+/g, ' ').trim();
const num = (s: unknown) => { const t = String(s ?? '').replace(/[,\s₹]/g, '').trim(); if (t === '' || !/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return NaN; return Number(t); };

export function gradeAnswer(type: QType, answerKey: any, given: unknown, maxMarks: number): GradeOutcome {
  const empty = given === undefined || given === null || String(given).trim() === '';
  if (type === 'short') return empty ? { kind: 'auto', marks: 0, correct: false } : { kind: 'manual' };
  if (empty) return { kind: 'auto', marks: 0, correct: false };
  let ok = false;
  if (type === 'mcq' || type === 'tf') ok = Number(given) === Number(answerKey);
  else if (type === 'fill') ok = (answerKey.accept as string[]).some(a => normalize(a) === normalize(given));
  else if (type === 'numeric') { const g = num(given); ok = Number.isFinite(g) && Math.abs(g - answerKey.value) <= (answerKey.tol ?? 1e-9); }
  return { kind: 'auto', marks: ok ? maxMarks : 0, correct: ok };
}
export type ResultStatus = 'passed' | 'not_passed' | 'pending_review';
export function computeResult(marks: number, total: number, passPct: number, pendingManual: boolean) {
  const pct = total > 0 ? Math.round((marks / total) * 10000) / 100 : 0;
  const passMarks = Math.round(((passPct / 100) * total) * 100) / 100;
  const status: ResultStatus = pendingManual ? 'pending_review' : marks + 1e-9 >= passMarks ? 'passed' : 'not_passed';
  return { pct, passMarks, status };
}
