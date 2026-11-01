import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Async, Badge, Button, Card, Empty, Icon, Loading, Modal, PageTitle, Progress, ScoreRing, fmtDT, fmtDate, useLoad, ErrorState } from '../components/ui';
import { Bi } from '../components/lang';
import { get, post, put, msg, ApiError } from '../api';
import { useToast } from '../components/toast';
import { QuestionInput } from './student';

const stTone: Record<string, any> = { Upcoming: 'neutral', Available: 'info', 'In progress': 'warning', 'Pending review': 'warning', Passed: 'success', 'Not passed': 'danger', Expired: 'neutral' };

export function TestsList() {
  const s = useLoad(() => get('/tests')); const [view, setView] = useState<'list' | 'cal'>('list'); const [f, setF] = useState('all');
  return <div className="col"><PageTitle title={<Bi en="Weekly tests" ta="வாராந்திரத் தேர்வுகள்" />} sub="All times are in India Standard Time (IST)."
    right={<div className="lang" role="group" aria-label="View"><button aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button><button aria-pressed={view === 'cal'} onClick={() => setView('cal')}>Calendar</button></div>} />
    <div className="row wrap" role="group" aria-label="Filter">{[['all', 'All'], ['open', 'Open now'], ['Upcoming', 'Upcoming'], ['done', 'Completed'], ['Expired', 'Expired']].map(([k, t]) => <button key={k} className={`pill ${f === k ? 'on' : ''}`} onClick={() => setF(k)}>{t}</button>)}</div>
    <Async s={s}>{d => {
      const tests = d.tests.filter((t: any) => f === 'all' || (f === 'open' && ['Available', 'In progress'].includes(t.status)) || (f === 'done' && ['Passed', 'Not passed', 'Pending review'].includes(t.status)) || t.status === f);
      if (!tests.length) return <Empty title="No tests here" text={d.tests.length ? 'No tests match this filter.' : 'No weekly tests are published for your class yet.'} />;
      if (view === 'cal') { const days = new Map<string, any[]>(); tests.forEach((t: any) => { const k = t.opens_at.slice(0, 10); days.set(k, [...(days.get(k) ?? []), t]); });
        return <Card className="col">{[...days].sort().map(([day, ts]) => <div key={day}><h3>{fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>{ts.map((t: any) => <Link to={`/app/tests/${t.id}`} className="row wrap listrow" key={t.id}><span className="grow semi">{t.title}</span><span className="muted small">{fmtDT(t.opens_at)} → {fmtDT(t.closes_at)}</span><Badge tone={stTone[t.status]}>{t.status}</Badge></Link>)}</div>)}</Card>; }
      return <div className="grid g2">{tests.map((t: any) => (
        <Card key={t.id} className="col"><div className="row wrap"><Badge tone="neutral">{t.subject_en}</Badge>{t.week_no && <Badge tone="neutral">Week {t.week_no}</Badge>}<div className="grow" /><Badge tone={stTone[t.status]}>{t.status}</Badge></div>
          <h3>{t.title}</h3><div className="muted small">{t.question_count} questions · {t.total_marks} marks · {t.duration_min ? `${t.duration_min} min` : 'untimed'} · pass {t.pass_pct}%</div>
          <div className="small">{t.status === 'Upcoming' ? `Opens ${fmtDT(t.opens_at)}` : `Closes ${fmtDT(t.closes_at)}`}</div>
          {t.best && <div className="small">Best: <b>{t.best.marks}/{t.best.total}</b> ({t.best.pct}%)</div>}
          <div className="row"><Button to={`/app/tests/${t.id}`} tone={t.canStart ? 'primary' : 'secondary'}>{t.status === 'In progress' ? 'Resume' : t.canStart ? 'View & start' : 'View'}</Button></div></Card>))}</div>; }}</Async></div>;
}

export function TestDetail() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast(); const s = useLoad(() => get(`/tests/${id}`), [id]); const [conf, setConf] = useState(false); const [busy, setBusy] = useState(false);
  const start = async () => { setBusy(true); try { const d = await post(`/tests/${id}/attempts`); nav(`/app/take/${d.attemptId}`); } catch (e) { toast(msg(e), 'err'); setConf(false); s.reload(); } finally { setBusy(false); } };
  return <Async s={s}>{d => { const t = d.test; const resume = t.status === 'In progress'; const left = Math.max(0, t.max_attempts - t.attemptsUsed);
    const why = t.canStart ? '' : t.status === 'Upcoming' ? `This test opens ${fmtDT(t.opens_at)}.` : t.status === 'Expired' ? 'This test has closed.' : t.status === 'Passed' ? 'You have already passed this test.' : t.status === 'Pending review' ? 'Your answers are waiting for teacher review.' : 'You have used all your attempts.';
    return <div className="col"><Link to="/app/tests" className="link row" style={{ gap: 4 }}><Icon name="back" size={16} />All tests</Link>
      <PageTitle title={t.title} sub={`${t.subject_en} · Class ${t.class_level} · ${t.board} · ${t.academic_year}`} right={<Badge tone={stTone[t.status]}>{t.status}</Badge>} />
      <div className="grid g4 stat"><Card><b>{t.question_count}</b><div className="muted small">Questions</div></Card><Card><b>{t.total_marks}</b><div className="muted small">Total marks</div></Card><Card><b>{t.duration_min ? `${t.duration_min} min` : 'Untimed'}</b><div className="muted small">Duration</div></Card><Card><b>{t.pass_pct}% ({t.pass_marks} marks)</b><div className="muted small">To pass</div></Card></div>
      <Card className="col"><h2>Before you begin</h2><ul>
        <li>Opens {fmtDT(t.opens_at)} · closes {fmtDT(t.closes_at)} (IST).</li>
        <li>You have {t.max_attempts} attempt(s). {t.attemptsUsed} used. Scoring rule: {t.score_rule === 'highest' ? 'highest score counts' : 'latest score counts'}.</li>
        {t.duration_min && <li>The timer starts when you press Start and is kept by the server. If it runs out, your answers are submitted automatically.</li>}
        <li>{t.allow_change_answers ? 'You can change answers until you submit.' : 'Answers cannot be changed once saved.'}</li><li>Question types: {t.question_types.filter(Boolean).join(', ')}. Written answers are marked by your teacher.</li>
        <li>{t.awards_certificate ? 'Passing earns an achievement certificate.' : 'This test does not award a certificate.'}</li>
        <li>{t.show_review === 0 ? 'Answer review is not available for this test.' : t.show_review === 2 ? 'Answer review opens after the test closes.' : 'You can review answers after you submit.'}</li></ul>
        {t.instructions && <div className="notice info"><Icon name="info" />{t.instructions}</div>}
        <div className="row wrap">{(t.canStart || resume) ? <Button onClick={() => (resume ? nav(`/app/take/${t.inProgressId}`) : setConf(true))}>{resume ? 'Resume test' : d.attempts.length ? 'Start retake' : 'Start test'}</Button> : <Button disabled>{why ? 'Not available' : 'Start'}</Button>}{why && <span className="muted">{why}</span>}</div></Card>
      {!!d.attempts.length && <Card className="col"><h2>Your attempts</h2>{d.attempts.map((a: any) => <div key={a.id} className="row wrap listrow"><b>Attempt {a.attempt_no}</b><span className="grow muted small">{a.submitted_at ? fmtDT(a.submitted_at) : 'In progress'}</span>{a.marks != null && <b>{a.marks}/{a.total}</b>}{a.status === 'pending_review' ? <Badge tone="warning">Pending review</Badge> : a.result ? <Badge tone={a.result === 'passed' ? 'success' : 'danger'}>{a.result === 'passed' ? 'Passed' : 'Not passed'}</Badge> : <Badge tone="warning">In progress</Badge>}
        <Button tone="secondary" to={a.status === 'in_progress' ? `/app/take/${a.id}` : `/app/result/${a.id}`}>{a.status === 'in_progress' ? 'Resume' : 'Result'}</Button></div>)}</Card>}
      {conf && <Modal title="Start the test?" onClose={() => setConf(false)}><p>{t.duration_min ? `Your ${t.duration_min}-minute timer starts now and cannot be paused.` : 'You can answer at your own pace until the test closes.'} This will use one of your {left} remaining attempt(s).</p><div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><Button tone="secondary" onClick={() => setConf(false)}>Not yet</Button><Button onClick={start} disabled={busy}>{busy ? 'Starting…' : 'Start now'}</Button></div></Modal>}</div>; }}</Async>;
}

const clock = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${h ? h + ':' : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(x).padStart(2, '0')}`; };

export function TakeTest() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast();
  const [att, setAtt] = useState<any>(null); const [err, setErr] = useState(''); const [ans, setAns] = useState<Record<string, any>>({}); const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [i, setI] = useState(0); const [left, setLeft] = useState<number | null>(null); const [save, setSave] = useState<'saved' | 'saving' | 'error'>('saved'); const [sub, setSub] = useState(false); const [busy, setBusy] = useState(false); const [warn, setWarn] = useState('');
  const dirty = useRef<Set<string>>(new Set()); const offset = useRef(0); const submitting = useRef(false); const ansRef = useRef(ans); ansRef.current = ans; const flagRef = useRef(flags); flagRef.current = flags;
  useEffect(() => { (async () => { try { const d = await get(`/attempts/${id}`); const a = d.attempt; if (a.status !== 'in_progress') { nav(`/app/result/${id}`, { replace: true }); return; } offset.current = new Date(a.serverTime).getTime() - Date.now(); setAtt(a);
    const x: any = {}, fl: any = {}; a.questions.forEach((q: any) => { if (q.answer !== null && q.answer !== undefined) x[q.id] = q.answer; if (q.flagged) fl[q.id] = true; }); setAns(x); setFlags(fl); } catch (e) { setErr(msg(e)); } })(); }, [id, nav]);
  const items = (ids?: string[]) => (ids ?? Object.keys(ansRef.current)).map(qid => ({ questionId: qid, answer: ansRef.current[qid] ?? '', flagged: !!flagRef.current[qid] }));
  const flush = useCallback(async () => { if (!dirty.current.size || submitting.current) return true; const ids = [...dirty.current]; setSave('saving'); try { await put(`/attempts/${id}/answers`, { items: items(ids) }); ids.forEach(k => dirty.current.delete(k)); setSave(dirty.current.size ? 'saving' : 'saved'); return true; } catch (e) { if (e instanceof ApiError && e.status === 409) { setSave('saved'); finish(true); return false; } setSave('error'); return false; } }, [id]); // eslint-disable-line
  useEffect(() => { const t = setInterval(() => { if (dirty.current.size) flush(); }, 1500); return () => clearInterval(t); }, [flush]);
  useEffect(() => { const b = (e: BeforeUnloadEvent) => { if (dirty.current.size) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', b); return () => window.removeEventListener('beforeunload', b); }, []);
  const finish = useCallback(async (auto = false) => { if (submitting.current) return; submitting.current = true; setBusy(true);
    try { await post(`/attempts/${id}/submit`, { items: items() }); if (auto) toast('Time is up — your answers were submitted.'); nav(`/app/result/${id}`, { replace: true }); }
    catch (e) { submitting.current = false; setBusy(false); toast(msg(e), 'err'); } }, [id, nav, toast]);
  useEffect(() => { if (!att) return; const dl = new Date(att.deadline_at).getTime(); let said5 = false, said1 = false;
    const t = setInterval(() => { const r = dl - (Date.now() + offset.current); setLeft(r); if (att.rules.duration_min) { if (r <= 300000 && !said5) { said5 = true; setWarn('5 minutes left'); } if (r <= 60000 && !said1) { said1 = true; setWarn('1 minute left'); } } if (r <= 0) { clearInterval(t); finish(true); } }, 500); return () => clearInterval(t); }, [att, finish]);
  if (err) return <ErrorState text={err} retry={() => location.reload()} />;
  if (!att) return <Loading text="Loading your test…" />;
  const qs = att.questions; const q = qs[i]; const answered = (k: string) => ans[k] !== undefined && String(ans[k]) !== ''; const nAns = qs.filter((x: any) => answered(x.id)).length; const unans = qs.length - nAns; const nFlag = Object.values(flags).filter(Boolean).length;
  const set = (v: any) => { setAns(a => ({ ...a, [q.id]: v })); dirty.current.add(q.id); setSave('saving'); };
  const locked = !att.rules.allow_change_answers && answered(q.id) && !dirty.current.has(q.id);
  return (
    <div className="col takepage">
      <div className="takebar"><div className="grow"><b className="ell">{att.context.test_title}</b><div className="muted xs">Attempt {att.context.attempt_no ?? ''} · {nAns}/{qs.length} answered</div></div>
        <span className={`savestate ${save}`} aria-live="polite">{save === 'saved' ? '✓ Saved' : save === 'saving' ? 'Saving…' : 'Not saved — retrying'}</span>
        {left !== null && <div className={`timer ${left < 60000 ? 'crit' : left < 300000 ? 'warn' : ''}`} role="timer" aria-label="Time remaining"><Icon name="clock" size={16} /> {clock(left)}</div>}</div>
      <div className="sr" role="alert">{warn}</div>{warn && <div className="notice warn" role="status"><Icon name="alert" />{warn}</div>}
      <Progress pct={Math.round((nAns / qs.length) * 100)} label="Answered" />
      <div className="takegrid">
        <Card className="col"><QuestionInput q={q} n={i + 1} value={ans[q.id]} onChange={set} disabled={locked} />
          {locked && <div className="muted small">This test does not allow changing saved answers.</div>}
          <div className="row wrap"><Button tone="secondary" onClick={() => { setFlags(f => ({ ...f, [q.id]: !f[q.id] })); dirty.current.add(q.id); }} aria-pressed={!!flags[q.id]}><Icon name="flag" size={16} /> {flags[q.id] ? 'Flagged' : 'Flag for review'}</Button><div className="grow" />
            <Button tone="secondary" disabled={i === 0} onClick={() => { flush(); setI(i - 1); }}>← Previous</Button>
            {i < qs.length - 1 ? <Button onClick={() => { flush(); setI(i + 1); }}>Next →</Button> : <Button tone="teal" onClick={async () => { await flush(); setSub(true); }}>Review & submit</Button>}</div></Card>
        <Card className="col navcard"><h3>Questions</h3><div className="qnav" role="group" aria-label="Question navigator">{qs.map((x: any, k: number) => <button key={x.id} className={`${k === i ? 'cur' : ''} ${answered(x.id) ? 'ans' : ''} ${flags[x.id] ? 'flag' : ''}`} aria-label={`Question ${k + 1}, ${answered(x.id) ? 'answered' : 'not answered'}${flags[x.id] ? ', flagged' : ''}`} aria-current={k === i} onClick={() => { flush(); setI(k); }}>{k + 1}</button>)}</div>
          <div className="legend small muted"><span><i className="ans" /> answered</span><span><i className="flag" /> flagged</span><span><i /> not answered</span></div>
          <Button tone="teal" onClick={async () => { await flush(); setSub(true); }}>Submit test</Button></Card>
      </div>
      {sub && <Modal title="Submit your test?" onClose={() => !busy && setSub(false)}>
        <p>You answered <b>{nAns}</b> of <b>{qs.length}</b> questions.</p>{unans > 0 && <div className="notice warn"><Icon name="alert" />{unans} question(s) unanswered{qs.filter((x: any) => !answered(x.id)).slice(0, 8).map((x: any) => ` Q${x.position}`).join(',')}.</div>}{nFlag > 0 && <p className="muted">{nFlag} flagged for review.</p>}
        <p className="muted small">After you submit you cannot change your answers.</p>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><Button tone="secondary" disabled={busy} onClick={() => setSub(false)}>Keep working</Button><Button tone="teal" disabled={busy} onClick={() => finish(false)}>{busy ? 'Submitting…' : 'Submit now'}</Button></div></Modal>}
    </div>
  );
}

export function Result() {
  const { id } = useParams(); const s = useLoad(() => get(`/attempts/${id}/result`), [id]);
  return <Async s={s}>{({ result: r }) => { const pend = r.status === 'pending_review'; const pass = r.status === 'passed';
    return <div className="col"><PageTitle title={r.testTitle} sub={`${r.subject_en} · Class ${r.classLevel} · Attempt ${r.attemptNo} · ${fmtDT(r.attemptedAt)}`} />
      <Card className="resulthero"><ScoreRing pct={r.pct} color={pend ? 'var(--warning)' : pass ? 'var(--success)' : 'var(--danger)'} label={`${r.marks}/${r.total}`} sub={`${r.pct}%`} />
        <div className="col grow">{pend ? <><Badge tone="warning">Pending teacher review</Badge><h2>Your result is not final yet</h2><p>Some answers need your teacher to mark them. The marks shown so far are only for the questions already checked. You will be notified when the result is final.</p></>
          : pass ? <><Badge tone="success">Passed</Badge><h2><Bi en="Well done!" ta="நன்று!" /></h2><p>You scored {r.marks} out of {r.total} ({r.pct}%). The pass mark was {r.passMarks} ({r.passPct}%).</p></>
          : <><Badge tone="danger">Not passed yet</Badge><h2>Keep going — you can improve</h2><p>You scored {r.marks} out of {r.total} ({r.pct}%). You needed {r.passMarks} ({r.passPct}%) to pass.</p></>}
          <div className="muted small">{r.correctCount} of {r.questionCount} questions fully correct{r.pendingManual ? ` · ${r.pendingManual} awaiting review` : ''}</div>
          <div className="row wrap">{r.reviewAvailable && <Button tone="secondary" to={`/app/review/${r.attemptId}`}>Review answers</Button>}{r.retake.allowed && <Button to={`/app/tests/${r.testId}`}>Retake ({r.retake.attemptsLeft} left)</Button>}<Button tone="secondary" to="/app/tests">All tests</Button></div></div></Card>
      {r.certificate ? <Card className="gold row wrap"><Icon name="award" size={28} /><div className="grow"><b>Certificate earned</b><div className="muted small">Reference {r.certificate.ref_no}</div></div><Button to="/app/certificates">View certificate</Button></Card>
        : pass && !r.certificateEligible ? <Card><p className="muted">This test does not award a certificate.</p></Card> : pass ? <Card><p className="muted">Your certificate is being prepared. Check <Link to="/app/certificates" className="link">My certificates</Link>.</p></Card> : null}
      {!!r.topics.length && <Card className="col"><h2>Topic-wise performance</h2>{r.topics.map((t: any) => <div key={t.topic} className="col" style={{ gap: 4 }}><div className="row"><span className="grow">{t.topic}</span><b>{t.got}/{t.max}</b></div><Progress pct={t.pct} color={t.pct >= 70 ? 'var(--success)' : 'var(--warning)'} label={t.topic} /></div>)}
        {!!r.revision.length && <div className="notice info"><Icon name="target" /><span>Revise: {r.revision.join(', ')}. <Link to="/app/progress" className="link">See revision plan with lessons and mind maps</Link></span></div>}</Card>}
      {!!r.nextTests.length && <Card className="col"><h2>What’s next</h2>{r.nextTests.map((t: any) => <div key={t.id} className="row wrap listrow"><span className="grow">{t.title}</span><span className="muted small">opens {fmtDT(t.opens_at)}</span><Button tone="secondary" to={`/app/tests/${t.id}`}>View</Button></div>)}</Card>}</div>; }}</Async>;
}

export function Review() {
  const { id } = useParams(); const s = useLoad(() => get(`/attempts/${id}/review`), [id]);
  return <div className="col"><Link to={`/app/result/${id}`} className="link row" style={{ gap: 4 }}><Icon name="back" size={16} />Back to result</Link><PageTitle title="Answer review" />
    <Async s={s}>{d => d.review.map((r: any) => (
      <Card key={r.id} className={`col review ${r.status}`}><div className="row wrap"><b className="grow">Q{r.position}. <Bi en={r.text_en} ta={r.text_ta ?? r.text_en} /></b><Badge tone={r.status === 'correct' ? 'success' : r.status === 'partial' ? 'warning' : r.status === 'pending_review' ? 'warning' : 'danger'}>{r.status === 'pending_review' ? 'Awaiting review' : r.status === 'correct' ? 'Correct' : r.status === 'partial' ? 'Partly correct' : 'Incorrect'}</Badge><b>{r.marks ?? '—'}/{r.max}</b></div>
        <div className="small"><b>Your answer:</b> {fmtAns(r, r.yourAnswer)}</div>{r.correctAnswer !== null && r.status !== 'correct' && <div className="small"><b>{r.type === 'short' ? 'Marking guide' : 'Correct answer'}:</b> {fmtAns(r, r.correctAnswer)}</div>}
        {r.feedback && <div className="notice info"><Icon name="chat" />Teacher: {r.feedback}</div>}{r.explanation_en && <div className="muted small"><b>Explanation:</b> <Bi en={r.explanation_en} ta={r.explanation_ta ?? r.explanation_en} /></div>}</Card>))}</Async></div>;
}
function fmtAns(r: any, v: any) { if (v === null || v === undefined || v === '') return '— (no answer)'; if (r.type === 'mcq') return `${String.fromCharCode(65 + Number(v))}. ${r.options[Number(v)] ?? ''}`; if (r.type === 'tf') return Number(v) === 0 ? 'True' : 'False'; return String(v); }
