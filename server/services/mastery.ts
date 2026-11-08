import { DB, q } from '../db';
import { iso } from '../clock';
import { uid } from '../security';

/**
 * The student understanding engine. Mastery comes from answers the student actually gave (check questions, quizzes), never from how many
 * messages were sent. Nothing is inferred from chat volume, and a topic with too little evidence stays "beginner" (meaning "not shown yet").
 */
export type Level = 'beginner' | 'developing' | 'intermediate' | 'advanced';
export const LEVELS: Level[] = ['beginner', 'developing', 'intermediate', 'advanced'];
export type Evidence = { attempts: number; correct: number; wrong: number; retries: number; recent: boolean[] };
export const emptyEvidence = (): Evidence => ({ attempts: 0, correct: 0, wrong: 0, retries: 0, recent: [] });

/** Smoothed accuracy: overall and the last five answers, so one old mistake does not hold a student back for ever. */
export function scoreOf(e: Evidence): number {
  if (!e.attempts) return 0;
  const overall = (e.correct + 0.5) / (e.attempts + 1);
  const last = e.recent.slice(-5); const recent = last.length ? last.filter(Boolean).length / last.length : overall;
  return Math.round((0.5 * overall + 0.5 * recent) * 1000) / 1000;
}
export function levelOf(e: Evidence): Level {
  const s = scoreOf(e);
  if (e.attempts < 2 || s < 0.45) return 'beginner';
  if (s < 0.7) return 'developing';
  if (s < 0.88 || e.attempts < 5) return 'intermediate';
  return 'advanced';
}
export const isMastered = (e: Evidence) => e.attempts >= 3 && e.recent.slice(-3).length === 3 && e.recent.slice(-3).every(Boolean) && scoreOf(e) >= 0.8;
export const isWeak = (e: Evidence) => e.wrong >= 2 && scoreOf(e) < 0.55 && !isMastered(e);
export function addAnswer(e: Evidence, correct: boolean, retry = false): Evidence {
  return { attempts: e.attempts + 1, correct: e.correct + (correct ? 1 : 0), wrong: e.wrong + (correct ? 0 : 1), retries: e.retries + (retry ? 1 : 0), recent: [...e.recent, correct].slice(-10) };
}
/** Stable key for a topic: subject + the topic words. */
export const topicKey = (subjectId: string | null | undefined, topic: string) => `${subjectId ?? 'x'}:${topic.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}஀-௿]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'general'}`;

export type MasteryRow = { topic_key: string; topic: string; subject_id: string | null; class_level: number | null; attempts: number; correct: number; wrong: number; retries: number; score: number; level: Level; mastered: number; recent: string; updated_at: string };

/** Store one answer and update the topic's mastery, level and weak-topic flag. Returns the new state. */
export async function recordAnswer(db: DB, o: { studentId: string; subjectId?: string | null; classLevel?: number | null; topic: string; correct: boolean; retry?: boolean; conversationId?: string }) {
  const key = topicKey(o.subjectId, o.topic); const now = iso();
  const prev = await q.get<MasteryRow>(db, 'SELECT * FROM student_topic_mastery WHERE student_id=? AND topic_key=?', o.studentId, key);
  const ev = addAnswer(prev ? { attempts: prev.attempts, correct: prev.correct, wrong: prev.wrong, retries: prev.retries, recent: JSON.parse(prev.recent) } : emptyEvidence(), o.correct, o.retry);
  const row = { score: scoreOf(ev), level: levelOf(ev), mastered: isMastered(ev) ? 1 : 0 };
  if (prev) await q.run(db, 'UPDATE student_topic_mastery SET attempts=?,correct=?,wrong=?,retries=?,score=?,level=?,mastered=?,recent=?,updated_at=? WHERE student_id=? AND topic_key=?', ev.attempts, ev.correct, ev.wrong, ev.retries, row.score, row.level, row.mastered, JSON.stringify(ev.recent), now, o.studentId, key);
  else await q.run(db, 'INSERT INTO student_topic_mastery(student_id,topic_key,topic,subject_id,class_level,attempts,correct,wrong,retries,score,level,mastered,recent,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', o.studentId, key, o.topic.slice(0, 120), o.subjectId ?? null, o.classLevel ?? null, ev.attempts, ev.correct, ev.wrong, ev.retries, row.score, row.level, row.mastered, JSON.stringify(ev.recent), now);
  const weak = await q.get<any>(db, 'SELECT * FROM student_weak_topics WHERE student_id=? AND topic_key=?', o.studentId, key);
  if (isWeak(ev)) { if (weak) await q.run(db, 'UPDATE student_weak_topics SET last_seen=?, wrong_count=?, resolved_at=NULL WHERE student_id=? AND topic_key=?', now, ev.wrong, o.studentId, key); else await q.run(db, 'INSERT INTO student_weak_topics(student_id,topic_key,topic,subject_id,since,last_seen,wrong_count) VALUES (?,?,?,?,?,?,?)', o.studentId, key, o.topic.slice(0, 120), o.subjectId ?? null, now, now, ev.wrong); }
  else if (weak && !weak.resolved_at && (isMastered(ev) || scoreOf(ev) >= 0.7)) await q.run(db, 'UPDATE student_weak_topics SET resolved_at=?, last_seen=? WHERE student_id=? AND topic_key=?', now, now, o.studentId, key);
  await logEvent(db, o.studentId, o.correct ? 'answer_correct' : 'answer_wrong', { topicKey: key, conversationId: o.conversationId, detail: { topic: o.topic, retry: !!o.retry } });
  return { topicKey: key, ...row, attempts: ev.attempts };
}
export async function logEvent(db: DB, studentId: string, event: string, o: { topicKey?: string; conversationId?: string; detail?: unknown } = {}) {
  await q.run(db, 'INSERT INTO student_learning_progress(id,student_id,event,topic_key,conversation_id,detail,at) VALUES (?,?,?,?,?,?,?)', uid(), studentId, event, o.topicKey ?? null, o.conversationId ?? null, JSON.stringify(o.detail ?? {}), iso());
}
/** The level the AI should teach at: the average of this subject's topics that have enough evidence, else beginner. */
export async function levelFor(db: DB, studentId: string, subjectId?: string | null): Promise<Level> {
  const rows = (await q.all<MasteryRow>(db, 'SELECT * FROM student_topic_mastery WHERE student_id=?' + (subjectId ? ' AND subject_id=?' : ''), ...(subjectId ? [studentId, subjectId] : [studentId]))).filter(r => r.attempts >= 2);
  if (!rows.length) return 'beginner';
  const avg = rows.reduce((s, r) => s + LEVELS.indexOf(r.level), 0) / rows.length; return LEVELS[Math.min(3, Math.round(avg))];
}
export async function progressSummary(db: DB, studentId: string) {
  const topics = await q.all<MasteryRow>(db, 'SELECT * FROM student_topic_mastery WHERE student_id=? ORDER BY updated_at DESC', studentId);
  const weak = await q.all<any>(db, 'SELECT topic_key, topic, subject_id, since, last_seen, wrong_count FROM student_weak_topics WHERE student_id=? AND resolved_at IS NULL ORDER BY last_seen DESC', studentId);
  const n = async (ev: string) => Number((await q.get<any>(db, 'SELECT COUNT(*) n FROM student_learning_progress WHERE student_id=? AND event=?', studentId, ev))?.n ?? 0);
  const quiz = (await q.get<any>(db, 'SELECT COUNT(*) n, COALESCE(SUM(marks),0) m, COALESCE(SUM(max_marks),0) t FROM student_quiz_attempts WHERE student_id=?', studentId))!;
  return {
    level: await levelFor(db, studentId),
    counts: { questionsAsked: await n('question'), conceptsExplained: await n('concept'), correct: await n('answer_correct'), incorrect: await n('answer_wrong'), retries: topics.reduce((s, t) => s + t.retries, 0) },
    topics: topics.map(t => ({ topicKey: t.topic_key, topic: t.topic, subjectId: t.subject_id, level: t.level, score: t.score, attempts: t.attempts, mastered: !!t.mastered })),
    mastered: topics.filter(t => t.mastered).map(t => t.topic), weak,
    quiz: { attempts: quiz.n, scorePct: quiz.t ? Math.round((quiz.m / quiz.t) * 100) : null },
  };
}
