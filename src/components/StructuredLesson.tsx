import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Async, Badge, Button, Card, Empty, useLoad } from './ui';
import { Bi, useLang } from './lang';
import { get, post, msg } from '../api';
import { useToast } from './toast';
import { useAuth } from '../auth';
import { normalizeTamil } from '../../shared/tamil';
import { TamilVoice } from './TamilVoice';
import { MindMapView } from './MindMap';

type Item = { id: string; ord: number; kind: string; section: string; page: number; number?: string; numberRead?: string; group?: string; title?: string; by?: string; lines: string[]; meaning?: string[]; device?: string; parent?: string; word?: { term: string; meaning: string }; question?: { type: string; category?: string; options?: string[] }; flags: string[]; uncertain?: number[] };
type Seg = { id: string; role: string; heading: string; page: number; itemIds: string[] };
const ROLE: Record<string, [string, string]> = { objectives: ['Learning objectives', 'கற்றல் நோக்கங்கள்'], intro: ['Before you begin', 'நுழையும்முன்'], author: ['About the author or book', 'நூல் வெளி'], poem: ['Poem', 'கவிதைப்பேழை'], prose: ['Prose', 'உரைநடை'], grammar: ['Grammar', 'இலக்கணம்'], glossary: ['Word meanings', 'சொல்லும் பொருளும்'], meaning: ['Meaning of the poem', 'பாடலின் பொருள்'], devices: ['Poetic devices', 'நயம்'], activities: ['Exercises', 'கற்பவை கற்றபின்'], qgroup: ['Questions', 'வினாக்கள்'], language: ['Language activities', 'மொழிப் பயிற்சி'], body: ['Lesson', 'பாடம்'] };
const FLAG: Record<string, string> = { ocr_uncertain: 'Some letters may be misread — check the printed page', number_misread: 'The number was misread; shown in book order', meaning_missing: 'The textbook meaning was not found', shape_irregular: 'This does not look like a complete couplet — check the printed page', number_out_of_order: 'Numbering is out of order — check the printed page', options_incomplete: 'Fewer than 4 options were read', pair_split_unsure: 'The word and meaning may be paired wrongly', poet_not_found: 'The poet’s name was not found', stanza_breaks_unclear: 'Stanza breaks are unclear' };
const label = (it: Item) => it.kind === 'couplet' ? `குறள் ${it.number}` : it.kind === 'stanza' ? `பாடல் ${it.number}` : it.kind === 'question' ? `வினா ${it.number ?? ''}` : (it.title ?? '');
const speakText = (its: Item[]) => its.map(i => [i.title, ...i.lines, ...(i.meaning ?? [])].filter(Boolean).join('. ')).join('. ');
export const Flags = ({ it }: { it: Item }) => it.flags.length ? <div className="row wrap">{it.flags.map(f => <Badge key={f} tone="warning">{FLAG[f] ?? f}</Badge>)}</div> : null;

/** True when this printed line is part of the piece of text the voice is reading right now (or the piece is part of a long line). */
const isReading = (line: string, chunk?: string | null) => { if (!chunk) return false; const a = normalizeTamil(line), b = normalizeTamil(chunk); return a.length > 1 && (b.includes(a) || a.includes(b)); };
function Source({ it, reading }: { it: Item; reading?: string | null }) {
  const bad = new Set(it.uncertain ?? []);
  return <div className="srcbox" lang="ta"><div className="srctag"><Bi en="From the textbook" ta="பாடநூலில் உள்ளபடி" /> · p.{it.page}</div>
    {it.kind === 'word' ? <p className="ta"><b>{it.word?.term}</b> — {it.word?.meaning}</p> : <div className="ta verse">{it.lines.map((l, i) => <div key={i} className={`${bad.has(i) ? 'uncertain' : ''}${isReading(l, reading) ? ' reading' : ''}`} ref={el => { if (el && isReading(l, reading)) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }}>{l}</div>)}</div>}
    {!!it.meaning?.length && <p className="ta"><b>பொருள்: </b>{it.meaning.join(' ')}</p>}{it.device && <p className="ta"><b>அணி: </b>{it.device}</p>}
    {it.question?.options?.length ? <ul className="ta opts">{it.question.options.map(o => <li key={o}>{o}</li>)}</ul> : null}</div>;
}

export function StructuredLesson({ lessonId }: { lessonId: string }) {
  const [sp, setSp] = useSearchParams(); const view = sp.get('view') ?? 'overview'; const cur = sp.get('item');
  const s = useLoad(() => get(`/lessons/${lessonId}/structure`), [lessonId]); const pg = useLoad(() => get(`/lessons/${lessonId}/progress`), [lessonId]); const prog = pg.data as { total: number; completed: number; items: Record<string, any>; last: string | null; revision: string[] } | null;
  const go = (v: string, item?: string | null) => { const n = new URLSearchParams(sp); n.set('view', v); if (item) n.set('item', item); else n.delete('item'); setSp(n, { replace: true }); if (!item) window.scrollTo({ top: 0 }); };
  return <Async s={s}>{d => {
    const st = d.structure as { template: string; segments: Seg[]; items: Item[]; flags: string[] }; const by = new Map(st.items.map(i => [i.id, i]));
    const modes: [string, string, string][] = [['overview', 'Overview', 'மேலோட்டம்'], ['detail', 'Study one item', 'ஒவ்வொன்றாகப் படிக்க'], ['practice', 'Practice', 'பயிற்சி'], ['revision', 'Revision', 'திருப்புதல்']];
    return <div className="col">
      <div className="tabs no-print" role="tablist" aria-label="Chapter view">{modes.map(([k, en, ta]) => <button key={k} role="tab" aria-selected={view === k} className={`tab ${view === k ? 'on' : ''}`} onClick={() => go(k, k === 'detail' ? (cur ?? st.items.find(i => i.kind !== 'heading')?.id) : null)}><Bi en={en} ta={ta} /></button>)}</div>
      <p className="muted small">{d.source}</p>
      {st.flags.map(f => <div key={f} className="notice warn"><b>{f === 'no_structure_found' ? 'No structure could be read from these pages.' : f === 'truncated' ? 'This chapter is long; only the first part is shown here.' : f.startsWith('couplets_found_') ? `${f.slice(15)} couplets were read; a Thirukkural chapter has 10. Check the printed page for the others.` : f}</b></div>)}
      {!!prog && prog.total > 0 && <div className="row wrap no-print"><div className="grow"><div className="small"><Bi en={`${prog.completed} of ${prog.total} items learned`} ta={`${prog.completed} / ${prog.total} பகுதிகள் கற்றாகிவிட்டன`} /></div><div className="progressbar" role="progressbar" aria-valuemin={0} aria-valuemax={prog.total} aria-valuenow={prog.completed}><span style={{ width: `${Math.round(prog.completed / prog.total * 100)}%` }} /></div></div>{prog.last && by.has(prog.last) && <Button tone="secondary" onClick={() => go('detail', prog.last!)}><Bi en="Continue where you left off" ta="விட்ட இடத்திலிருந்து தொடர்க" /></Button>}</div>}
      {view === 'overview' && <Overview st={st} by={by} go={go} prog={prog} />}
      {view === 'detail' && <Detail lessonId={lessonId} st={st} id={cur && by.has(cur) ? cur : (prog?.last && by.has(prog.last) ? prog.last : st.items.find(i => i.kind !== 'heading')?.id) ?? ''} go={go} onProgress={pg.reload} />}
      {view === 'practice' && <PracticeView lessonId={lessonId} st={st} go={go} />}
      {view === 'revision' && <Revision lessonId={lessonId} st={st} go={go} need={prog?.revision ?? []} />}
    </div>; }}</Async>;
}

function Overview({ st, by, go, prog }: { st: any; by: Map<string, Item>; go: (v: string, i?: string) => void; prog: any }) {
  const [open, setOpen] = useState<Set<string>>(new Set()); const toggleAll = (on: boolean) => setOpen(on ? new Set(st.segments.map((s: Seg) => s.id)) : new Set());
  return <div className="col"><div className="row wrap no-print"><Button tone="secondary" onClick={() => toggleAll(true)}>Expand all</Button><Button tone="secondary" onClick={() => toggleAll(false)}>Collapse all</Button></div>
    {st.segments.map((sg: Seg) => {
      const its = sg.itemIds.map(x => by.get(x)!).filter(Boolean); const [en, ta] = ROLE[sg.role] ?? ROLE.body; const isOpen = open.has(sg.id) || its.length <= 12;
      const couplets = its.filter(i => i.kind === 'couplet');
      return <div key={sg.id} id={`seg-${sg.id}`}><Card className="col"><div className="row wrap"><h2 className="grow"><Bi en={en} ta={ta} /> <span className="muted small">· p.{sg.page}</span></h2>{!!its.length && <TamilVoice text={speakText(its)} label="Listen to this part" />}
        {its.length > 12 && <Button tone="ghost" aria-expanded={isOpen} onClick={() => setOpen(o => { const n = new Set(o); n.has(sg.id) ? n.delete(sg.id) : n.add(sg.id); return n; })}>{isOpen ? 'Collapse' : `Show all ${its.length}`}</Button>}</div>
        {isOpen ? (couplets.length ? <div className="kgrid">{couplets.map(k => <div key={k.id} className="kcell"><div className="row"><b className="knum">{label(k)}{prog?.items?.[k.id]?.completed ? ' ✓' : ''}</b><div className="grow" /><Button tone="ghost" onClick={() => go('detail', k.id)}>Study →</Button></div><Source it={k} /><Flags it={k} /></div>)}</div>
          : <div className="col">{its.map(it => <div key={it.id} className="col item" id={`item-${it.id}`}>{it.kind === 'heading' ? <h3 className="ta" lang="ta">{it.lines[0]}</h3> : <>{it.kind === 'stanza' || it.kind === 'question' ? <b className="knum">{label(it)}</b> : null}{it.kind === 'poem' ? <h3 className="ta" lang="ta">{it.title}{it.by ? ` — ${it.by}` : ''}</h3> : <Source it={it} />}<Flags it={it} />{['couplet', 'stanza', 'paragraph', 'question', 'poem'].includes(it.kind) && <div className="row no-print"><Button tone="ghost" onClick={() => go('detail', it.id)}>{it.kind === 'question' ? 'Answer help →' : 'Explain →'}</Button></div>}</>}</div>)}</div>) : <p className="muted"><Bi en={`${its.length} items. Use “Show all” to open them.`} ta={`${its.length} உருப்படிகள். திறக்க “அனைத்தையும் காட்டு” என்பதை அழுத்துக.`} /></p>}
      </Card></div>; })}</div>;
}

type Part = { key: string; en: string; ta: string; source: 'textbook' | 'ai' | 'rule' };
const SRC_LABEL: Record<string, [string, string, string]> = { textbook: ['Textbook', 'பாடநூல்', 'b-success'], ai: ['AI-generated', 'AI உருவாக்கியது', 'b-info'], rule: ['Made by the app from the text', 'உரையிலிருந்து செயலி உருவாக்கியது', 'b-neutral'] };
/** Says whether a teacher has checked an AI text; teachers and admins get the button to check or un-check it. */
function Verify({ e, kind, lessonId, itemId, onDone }: { e: any; kind: string; lessonId: string; itemId: string; onDone: () => void }) {
  const { user } = useAuth(); const toast = useToast(); const can = user && ['teacher', 'school_admin', 'admin'].includes(user.role);
  const set = async (verified: boolean) => { try { await post(`/lessons/${lessonId}/items/${itemId}/verify`, { kind, verified }); onDone(); } catch (x) { toast(msg(x), 'err'); } };
  return <div className="row wrap no-print">{e.verified ? <Badge tone="success"><Bi en={`✓ Checked by a teacher${e.verified.by ? ` (${e.verified.by})` : ''}`} ta={`✓ ஆசிரியர் சரிபார்த்தது${e.verified.by ? ` (${e.verified.by})` : ''}`} /></Badge> : <Badge tone="warning"><Bi en="AI draft — not yet checked by a teacher" ta="AI வரைவு — ஆசிரியர் இன்னும் சரிபார்க்கவில்லை" /></Badge>}
    {can && <Button tone="secondary" onClick={() => set(!e.verified)}>{e.verified ? 'Remove the check' : 'Mark as checked'}</Button>}</div>;
}
const Tag = ({ s }: { s: string }) => <Badge tone={s === 'textbook' ? 'success' : s === 'ai' ? 'info' : 'neutral'}><Bi en={SRC_LABEL[s][0]} ta={SRC_LABEL[s][1]} /></Badge>;
const has = (v: any) => (Array.isArray(v) ? v.length > 0 : !!v);

function Detail({ lessonId, st, id, go, onProgress }: { lessonId: string; st: any; id: string; go: (v: string, i?: string) => void; onProgress: () => void }) {
  const [reading, setReading] = useState<string | null>(null); useEffect(() => setReading(null), [id]);
  const s = useLoad(() => get(`/lessons/${lessonId}/items/${id}`), [lessonId, id]); const toast = useToast(); const { lang } = useLang(); const [busy, setBusy] = useState(''); const [fresh, setFresh] = useState<any>({}); const [showMap, setShowMap] = useState(true); const [mapKey, setMapKey] = useState(0); const [done, setDone] = useState<boolean | null>(null);
  useEffect(() => { setFresh({}); setDone(null); setMapKey(k => k + 1); if (id) post(`/lessons/${lessonId}/items/${id}/progress`, { event: 'view' }).then(onProgress).catch(() => {}); }, [id]); // eslint-disable-line
  const ask = async (mode: 'explain' | 'answer', l: 'ta' | 'en') => { setBusy(`${mode}${l}`); try { const r = await post(`/lessons/${lessonId}/items/${id}/ai`, { mode, lang: l }); setFresh((f: any) => ({ ...f, ...r })); setMapKey(k => k + 1); } catch (e) { toast(msg(e), 'err'); } finally { setBusy(''); } };
  if (!id) return <Empty title="Nothing to study" text="No items were found in this chapter." />;
  return <Async s={s}>{d => {
    const it = d.item as Item; const tpl = d.template as { en: string; ta: string; parts: Part[]; quiz: boolean }; const isQ = it.kind === 'question'; const an = fresh.answer ?? d.answer;
    const exs: [string, any][] = ([['ta', fresh.explanation ?? d.explanation], ['en', fresh.explanation_en ?? d.explanation_en]] as [string, any][]).filter(([l]) => (l === 'ta' ? lang !== 'en' : lang !== 'ta'));
    const ex0 = exs.find(([, e]) => e)?.[1]; const aiText = ex0 ? [ex0.simple_ta, ex0.summary, ex0.central_idea, ...(ex0.key_points ?? [])].filter(Boolean).join('. ') : an?.answer ?? '';
    const learned = done ?? !!d.progress?.completed;
    return <div className="col">
      <div className="row wrap no-print"><Button tone="secondary" disabled={!d.prev} onClick={() => go('detail', d.prev)}>← Previous</Button><b className="grow" style={{ textAlign: 'center' }}>{label(it) || 'Item'} <span className="muted small">· <Bi en={tpl.en} ta={tpl.ta} /></span></b><Button tone="secondary" disabled={!d.next} onClick={() => go('detail', d.next)}>Next →</Button></div>
      <Card className="col"><div className="row wrap"><Tag s="textbook" /><div className="grow" /></div><Source it={it} reading={reading} /><Flags it={it} /><div className="row wrap no-print"><TamilVoice text={speakText([it])} label="Listen to this item" onChunk={setReading} chunkMax={70} />
        <Button tone="secondary" to={`/app/tutor?lesson=${lessonId}&q=${encodeURIComponent(`${it.kind === 'question' ? 'இந்த வினாவுக்கு உதவுங்கள்' : 'இந்தப் பகுதியை விளக்குங்கள்'}: ${it.lines[0] ?? ''}`.slice(0, 280))}`}><Bi en="Ask the tutor about this" ta="இதைப் பற்றி ஆசிரியரிடம் கேள்" /></Button></div></Card>
      <Card className="col aibox"><div className="row wrap"><h2 className="grow"><Bi en="Explanation" ta="விளக்கம்" /></h2><span className="muted small"><Bi en={`Based on textbook page ${it.page}`} ta={`பாடநூல் பக்கம் ${it.page} அடிப்படையில்`} /></span><Tag s="ai" /></div>
        {isQ ? <>
          <p className="muted small"><Bi en="This textbook does not print an answer for this question." ta="இந்த வினாவுக்கான விடையை நூல் தரவில்லை." /></p>
          <Hints key={id} lessonId={lessonId} itemId={id} />
          {an ? <><p lang="ta" className="ta">{an.answer}</p>{an.why && <p lang="ta" className="ta muted">{an.why}</p>}<Badge tone="info">AI-generated answer — not from the textbook. Check with your teacher.</Badge><Verify e={an} kind="answer" lessonId={lessonId} itemId={id} onDone={() => { setFresh({}); s.reload(); }} /></> : <Button disabled={!!busy || !d.aiEnabled} onClick={() => ask('answer', lang === 'en' ? 'en' : 'ta')}>{busy ? 'Writing…' : 'Suggest an answer (AI)'}</Button>}
        </> : <>
          {exs.map(([l, e]) => e ? <div key={l} className="col"><ExplanationParts tpl={tpl} ex={e} l={l as 'ta' | 'en'} lessonId={lessonId} itemId={id} onResult={onProgress} /><Verify e={e} kind={l === 'en' ? 'explain_en' : 'explain'} lessonId={lessonId} itemId={id} onDone={() => { setFresh({}); s.reload(); }} />{e.stale && <Badge tone="warning">The textbook text was re-read after this was written. Ask again to refresh.</Badge>}</div>
            : <div key={l}><Button disabled={!!busy || !d.aiEnabled} onClick={() => ask('explain', l as 'ta' | 'en')}>{busy === `explain${l}` ? 'Writing…' : l === 'ta' ? 'Explain in Tamil (AI)' : 'Explain in English (AI)'}</Button></div>)}
        </>}
        {!d.aiEnabled && !ex0 && !an && <p className="muted small">The AI explanation service is not switched on for this school yet. The textbook text above is always available.</p>}
        {!!aiText && <TamilVoice text={aiText} label="Listen to the explanation" />}</Card>
      {tpl.parts.some(p => p.key === 'map') && <Card className="col"><div className="row wrap"><h2 className="grow"><Bi en="Mind map" ta="மனவரைபடம்" /></h2><Tag s="rule" /><Button tone="ghost" aria-expanded={showMap} onClick={() => setShowMap(v => !v)}>{showMap ? 'Collapse' : 'Expand'}</Button></div>
        {showMap && <MindMapView key={`${id}-${mapKey}`} lessonId={lessonId} mapUrl={`/lessons/${lessonId}/items/${id}/mindmap`} onOpenLesson={() => {}} />}</Card>}
      {!!d.practice.length && <Card className="col"><div className="row wrap"><h2 className="grow"><Bi en="Quick practice" ta="விரைவுப் பயிற்சி" /></h2><Tag s="rule" /></div><p className="muted small">Made from this item’s textbook text by the app — not textbook questions.</p>{d.practice.map((p: any) => <Mcq key={p.id} p={p} />)}</Card>}
      <div className="row wrap no-print"><Button tone={learned ? 'secondary' : 'teal'} disabled={learned} onClick={async () => { try { await post(`/lessons/${lessonId}/items/${id}/progress`, { event: 'complete' }); setDone(true); onProgress(); } catch (e) { toast(msg(e), 'err'); } }}>{learned ? '✓ Learned' : 'Mark as learned'}</Button>{d.next && <Button onClick={() => go('detail', d.next)}>Next →</Button>}</div>
    </div>; }}</Async>;
}

/** Shows the AI parts a template lists, in the template's order, skipping parts the model had nothing for. */
function ExplanationParts({ tpl, ex, l, lessonId, itemId, onResult }: { tpl: { parts: Part[] }; ex: any; l: 'ta' | 'en'; lessonId: string; itemId: string; onResult: () => void }) {
  const cell = (cls = '') => (l === 'ta' ? `ta ${cls}` : cls);
  const body = (k: string, v: any) => {
    if (k === 'word_meanings') return <table className="tbl"><tbody>{v.map((w: any) => <tr key={w.word}><td className="ta" lang="ta"><b>{w.word}</b></td><td className={cell()}>{w.meaning}</td></tr>)}</tbody></table>;
    if (k === 'line_notes') return <ol>{v.map((x: any) => <li key={x.line}><b className="ta" lang="ta">{x.line}</b><br /><span className={cell()}>{x.note}</span></li>)}</ol>;
    if (k === 'characters') return <ul>{v.map((c: any) => <li key={c.name}><b className="ta" lang="ta">{c.name}</b> — <span className={cell()}>{c.trait}</span></li>)}</ul>;
    if (k === 'mistakes') return <table className="tbl"><thead><tr><th>✗</th><th>✓</th><th /></tr></thead><tbody>{v.map((m: any) => <tr key={m.wrong}><td className="ta" lang="ta">{m.wrong}</td><td className="ta" lang="ta"><b>{m.right}</b></td><td className={cell('muted')}>{m.why}</td></tr>)}</tbody></table>;
    if (Array.isArray(v)) return <ul>{v.map((x: string) => <li key={x} className={cell()}>{x}</li>)}</ul>;
    return <p className={cell()} lang={l}>{v}</p>;
  };
  const order = tpl.parts.filter(p => p.source === 'ai' && p.key !== 'quiz'); const shown = new Set(order.map(p => p.key));
  return <div className="col" lang={l}>
    {order.map(p => { const v = p.key === 'real_life' ? ex.real_life ?? ex.example : ex[p.key]; return has(v) ? <div key={p.key} className="col part"><h3 className="small"><Bi en={p.en} ta={p.ta} /></h3>{body(p.key, v)}</div> : null; })}
    {!shown.has('central_idea') && has(ex.central_idea) && <div className="part"><h3 className="small"><Bi en="Central idea" ta="மையக் கருத்து" /></h3><p className={cell()}>{ex.central_idea}</p></div>}
    {has(ex.keywords) && <div className="chips">{ex.keywords.map((k: string) => <Badge key={k} tone="teal">{k}</Badge>)}</div>}
    {has(ex.english) && l === 'ta' && <p lang="en"><b>English: </b>{ex.english}</p>}
    {ex.quiz && tpl.parts.some(p => p.key === 'quiz') && <Quiz quiz={ex.quiz} l={l} lessonId={lessonId} itemId={itemId} onResult={onResult} />}</div>;
}

/** Immediate feedback; a wrong answer gets a hint and another try, never a penalty. Each try is recorded for the student's own revision list. */
function Quiz({ quiz, l, lessonId, itemId, onResult }: { quiz: any; l: 'ta' | 'en'; lessonId: string; itemId: string; onResult: () => void }) {
  const [tried, setTried] = useState<number[]>([]); const [ok, setOk] = useState(false);
  useEffect(() => { setTried([]); setOk(false); }, [quiz]);
  const pick = (i: number) => { if (ok || tried.includes(i)) return; const right = i === quiz.correct; setTried(t => [...t, i]); if (right) setOk(true); post(`/lessons/${lessonId}/items/${itemId}/progress`, { event: 'quiz', correct: right }).then(onResult).catch(() => {}); };
  return <div className="col part" role="group" aria-label="Quiz"><h3 className="small"><Bi en="Check yourself" ta="சோதிக்க" /></h3><p lang={l} className={l === 'ta' ? 'ta' : ''}>{quiz.question}</p>
    <div className="chips">{quiz.options.map((o: string, i: number) => <button key={o} className={`btn ${ok && i === quiz.correct ? '' : tried.includes(i) ? 'danger' : 'secondary'}`} disabled={ok || tried.includes(i)} onClick={() => pick(i)} lang={l}>{o}</button>)}</div>
    <div aria-live="polite">{ok ? <p><b><Bi en="Correct!" ta="சரி!" /></b> {quiz.why}</p> : tried.length ? <p><Bi en="Not quite — try again." ta="சரியில்லை — மீண்டும் முயல்க." />{quiz.hint ? <> <b><Bi en="Hint:" ta="குறிப்பு:" /></b> {quiz.hint}</> : null}</p> : null}</div>
    {!ok && tried.length >= quiz.options.length - 1 && <p className="muted small">{quiz.options[quiz.correct]}</p>}</div>;
}
function Mcq({ p }: { p: any }) {
  const [pick, setPick] = useState<number | null>(null);
  return <div className="col item"><p lang="ta" className="ta">{p.stem}</p><div className="chips">{p.options.map((o: string, i: number) => <button key={o} className={`btn ${pick === null ? 'secondary' : i === p.correct ? '' : pick === i ? 'danger' : 'secondary'}`} disabled={pick !== null} onClick={() => setPick(i)} lang="ta">{o}</button>)}</div>{pick !== null && <p className="muted small">{pick === p.correct ? 'Correct.' : `The word is “${p.options[p.correct]}”.`}</p>}</div>;
}

function PracticeView({ lessonId, st, go }: { lessonId: string; st: any; go: (v: string, i?: string) => void }) {
  const qs: Item[] = st.items.filter((i: Item) => i.kind === 'question'); const groups = useMemo(() => { const m = new Map<string, Item[]>(); for (const q of qs) { const k = q.question?.category ?? 'வினாக்கள்'; m.set(k, [...(m.get(k) ?? []), q]); } return [...m]; }, [qs]);
  if (!qs.length) return <Empty title="No textbook questions found" text="No questions were read from these pages. Use the Practice questions tab for questions made from the chapter." />;
  return <div className="col"><p className="muted small"><Bi en="Textbook questions with their original numbers. Answers are hidden until you ask. This book does not print an answer key, so any answer shown is AI-generated." ta="பாடநூல் வினாக்கள் அதே எண்களுடன். விடைகள் நீங்கள் கேட்டால் மட்டுமே. இந்நூலில் விடைகள் இல்லை; காட்டப்படும் விடை AI உருவாக்கியது." /></p>
    {groups.map(([cat, items]) => <Card key={cat} className="col"><h2 lang="ta" className="ta">{cat}</h2>{items.map(q => <div key={q.id} className="col item"><div className="row"><b className="knum">{q.number}.</b><div className="grow"><Source it={q} /><Flags it={q} /></div></div><div className="row no-print"><Button tone="ghost" onClick={() => go('detail', q.id)}>Show / suggest answer →</Button></div></div>)}</Card>)}</div>;
}

const STEP_TXT: Record<string, [string, string]> = { glance: ['Glance at', 'ஒரு முறை பாருங்கள்'], read: ['Read', 'படியுங்கள்'], recall: ['Cover it and say it from memory', 'மூடிவைத்து நினைவிலிருந்து சொல்லுங்கள்'], quiz: ['Check yourself with the quiz', 'வினாவில் சோதியுங்கள்'], words: ['Go through the word list', 'சொல் பட்டியலைப் பாருங்கள்'] };
/** Three guided hints for a textbook question, taken from the chapter's own text. The answer is never shown before the student asks for it. */
function Hints({ lessonId, itemId }: { lessonId: string; itemId: string }) {
  const [hints, setHints] = useState<any[] | null>(null); const [n, setN] = useState(0); const toast = useToast(); const { lang } = useLang();
  const next = async () => { try { let h = hints; if (!h) { h = (await get(`/lessons/${lessonId}/items/${itemId}/hints`)).hints; setHints(h); } setN(x => Math.min(x + 1, h!.length)); } catch (e) { toast(msg(e), 'err'); } };
  return <div className="col no-print">{hints?.slice(0, n).map(h => <div key={h.level} className="notice info"><div className="col"><b><Bi en={`Hint ${h.level}`} ta={`குறிப்பு ${h.level}`} /></b><span>{lang === 'ta' ? h.ta : lang === 'en' ? h.en : `${h.en} ${h.ta}`}</span>{!!h.lines?.length && <div className="ta verse" lang="ta">{h.lines.map((l: string, i: number) => <div key={i}>{l}</div>)}</div>}</div></div>)}
    {(!hints || n < hints.length) && <div className="row"><Button tone="secondary" onClick={next}>{n === 0 ? <Bi en="Give me a hint" ta="ஒரு குறிப்பு தாருங்கள்" /> : <Bi en="One more hint" ta="இன்னொரு குறிப்பு" />}</Button></div>}</div>;
}

/** 1, 5, 15 and 30 minute revision packs, built by the app from this chapter's own items. */
function RevisionPacks({ lessonId, st, go }: { lessonId: string; st: any; go: (v: string, i?: string) => void }) {
  const { lang } = useLang(); const one = (en: string, ta: string) => (lang === 'ta' ? ta : lang === 'en' ? en : `${en} · ${ta}`);
  const [m, setM] = useState<number | null>(null); const s = useLoad(() => (m ? get(`/lessons/${lessonId}/revision-pack?minutes=${m}`) : Promise.resolve(null)), [lessonId, m]);
  const byId = (id?: string): Item | undefined => st.items.find((i: Item) => i.id === id);
  return <Card className="col"><h2><Bi en="Revise in the time you have" ta="உங்களிடம் உள்ள நேரத்தில் திருப்புங்கள்" /></h2>
    <p className="muted small"><Bi en="Choose how long you have. The app builds a plan from this chapter’s own text. Things you found hard come first. Times are estimates." ta="எவ்வளவு நேரம் உள்ளது எனத் தேர்ந்தெடுங்கள். இந்தப் பாடத்தின் உரையிலிருந்தே திட்டம் உருவாகும். கடினமாக இருந்தவை முதலில் வரும். நேரங்கள் மதிப்பீடு." /></p>
    <div className="row wrap">{[1, 5, 15, 30].map(x => <button key={x} className={`pill ${m === x ? 'on' : ''}`} aria-pressed={m === x} onClick={() => setM(x)}>{x} <Bi en="min" ta="நிமிடம்" /></button>)}</div>
    {m && <Async s={s}>{d => d ? <div className="col">
      <p className="small"><b>{d.pack.total} {one('min', 'நிமிடம்')}</b> · {d.pack.note}</p>
      <ol className="packlist">{d.pack.steps.map((p: any, k: number) => { const it = byId(p.itemId); const T = STEP_TXT[p.kind];
        return <li key={k}><span className="muted small">{p.minutes} {one('min', 'நிமி')} · </span>{one(T[0], T[1])} {p.kind === 'words' ? <b>({p.itemIds.length})</b> : it ? <b>{label(it) || `p.${it.page}`}</b> : null}{it && <> <Button tone="ghost" onClick={() => go('detail', it.id)}>{one('Open', 'திற')}</Button></>}</li>; })}</ol>
      {!d.pack.steps.length && <p className="muted">This chapter has no main items to revise yet.</p>}</div> : null}</Async>}</Card>;
}

function Revision({ lessonId, st, go, need }: { lessonId: string; st: any; go: (v: string, i?: string) => void; need: string[] }) {
  const ks: Item[] = st.items.filter((i: Item) => ['couplet', 'stanza'].includes(i.kind)); const words: Item[] = st.items.filter((i: Item) => i.kind === 'word');
  const needItems: Item[] = need.map(x => st.items.find((i: Item) => i.id === x)).filter(Boolean);
  return <div className="col"><RevisionPacks lessonId={lessonId} st={st} go={go} />{!!needItems.length && <Card className="col"><h2><Bi en="Needs another look" ta="மீண்டும் பார்க்க வேண்டியவை" /></h2><p className="muted small"><Bi en="Items where a quiz answer was missed, or that you tried but have not marked as learned. This is only for you — it is not a mark." ta="வினாவில் தவறியவை, அல்லது முயன்று “கற்றேன்” எனக் குறிக்காதவை. இது உங்களுக்கு மட்டுமே — மதிப்பெண் அல்ல." /></p><div className="chips">{needItems.map(i => <Button key={i.id} tone="secondary" onClick={() => go('detail', i.id)}>{label(i) || i.lines[0]?.slice(0, 20)}</Button>)}</div></Card>}<Card className="col"><h2><Bi en="Chapter mind map" ta="பாடத்தின் மனவரைபடம்" /></h2><MindMapView lessonId={lessonId} mapUrl={`/lessons/${lessonId}/chapter-map`} onOpenLesson={() => {}} /></Card>
    {!!ks.length && <Card className="col"><div className="row wrap"><h2 className="grow">{ks[0].kind === 'couplet' ? <Bi en={`All ${ks.length} couplets`} ta={`அனைத்துக் குறள்களும் (${ks.length})`} /> : <Bi en="All stanzas" ta="அனைத்துப் பாடல்களும்" />}</h2><TamilVoice text={speakText(ks)} label="Listen to all" /></div>
      <div className="kgrid">{ks.map(k => <div key={k.id} className="kcell"><b className="knum">{label(k)}</b><Source it={k} /><Button tone="ghost" onClick={() => go('detail', k.id)}>Study →</Button></div>)}</div></Card>}
    {!!words.length && <Card className="col"><h2><Bi en="Important words" ta="முக்கிய சொற்கள்" /></h2><table className="tbl"><tbody>{words.map(w => <tr key={w.id}><td className="ta" lang="ta"><b>{w.word?.term}</b></td><td className="ta" lang="ta">{w.word?.meaning}</td></tr>)}</tbody></table></Card>}</div>;
}
