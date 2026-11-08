import express, { Router, Request, Response } from 'express';
import { z } from 'zod';
import { DB, q } from '../db';
import { rateLimit, requireRole, uid } from '../security';
import { iso } from '../clock';
import { parse, wrap, canAccessStudent } from '../http';
import { HttpError } from '../services/tests';
import { LlmClient, llmClientFromEnv, ollamaHealth } from '../services/llmEngine';
import { myProfile } from './student';
import { SttError, sttAllowed, sttMime } from '../services/stt';
import { TtsError } from '../services/tts';
import { TMODES, TLang, TMode, bothOrOne, T } from '../services/teacherPrompt';
import { Conv, Deps, QuizQ, cleanInput, initialState, makeQuiz, markQuiz, runTurn, saveTurn, history } from '../services/teacherFlow';
import { levelFor, logEvent, progressSummary, recordAnswer, topicKey } from '../services/mastery';

const LANGS = ['ta', 'en', 'both'] as const;
const MSG = z.string().min(1).max(1500);

/**
 * The free local AI teacher. Everything is scoped to the signed-in student: a conversation id that belongs to someone else is a 404.
 * The model is optional; with it down the student still gets the real textbook text (never an invented answer).
 */
export function aiTeacherRoutes(db: DB, opts: { llm?: LlmClient | null; timeoutMs?: number; stt?: any; tts?: any } = {}) {
  const r = Router(); const S = requireRole('student');
  const llm = opts.llm === undefined ? llmClientFromEnv() : opts.llm;
  const deps = (extra: Partial<Deps> = {}): Deps => ({ db, llm, timeoutMs: opts.timeoutMs ?? Number(process.env.TEACHER_TIMEOUT_MS ?? 90000), ...extra });
  const limit = rateLimit(Number(process.env.TEACHER_RATE ?? 30), 60000, req => `ait:${req.user?.id ?? req.ip}`);

  const guardian = async (userId: string) => {
    const p = await myProfile(db, userId); if (!p) throw new HttpError(404, 'Finish your student profile first.');
    if ((await q.get<any>(db, 'SELECT value FROM settings WHERE key=?', `under13:${userId}`))?.value === '1' && !p.guardian_approved) throw new HttpError(403, 'A parent or guardian needs to approve your account before you can use the AI teacher.');
    return p;
  };
  const load = async (id: string, studentId: string): Promise<Conv> => {
    const c = await q.get<any>(db, 'SELECT * FROM teacher_conversations WHERE id=? AND student_id=?', id, studentId);
    if (!c) throw new HttpError(404, 'Conversation not found.');
    return { ...c, state: { ...initialState(), ...JSON.parse(c.state || '{}') } };
  };
  const open = async (studentId: string, p: any, b: { mode: TMode; lang: TLang; subjectId?: string | null; title: string }): Promise<Conv> => {
    const id = uid(), now = iso();
    await q.run(db, 'INSERT INTO teacher_conversations(id,student_id,title,mode,lang,class_level,subject_id,lesson_id,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', id, studentId, b.title.slice(0, 80), b.mode, b.lang, p.class_level, b.subjectId ?? null, null, JSON.stringify(initialState()), now, now);
    return { id, student_id: studentId, mode: b.mode, lang: b.lang, class_level: p.class_level, subject_id: b.subjectId ?? null, state: initialState() };
  };
  const chatBody = z.object({ conversationId: z.string().max(60).optional(), message: MSG, mode: z.enum(TMODES as [TMode, ...TMode[]]).default('learn'), lang: z.enum(LANGS).default('both'), subjectId: z.string().max(40).nullish() });
  const resolve = async (req: Request) => {
    const b = parse(chatBody, req.body); const p = await guardian(req.user!.id); const text = cleanInput(b.message); if (!text) throw new HttpError(400, 'message: please type something.');
    let c: Conv;
    if (b.conversationId) { c = await load(b.conversationId, req.user!.id); c.mode = b.mode; c.lang = b.lang; await q.run(db, 'UPDATE teacher_conversations SET mode=?, lang=? WHERE id=?', b.mode, b.lang, c.id); }
    else c = await open(req.user!.id, p, { mode: b.mode, lang: b.lang, subjectId: b.subjectId, title: text });
    return { c, text };
  };

  r.use((req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please sign in.'))));

  r.get('/health', wrap(async (_req, res) => {
    const provider = (process.env.LLM_PROVIDER ?? '').toLowerCase();
    const model = provider === 'ollama' || !llm ? await ollamaHealth().catch(e => ({ up: false, error: String(e?.message ?? e), model: '', modelAvailable: false, models: [] as string[] })) : null;
    res.json({ ok: true, model: { provider: llm?.name ?? null, configured: !!llm, ...(model ?? { up: !!llm }) }, stt: { enabled: !!opts.stt, provider: opts.stt?.name ?? null }, tts: { enabled: !!opts.tts, provider: opts.tts?.name ?? null }, fallback: 'Without the model the teacher shows the textbook text itself; it never invents an answer.' });
  }));
  r.get('/config', wrap(async (_req, res) => res.json({ modes: TMODES, langs: LANGS, model: { enabled: !!llm, name: llm?.name ?? null }, stt: !!opts.stt, tts: !!opts.tts, maxMessage: 1500 })));

  r.get('/conversations', S, wrap(async (req, res) => res.json({ conversations: await q.all(db, 'SELECT id,title,mode,lang,subject_id,updated_at FROM teacher_conversations WHERE student_id=? ORDER BY updated_at DESC LIMIT 50', req.user!.id) })));
  r.get('/conversations/:id', S, wrap(async (req, res) => {
    const c = await load(req.params.id, req.user!.id);
    const messages = (await q.all<any>(db, 'SELECT id,role,content,meta,created_at FROM conversation_messages WHERE conversation_id=? ORDER BY created_at, rowid', c.id)).map(m => ({ ...m, meta: JSON.parse(m.meta || '{}') }));
    res.json({ conversation: { id: c.id, mode: c.mode, lang: c.lang, subjectId: c.subject_id, phase: c.state.phase }, messages });
  }));
  r.delete('/conversations/:id', S, wrap(async (req, res) => {
    const c = await load(req.params.id, req.user!.id);
    await q.run(db, 'DELETE FROM conversation_messages WHERE conversation_id=?', c.id); await q.run(db, 'DELETE FROM teacher_conversations WHERE id=?', c.id); res.json({ ok: true });
  }));

  const view = (c: Conv, rep: Awaited<ReturnType<typeof runTurn>>) => ({ conversationId: c.id, reply: rep.text, sections: rep.sections, sources: rep.refs, grounded: rep.grounded, offline: rep.offline, level: rep.level, phase: rep.state.phase, verdict: rep.verdict ?? null, topic: rep.topic ?? null });

  r.post('/chat', S, limit, wrap(async (req, res) => {
    const { c, text } = await resolve(req); const ac = new AbortController(); res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    const rep = await runTurn(deps(), c, text, ac.signal); await saveTurn(db, c, text, rep); res.json(view(c, rep));
  }));

  /** Server-sent events: `status`, then `delta` text as the model writes, then one `done` event with the final, parsed reply. */
  r.post('/stream', S, limit, wrap(async (req, res) => {
    const { c, text } = await resolve(req);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (ev: string, data: unknown) => { if (!res.writableEnded) res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); };
    const ac = new AbortController(); res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    const beat = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
    send('status', { conversationId: c.id, state: 'thinking' });
    try {
      const rep = await runTurn(deps({ onDelta: t => send('delta', { text: t }) }), c, text, ac.signal); await saveTurn(db, c, text, rep); send('done', view(c, rep));
    } catch (e: any) { send('error', { error: ac.signal.aborted ? 'Stopped.' : 'The teacher could not answer just now. Please try again.' }); }
    finally { clearInterval(beat); res.end(); }
  }));

  r.post('/reteach', S, limit, wrap(async (req, res) => {
    const b = parse(z.object({ conversationId: z.string().max(60) }), req.body); const c = await load(b.conversationId, req.user!.id);
    const last = (await history(db, c.id, 2)).find(m => m.role === 'user')?.text ?? c.state.topic ?? 'this topic';
    const wasLearn = c.mode; c.mode = 'learn'; c.state = { ...c.state, phase: 'check', question: c.state.question ?? 'Explain this idea in your own words.', topic: c.state.topic ?? last, wrong: Math.min(2, c.state.wrong) };
    const rep = await runTurn(deps(), c, 'I did not understand'); c.mode = wasLearn; await saveTurn(db, c, 'I did not understand this, please explain again.', rep); res.json(view(c, rep));
  }));

  r.post('/revision', S, limit, wrap(async (req, res) => {
    const b = parse(z.object({ topic: MSG, lang: z.enum(LANGS).default('both'), subjectId: z.string().max(40).nullish(), conversationId: z.string().max(60).optional() }), req.body); const p = await guardian(req.user!.id);
    const c = b.conversationId ? await load(b.conversationId, req.user!.id) : await open(req.user!.id, p, { mode: 'revision', lang: b.lang, subjectId: b.subjectId, title: `Revision: ${b.topic}` });
    c.mode = 'revision'; c.lang = b.lang; const rep = await runTurn(deps(), c, cleanInput(b.topic)); await saveTurn(db, c, `Revise: ${b.topic}`, rep); res.json(view(c, rep));
  }));

  // ---- quiz ----
  r.post('/quiz', S, limit, wrap(async (req, res) => {
    const b = parse(z.object({ topic: MSG, count: z.number().int().min(1).max(10).default(5), lang: z.enum(LANGS).default('both'), subjectId: z.string().max(40).nullish() }), req.body); const p = await guardian(req.user!.id);
    const ac = new AbortController(); res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    const out = await makeQuiz(deps(), { classLevel: p.class_level, subjectId: b.subjectId ?? null, topic: cleanInput(b.topic), count: b.count, lang: b.lang, signal: ac.signal });
    if (!out.questions.length) return void res.json({ quizId: null, questions: [], message: bothOrOne(b.lang, T.noSource.ta, T.noSource.en), offline: out.offline });
    const quizId = uid(); await q.run(db, 'INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)', `quiz:${req.user!.id}:${quizId}`, JSON.stringify({ topic: b.topic, subjectId: b.subjectId ?? null, classLevel: p.class_level, questions: out.questions, at: iso() }));
    res.json({ quizId, topic: b.topic, offline: out.offline, sources: out.refs, questions: out.questions.map(x => { const { answer: _a, ...rest } = x; return rest; }) });
  }));

  r.post('/evaluate', S, limit, wrap(async (req, res) => {
    const b = parse(z.object({ quizId: z.string().max(60), answers: z.array(z.object({ id: z.string().max(60), answer: z.string().max(600) })).min(1).max(20) }), req.body);
    const key = `quiz:${req.user!.id}:${b.quizId}`; const row = await q.get<any>(db, 'SELECT value FROM settings WHERE key=?', key); if (!row) throw new HttpError(404, 'Quiz not found or already marked.');
    const quiz = JSON.parse(row.value) as { topic: string; subjectId: string | null; classLevel: number; questions: QuizQ[] };
    const results = []; let got = 0, max = 0;
    for (const qs of quiz.questions) {
      const given = b.answers.find(a => a.id === qs.id)?.answer ?? ''; const m = markQuiz(qs, given); got += m.marks; max += qs.marks;
      const rec = await recordAnswer(db, { studentId: req.user!.id, subjectId: quiz.subjectId, classLevel: quiz.classLevel, topic: quiz.topic, correct: m.correct, conversationId: undefined });
      await q.run(db, 'INSERT INTO student_quiz_attempts(id,student_id,conversation_id,quiz_id,topic_key,qtype,question,answer_given,correct,marks,max_marks,at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', uid(), req.user!.id, null, b.quizId, rec.topicKey, qs.type, qs.question, given, m.correct ? 1 : 0, m.marks, qs.marks, iso());
      results.push({ id: qs.id, correct: m.correct, marks: m.marks, maxMarks: qs.marks, correctAnswer: qs.answer });
    }
    await logEvent(db, req.user!.id, 'quiz_done', { topicKey: topicKey(quiz.subjectId, quiz.topic), detail: { got, max } });
    await q.run(db, 'DELETE FROM settings WHERE key=?', key);
    res.json({ score: got, outOf: max, percent: max ? Math.round((got / max) * 100) : 0, results, level: await levelFor(db, req.user!.id, quiz.subjectId) });
  }));


  // ---- voice: local Whisper in, local TTS out; with neither configured the browser's own speech is used ----
  r.post('/voice/transcribe', S, limit, express.raw({ type: () => true, limit: '10mb' }), wrap(async (req, res) => {
    if (!opts.stt) throw new HttpError(501, 'Local speech recognition is not set up (STT_URL). Use the microphone button in a browser that supports it, or type your question.');
    const ct = String(req.headers['content-type'] ?? ''); if (!sttAllowed(ct)) throw new HttpError(415, 'Send the recording as webm, ogg, wav, mp3 or m4a.');
    const audio = req.body as Buffer; if (!Buffer.isBuffer(audio) || audio.length < 200) throw new HttpError(400, 'The recording is empty.');
    const lang = ['ta', 'en'].includes(String(req.query.lang)) ? (req.query.lang as 'ta' | 'en') : 'auto';
    const ac = new AbortController(); res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    try { const out = await opts.stt.transcribe(audio, sttMime(ct), lang, ac.signal); res.json({ text: out.text.slice(0, 1500), provider: opts.stt.name }); }
    catch (e) { if (e instanceof SttError) throw new HttpError(e.status === 499 ? 499 : e.status, e.message); throw e; }
  }));
  r.post('/voice/speak', S, limit, wrap(async (req, res) => {
    const b = parse(z.object({ text: z.string().min(1).max(500), lang: z.enum(['ta', 'en']).default('en') }), req.body);
    if (!opts.tts) throw new HttpError(501, 'Server voice is not set up. The page will use your browser voice instead.');
    const ac = new AbortController(); res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    try { const out = await opts.tts.synth(b.text.replace(/[\u0000-\u001f\u007f]/g, ' '), b.lang, ac.signal); res.setHeader('Content-Type', out.mime); res.setHeader('Cache-Control', 'private, no-store'); res.send(out.audio); }
    catch (e) { if (e instanceof TtsError) throw new HttpError(e.status === 499 ? 499 : e.status === 504 ? 504 : 502, e.message); throw e; }
  }));

  // ---- saved lessons ----
  r.get('/saved', S, wrap(async (req, res) => res.json({ lessons: (await q.all<any>(db, 'SELECT id,title,content,sources,created_at FROM saved_lessons WHERE student_id=? ORDER BY created_at DESC LIMIT 100', req.user!.id)).map(l => ({ ...l, sources: JSON.parse(l.sources) })) })));
  r.post('/saved', S, wrap(async (req, res) => {
    const b = parse(z.object({ title: z.string().min(1).max(120), content: z.string().min(1).max(8000), sources: z.array(z.any()).max(10).default([]), conversationId: z.string().max(60).optional() }), req.body); const id = uid();
    if (b.conversationId) await load(b.conversationId, req.user!.id);
    await q.run(db, 'INSERT INTO saved_lessons(id,student_id,title,content,sources,conversation_id,created_at) VALUES (?,?,?,?,?,?,?)', id, req.user!.id, b.title, b.content, JSON.stringify(b.sources), b.conversationId ?? null, iso()); res.status(201).json({ id });
  }));
  r.delete('/saved/:id', S, wrap(async (req, res) => { await q.run(db, 'DELETE FROM saved_lessons WHERE id=? AND student_id=?', req.params.id, req.user!.id); res.json({ ok: true }); }));

  return r;
}

/** GET /api/student/progress and /api/student/learning-history: the student's own, or a linked parent / teacher / school admin via ?studentId. */
export function studentProgressRoutes(db: DB) {
  const r = Router();
  const target = async (req: Request) => {
    if (!req.user) throw new HttpError(401, 'Please sign in.');
    const id = typeof req.query.studentId === 'string' && req.query.studentId ? req.query.studentId : req.user.id;
    if (!(await canAccessStudent(db, req.user, id))) throw new HttpError(403, 'You cannot see this student.'); return id;
  };
  r.get('/student/progress', wrap(async (req, res) => res.json(await progressSummary(db, await target(req)))));
  r.get('/student/learning-history', wrap(async (req, res: Response) => {
    const id = await target(req); const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    res.json({
      events: (await q.all<any>(db, 'SELECT event,topic_key,conversation_id,detail,at FROM student_learning_progress WHERE student_id=? ORDER BY at DESC, rowid DESC LIMIT ?', id, limit)).map(e => ({ ...e, detail: JSON.parse(e.detail || '{}') })),
      quizzes: await q.all(db, 'SELECT quiz_id,topic_key,qtype,question,correct,marks,max_marks,at FROM student_quiz_attempts WHERE student_id=? ORDER BY at DESC, rowid DESC LIMIT ?', id, limit),
      conversations: await q.all(db, 'SELECT id,title,mode,lang,updated_at FROM teacher_conversations WHERE student_id=? ORDER BY updated_at DESC LIMIT 20', id),
    });
  }));
  return r;
}
