import { MaterialPanel } from './material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, Icon, Loading, Modal, PageTitle, fmtDT } from '../components/ui';
import { Bi, useLang } from '../components/lang';
import { useAuth } from '../auth';
import { del, get, post, msg } from '../api';
import { useToast } from '../components/toast';
import { canListen, canSpeak, listen, speak, stopSpeaking } from '../components/voice';

type Msg = { id: string; role: 'user' | 'assistant'; content: { en: string; ta: string }; meta: any; created_at: string };

function Bubble({ m, actions, onAction, onReport }: { m: Msg; actions: Record<string, { en: string; ta: string }>; onAction: (text: string, action?: string) => void; onReport: (m: Msg) => void }) {
  const { lang } = useLang(); const toast = useToast(); const { profile } = useAuth(); const [bm, setBm] = useState(false); const [talking, setTalking] = useState(false);
  const user = m.role === 'user'; const en = m.content.en, ta = m.content.ta;
  const show = user ? [en] : lang === 'en' ? [en] : lang === 'ta' ? [ta] : en === ta ? [en] : [en, ta];
  const plain = (lang === 'ta' ? ta : en);
  return (
    <div className={`msg ${user ? 'me' : 'bot'}`}>
      <div className="bubble">
        {!user && <div className="botlabel"><Icon name="chat" size={14} /> {m.meta.mock ? 'Development tutor (rule-based — not an AI model)' : 'AI tutor'}{m.meta.grounded && <Badge tone="teal">{m.meta.grounded === 'material' ? 'From your material' : 'From your lesson'}</Badge>}</div>}
        {show.map((t, i) => <div key={i} {...(user ? { 'data-notranslate': '' } : {})} className={`mtext ${i === 1 || (lang === 'ta' && !user) ? 'ta' : ''}`} lang={i === 1 || (lang === 'ta' && !user) ? 'ta' : undefined}>{t}</div>)}
        {!user && !!m.meta.sources?.length && <div className="srcs"><b>Sources:</b> {m.meta.sources.join(' · ')}</div>}
        {!user && !!m.meta.refs?.length && <div className="chips no-print">{m.meta.refs.map((r: any) => <Link key={`${r.bookId}-${r.page}`} className="pill" target="_blank" rel="noreferrer" to={`/app/textbook/${r.bookId}?page=${r.page}`}>Open book, page {r.page}</Link>)}</div>}
        {!user && <div className="msgtools no-print">
          {canSpeak && <button aria-label={talking ? 'Stop reading' : 'Read aloud'} aria-pressed={talking} onClick={() => { if (talking) { stopSpeaking(); setTalking(false); } else { setTalking(true); speak(plain, lang === 'ta' ? 'ta' : 'en', profile?.voice_prefs?.rate ?? 1, () => setTalking(false)); } }}><Icon name="volume" size={15} /></button>}
          <button aria-label="Copy answer" onClick={async () => { try { await navigator.clipboard.writeText(show.join('\n\n')); toast('Copied'); } catch { toast('Could not copy on this device', 'err'); } }}><Icon name="copy" size={15} /></button>
          <button aria-label={bm ? 'Remove bookmark' : 'Bookmark answer'} aria-pressed={bm} onClick={async () => { try { if (bm) await del(`/bookmarks?kind=message&ref=${m.id}`); else await post('/bookmarks', { kind: 'message', ref: m.id, title: en.slice(0, 80) }); setBm(!bm); toast(bm ? 'Bookmark removed' : 'Saved to bookmarks'); } catch (e) { toast(msg(e), 'err'); } }}><Icon name="bookmark" size={15} /></button>
          <button aria-label="Report this answer" onClick={() => onReport(m)}><Icon name="flag" size={15} /></button>
        </div>}
      </div>
      {!user && !!m.meta.suggestions?.length && <div className="chips no-print">{m.meta.suggestions.filter((k: string) => actions[k]).map((k: string) => <button key={k} className="pill" onClick={() => onAction(lang === 'ta' ? actions[k].ta : actions[k].en, k)}>{lang === 'ta' ? actions[k].ta : actions[k].en}</button>)}</div>}
    </div>
  );
}

export function Tutor() {
  const [sp] = useSearchParams(); const toast = useToast(); const { lang } = useLang();
  const [list, setList] = useState<any[]>([]); const [info, setInfo] = useState<any>(null); const [cur, setCur] = useState<any>(null); const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<{ text: string; action?: string } | null>(null); const [loading, setLoading] = useState(true); const [listening, setListening] = useState(false);
  const [report, setReport] = useState<Msg | null>(null); const [reason, setReason] = useState(''); const [showList, setShowList] = useState(false); const [tab, setTab] = useState<'chat' | 'material'>(sp.get('tab') === 'material' ? 'material' : 'chat'); const end = useRef<HTMLDivElement>(null); const stop = useRef<() => void>(() => {});
  const loadList = useCallback(async () => { const d = await get('/tutor/conversations'); setList(d.conversations); setInfo({ provider: d.provider, actions: d.actions }); return d; }, []);
  const open = useCallback(async (id: string) => { const d = await get(`/tutor/conversations/${id}/messages`); setCur(d.conversation); setMsgs(d.messages); setShowList(false); }, []);
  const create = useCallback(async (extra: any = {}) => { const d = await post('/tutor/conversations', extra); setCur(d.conversation); setMsgs([]); await loadList(); setShowList(false); return d.conversation; }, [loadList]);
  const send = useCallback(async (t: string, action?: string, conv = cur, langOverride?: 'ta' | 'en' | 'both') => {
    if (!conv || (!t.trim() && !action)) return; setBusy(true); setErr(null);
    const temp: Msg = { id: 'tmp', role: 'user', content: { en: t, ta: t }, meta: {}, created_at: new Date().toISOString() }; setMsgs(m => [...m, temp]); setText('');
    try { const d = await post(`/tutor/conversations/${conv.id}/messages`, { text: t, action, lang: langOverride ?? lang }); setMsgs(m => [...m.filter(x => x.id !== 'tmp'), ...d.messages]); setCur((c: any) => (c && c.title === 'New conversation' && t ? { ...c, title: t.slice(0, 60) } : c)); loadList(); }
    catch (e) { setMsgs(m => m.filter(x => x.id !== 'tmp')); setErr({ text: t, action }); setText(t); toast(msg(e), 'err'); } finally { setBusy(false); }
  }, [cur, lang, loadList, toast]);
  useEffect(() => { (async () => {
    try { const d = await loadList(); const lesson = sp.get('lesson'), material = sp.get('material'), action = sp.get('action'), qtext = (sp.get('q') ?? '').slice(0, 300), ql = sp.get('lang'), lo = ql === 'ta' || ql === 'en' ? ql : undefined;
      if (lesson || material || qtext) { const c = await create({ lessonId: lesson ?? undefined, materialId: material ?? undefined }); if (action || qtext) await send(qtext, action ?? undefined, c, lo); }
      else if (d.conversations[0]) await open(d.conversations[0].id); else await create();
    } catch (e) { toast(msg(e), 'err'); } finally { setLoading(false); } })(); return () => { stopSpeaking(); stop.current(); }; }, []); // eslint-disable-line
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, busy]);
  const mic = () => { if (listening) { stop.current(); return; } setListening(true); stop.current = listen(lang === 'ta' ? 'ta' : 'en', t => setText(x => (x ? x + ' ' : '') + t), e => { setListening(false); if (e) toast(e, 'err'); }); };
  if (loading) return <Loading />;
  const actions = info?.actions ?? {};
  return (
    <div className="col tutor">
      <div className="tutor-title"><PageTitle title="AI Tutor" sub={info?.provider.mock ? 'A rule-based development tutor is answering (no AI model is connected). It solves equations, explains your lessons and quizzes you.' : 'Ask about your lessons in Tamil or English.'} /></div>
      <div className="row wrap tutor-tabs" role="tablist" aria-label="AI Tutor sections">
        <button role="tab" aria-selected={tab === 'chat'} className={`pill ${tab === 'chat' ? 'on' : ''}`} onClick={() => setTab('chat')}><Bi en="Chat" ta="அரட்டை" /></button>
        <button role="tab" aria-selected={tab === 'material'} className={`pill ${tab === 'material' ? 'on' : ''}`} onClick={() => setTab('material')}><Bi en="My material" ta="என் பொருள்" /></button>
      </div>
      {tab === 'material' && <div className="tutor-mat"><MaterialPanel onChat={async id => { setTab('chat'); try { await create({ materialId: id }); } catch (e) { toast(msg(e), 'err'); } }} /></div>}
      <div className="chatwrap" style={tab === 'chat' ? undefined : { display: 'none' }}>
        <aside className={`convlist ${showList ? 'open' : ''}`} aria-label="Conversations">
          <Button onClick={() => create()}><Icon name="plus" /> New chat</Button>
          {list.map(c => <div key={c.id} className={`conv ${cur?.id === c.id ? 'on' : ''}`}><button className="grow" onClick={() => open(c.id)}><span className="ell semi">{c.title}</span><span className="muted xs">{fmtDT(c.created_at)}</span></button>
            <button aria-label={`Delete ${c.title}`} className="linkbtn" onClick={async () => { try { await del(`/tutor/conversations/${c.id}`); const d = await loadList(); if (cur?.id === c.id) { d.conversations[0] ? await open(d.conversations[0].id) : await create(); } } catch (e) { toast(msg(e), 'err'); } }}><Icon name="trash" size={15} /></button></div>)}
        </aside>
        <Card className="chat">
          <div className="chathead row wrap"><button className="btn secondary showlist" onClick={() => setShowList(s => !s)} aria-expanded={showList}><Icon name="menu" size={16} /> Chats</button><span className="grow semi ell">{cur?.title}</span>
            </div>
          <div className="msgs" role="log" aria-live="polite" aria-label="Conversation">
            {!msgs.length && <div className="state"><Icon name="chat" size={32} color="var(--primary)" /><h3 style={{ color: 'var(--text)' }}>How can I help?</h3><p>Try one of these, or type your own question.</p>
              <div className="chips">{['Solve 3x + 5 = 20', 'What is an equation?', 'Test my understanding', 'Explain ratio'].map(s => <button className="pill" key={s} onClick={() => send(s)}>{s}</button>)}</div></div>}
            {msgs.map(m => <Bubble key={m.id} m={m} actions={actions} onAction={(t, a) => send(t, a)} onReport={setReport} />)}
            {busy && <div className="msg bot"><div className="bubble typing" aria-label="Tutor is typing"><i /><i /><i /></div></div>}
            <div ref={end} />
          </div>
          {err && <div className="notice err" role="alert"><Icon name="alert" /><span className="grow">The message was not sent.</span><Button tone="secondary" onClick={() => send(err.text, err.action)}>Retry</Button></div>}
          <form className="composer" onSubmit={e => { e.preventDefault(); send(text); }}>
            <label className="sr" htmlFor="chatin">Your question</label>
            <textarea id="chatin" rows={1} value={text} maxLength={2000} placeholder={lang === 'ta' ? 'உங்கள் கேள்வியை எழுதுங்கள்…' : 'Type your question…'} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }} />
            {canListen && <button type="button" className={`btn secondary iconbtn ${listening ? 'rec' : ''}`} aria-label={listening ? 'Stop listening' : 'Speak your question'} aria-pressed={listening} onClick={mic}><Icon name="mic" /></button>}
            <Button type="submit" disabled={busy || !text.trim()} aria-label="Send"><Icon name="send" /><span className="hide-sm">Send</span></Button>
          </form>
          
        </Card>
      </div>
      {report && <Modal title="Report this answer" onClose={() => setReport(null)}><p className="muted small">Tell us what is wrong or unsafe about this answer.</p><textarea aria-label="Reason" rows={3} style={{ width: '100%', padding: 10 }} value={reason} onChange={e => setReason(e.target.value)} maxLength={300} />
        <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}><Button tone="secondary" onClick={() => setReport(null)}>Cancel</Button><Button disabled={reason.trim().length < 3} onClick={async () => { try { await post(`/tutor/messages/${report.id}/report`, { reason }); toast('Thanks — we will review it.'); setReport(null); setReason(''); } catch (e) { toast(msg(e), 'err'); } }}>Send report</Button></div></Modal>}
    </div>
  );
}
