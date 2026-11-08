import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, PageTitle, Progress } from '../components/ui';
import { get, getCsrf, msg, post } from '../api';
import { canListen, canSpeak, recognize, Recognizer } from '../components/speech';

type L = 'ta' | 'en' | 'both' | 'tanglish'; type M = 'learn' | 'doubt' | 'homework' | 'exam' | 'revision' | 'voice';
type Sec = { tag: string; text: string }; type Ref = { bookId?: string; page?: number; label: string; n: number };
type Msg = { id: string; role: 'user' | 'ai'; text: string; sections?: Sec[]; refs?: Ref[]; grounded?: boolean; offline?: boolean; verdict?: boolean | null };
const MODES: [M, string, string][] = [['learn', 'Learn', 'கற்க'], ['doubt', 'Doubt', 'சந்தேகம்'], ['homework', 'Homework', 'வீட்டுப்பாடம்'], ['exam', 'Exam prep', 'தேர்வு'], ['revision', 'Revision', 'திருப்புதல்'], ['voice', 'Voice', 'குரல்']];
const SUBJ: [string, string][] = [['', 'Any subject'], ['maths', 'Maths'], ['science', 'Science'], ['english', 'English'], ['social', 'Social Science'], ['tamil', 'Tamil']];
const TAGS: Record<string, string> = { HOOK: '💡 Think about this', CONCEPT: '📘 The idea', VISUAL: '🗺️ Picture it', EXAMPLE: '🌱 Example', 'KEY POINTS': '⭐ Remember', CHECK: '❓ Your turn', SIMPLER: '🔁 Let me explain again', 'WELL DONE': '🎉 Well done', SUMMARY: '📝 Summary' };
let n = 0; const id = () => `m${Date.now().toString(36)}${n++}`;

async function sse(body: any, signal: AbortSignal, on: (t: string, d: any) => void) {
  const res = await fetch('/api/teacher/stream', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrf() }, body: JSON.stringify(body), credentials: 'same-origin', signal });
  if (!res.ok || !res.body) { let m = 'The teacher could not answer.'; try { m = (await res.json()).error ?? m; } catch { /* ignore */ } throw new Error(m); }
  const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) { const raw = buf.slice(0, i); buf = buf.slice(i + 2); const t = /^event: (.*)$/m.exec(raw)?.[1]; const d = /^data: (.*)$/m.exec(raw)?.[1]; if (t && d) on(t, JSON.parse(d)); }
  }
}

export function AiTeacher() {
  const [mode, setMode] = useState<M>('learn'); const [lang, setLang] = useState<L>('both'); const [subject, setSubject] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]); const [input, setInput] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [conv, setConv] = useState<string | undefined>(); const [prog, setProg] = useState<any>(null); const [cfg, setCfg] = useState<any>({}); const [health, setHealth] = useState<any>(null);
  const [listening, setListening] = useState(false); const ac = useRef<AbortController | null>(null); const rec = useRef<Recognizer | null>(null); const end = useRef<HTMLDivElement>(null);
  const [quiz, setQuiz] = useState<any>(null); const [answers, setAnswers] = useState<Record<string, string>>({}); const [score, setScore] = useState<any>(null);

  const loadProg = () => get('/student/progress').then(setProg).catch(() => {});
  useEffect(() => { get('/teacher/config').then(setCfg).catch(() => {}); get('/teacher/health').then(setHealth).catch(() => {}); loadProg(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs]);

  async function send(text = input) {
    text = text.trim(); if (!text || busy) return; setInput(''); setErr(''); setBusy(true);
    const aiId = id(); setMsgs(m => [...m, { id: id(), role: 'user', text }, { id: aiId, role: 'ai', text: '' }]);
    const a = new AbortController(); ac.current = a;
    try {
      await sse({ conversationId: conv, message: text, mode, lang, subjectId: subject || null }, a.signal, (t, d) => {
        if (t === 'status') setConv(d.conversationId);
        else if (t === 'delta') setMsgs(m => m.map(x => (x.id === aiId ? { ...x, text: x.text + d.text } : x)));
        else if (t === 'done') { setConv(d.conversationId); setMsgs(m => m.map(x => (x.id === aiId ? { ...x, text: d.reply, sections: d.sections, refs: d.sources, grounded: d.grounded, offline: d.offline, verdict: d.verdict ? d.verdict.correct : null } : x))); loadProg(); }
        else if (t === 'error') throw new Error(d.error);
      });
    } catch (e: any) { if (e?.name !== 'AbortError') { setErr(msg(e)); setMsgs(m => m.filter(x => x.id !== aiId)); } }
    finally { setBusy(false); ac.current = null; }
  }
  const stop = () => ac.current?.abort();
  const fresh = () => { stop(); setConv(undefined); setMsgs([]); setQuiz(null); setScore(null); };

  async function mic() {
    if (listening) { rec.current?.stop(); return; }
    const sl = lang === 'en' || lang === 'tanglish' ? 'en' : 'ta';
    if (cfg.stt && typeof MediaRecorder !== 'undefined') { // local Whisper on the server
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true }); const mr = new MediaRecorder(s); const chunks: Blob[] = []; setListening(true);
        mr.ondataavailable = e => chunks.push(e.data);
        mr.onstop = async () => { s.getTracks().forEach(t => t.stop()); setListening(false); try { const r = await fetch(`/api/teacher/voice/transcribe?lang=${sl}`, { method: 'POST', headers: { 'content-type': mr.mimeType || 'audio/webm', 'x-csrf-token': getCsrf() }, body: new Blob(chunks), credentials: 'same-origin' }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setInput(j.text); } catch (e) { setErr(msg(e)); } };
        rec.current = { stop: () => mr.stop() }; mr.start(); setTimeout(() => mr.state === 'recording' && mr.stop(), 30000); return;
      } catch { setErr('The microphone is not available. You can type instead.'); return; }
    }
    if (!canListen) { setErr('This browser cannot listen. Please type your question.'); return; }
    setListening(true);
    rec.current = recognize({ lang: sl, onInterim: setInput, onFinal: t => setInput(t), onSpeechStart: () => {}, onError: c => { setListening(false); setErr(c === 'not-allowed' ? 'Please allow the microphone.' : 'I could not hear you. Try again or type.'); }, onEnd: () => setListening(false) });
    if (!rec.current) setListening(false);
  }
  async function speak(text: string) {
    const clean = text.replace(/\[[A-Z ]+\]|\[\d+\]|[*#_`>-]/g, ' ').replace(/\s+/g, ' ').slice(0, 480); const l = /[஀-௿]/.test(clean) ? 'ta' : 'en';
    if (cfg.tts) { try { const r = await fetch('/api/teacher/voice/speak', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrf() }, body: JSON.stringify({ text: clean, lang: l }), credentials: 'same-origin' }); if (r.ok) { new Audio(URL.createObjectURL(await r.blob())).play(); return; } } catch { /* browser voice below */ } }
    if (canSpeak) { const u = new SpeechSynthesisUtterance(clean); u.lang = l === 'ta' ? 'ta-IN' : 'en-IN'; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } else setErr('This device has no voice. The text is above.');
  }
  async function save(m: Msg) { try { await post('/teacher/saved', { title: (msgs.find(x => x.role === 'user')?.text ?? 'Lesson').slice(0, 80), content: m.text, sources: m.refs ?? [], conversationId: conv }); setErr(''); alert('Saved to your lessons.'); } catch (e) { setErr(msg(e)); } }
  async function startQuiz() {
    const topic = [...msgs].reverse().find(x => x.role === 'user')?.text; if (!topic) { setErr('Ask about a topic first, then take a quiz on it.'); return; }
    try { setScore(null); setAnswers({}); const q = await post('/teacher/quiz', { topic, count: 5, lang: lang === 'tanglish' ? 'en' : lang, subjectId: subject || null }); if (!q.questions.length) { setErr(q.message); return; } setQuiz(q); } catch (e) { setErr(msg(e)); }
  }
  async function submitQuiz() { try { setScore(await post('/teacher/evaluate', { quizId: quiz.quizId, answers: Object.entries(answers).map(([qid, answer]) => ({ id: qid, answer })) })); loadProg(); } catch (e) { setErr(msg(e)); } }

  const down = health && !health.model?.configured;
  return (
    <div className="ait">
      <PageTitle title="AI Teacher" sub="Your Samacheer Kalvi teacher. Answers come from your class textbooks, with page numbers." right={<Button tone="secondary" onClick={fresh}>New chat</Button>} />
      {health && (down || health.model?.up === false) && <div className="ait-note" role="status">The AI model is not running on this computer. I will show what your textbook says instead. <Link to="/help">Help</Link></div>}
      <div className="ait-bar" role="toolbar" aria-label="Teacher settings">
        <div className="ait-tabs" role="tablist">{MODES.map(([k, en, ta]) => <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? 'on' : ''} onClick={() => { setMode(k); if (k !== 'voice' && lang === 'tanglish') setLang('both'); }}>{en}<small>{ta}</small></button>)}</div>
        <select aria-label="Language" value={lang} onChange={e => setLang(e.target.value as L)}><option value="both">தமிழ் + English</option><option value="ta">தமிழ்</option><option value="en">English</option>{mode === 'voice' && <option value="tanglish">Tanglish (voice only)</option>}</select>
        <select aria-label="Subject" value={subject} onChange={e => setSubject(e.target.value)}>{SUBJ.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
      </div>
      <div className="ait-grid">
        <Card className="ait-chat">
          <div className="ait-msgs" aria-live="polite">
            {!msgs.length && <div className="ait-empty"><h3>What shall we learn today?</h3><p>Try: “Teach me photosynthesis” in Learn mode, or ask any doubt from your book.</p></div>}
            {msgs.map(m => (
              <div key={m.id} className={`ait-m ${m.role}`}>
                {m.role === 'user' ? <p>{m.text}</p> : <>
                  {m.sections?.length ? m.sections.map((s, i) => <section key={i} className={`ait-sec ${s.tag === 'CHECK' ? 'check' : ''}`}>{s.tag !== 'text' && <h4>{TAGS[s.tag] ?? s.tag}</h4>}<p>{s.text}</p></section>) : <p className="pre">{m.text || (busy ? 'Thinking…' : '')}</p>}
                  {m.verdict != null && <Badge tone={m.verdict ? 'success' : 'warning'}>{m.verdict ? 'Correct' : 'Let us try again'}</Badge>}
                  {m.offline && <Badge tone="warning">From your textbook (AI off)</Badge>}
                  {!!m.refs?.length && <div className="chips">{m.refs.map(r => r.bookId ? <Link key={r.n} className="pill" target="_blank" to={`/app/textbook/${r.bookId}?page=${r.page}`}>[{r.n}] {r.label}</Link> : <span key={r.n} className="pill">[{r.n}] {r.label}</span>)}</div>}
                  {m.text && <div className="ait-act"><button onClick={() => speak(m.text)} aria-label="Read aloud">🔊 Listen</button><button onClick={() => save(m)}>🔖 Save</button></div>}
                </>}
              </div>
            ))}
            <div ref={end} />
          </div>
          {err && <div className="ait-err" role="alert">{err}</div>}
          <form className="ait-in" onSubmit={e => { e.preventDefault(); void send(); }}>
            <button type="button" className={`ait-mic ${listening ? 'on' : ''}`} onClick={mic} aria-label={listening ? 'Stop listening' : 'Speak your question'}>🎤</button>
            <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} rows={2} maxLength={1500} placeholder={mode === 'learn' ? 'Type a topic, or your answer…' : 'Type your question…'} aria-label="Your message" />
            {busy ? <Button type="button" tone="secondary" onClick={stop}>Stop</Button> : <Button type="submit" disabled={!input.trim()}>Send</Button>}
          </form>
        </Card>
        <aside className="ait-side">
          <Card><h3>My progress</h3>{prog ? <>
            <p>Level: <Badge tone="info">{prog.level}</Badge></p>
            <p className="muted">{prog.counts.questionsAsked} questions · {prog.counts.conceptsExplained} concepts · {prog.counts.correct} correct</p>
            {prog.topics.slice(0, 5).map((t: any) => <div key={t.topicKey}><small>{t.topic} {t.mastered && '✅'}</small><Progress pct={Math.round(t.score * 100)} /></div>)}
            {!!prog.weak.length && <><h4>Needs practice</h4><ul>{prog.weak.map((w: any) => <li key={w.topic_key}>{w.topic}</li>)}</ul></>}
          </> : <p className="muted">Loading…</p>}</Card>
          <Card><h3>Quiz</h3>
            {!quiz && <Button tone="secondary" onClick={startQuiz}>Quiz me on this topic</Button>}
            {quiz && !score && <form onSubmit={e => { e.preventDefault(); void submitQuiz(); }}>{quiz.questions.map((q: any, i: number) => <fieldset key={q.id}><legend>{i + 1}. {q.question} <small>({q.marks})</small></legend>
              {q.type === 'mcq' ? q.options.map((o: string) => <label key={o} className="ait-opt"><input type="radio" name={q.id} checked={answers[q.id] === o} onChange={() => setAnswers(a => ({ ...a, [q.id]: o }))} /> {o}</label> ) : <input value={answers[q.id] ?? ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} aria-label={`Answer ${i + 1}`} />}</fieldset>)}
              <Button type="submit">Check my answers</Button></form>}
            {score && <div><p><strong>{score.score}/{score.outOf}</strong> ({score.percent}%)</p>{quiz.questions.map((q: any, i: number) => { const r = score.results.find((x: any) => x.id === q.id); return <p key={q.id}>{r?.correct ? '✅' : '❌'} {i + 1}. {r?.correct ? 'Correct' : `Answer: ${r?.correctAnswer}`}</p>; })}<Button tone="secondary" onClick={() => { setQuiz(null); setScore(null); }}>Done</Button></div>}
          </Card>
        </aside>
      </div>
    </div>
  );
}
