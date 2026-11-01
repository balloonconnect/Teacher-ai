import { useEffect, useRef, useState } from 'react';
import { Async, Badge, Button, Card, Empty, Icon, Modal, fmtDT, useLoad } from '../components/ui';
import { del, get, post, put, api, msg } from '../api';
import { useToast } from '../components/toast';

/** Client-side rotate/crop on a canvas before upload (nothing is sent until the student confirms). */
function ImageEditor({ file, onDone, onCancel }: { file: File; onDone: (f: File) => void; onCancel: () => void }) {
  const [url] = useState(() => URL.createObjectURL(file)); const [rot, setRot] = useState(0); const [crop, setCrop] = useState({ t: 0, r: 0, b: 0, l: 0 }); const img = useRef<HTMLImageElement>(null);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const apply = () => {
    const im = img.current!; const w = im.naturalWidth, h = im.naturalHeight; const sx = w * crop.l / 100, sy = h * crop.t / 100, sw = w * (1 - (crop.l + crop.r) / 100), sh = h * (1 - (crop.t + crop.b) / 100);
    const swap = rot % 180 !== 0; const max = 1800, k = Math.min(1, max / Math.max(sw, sh)); const c = document.createElement('canvas'); c.width = Math.round((swap ? sh : sw) * k); c.height = Math.round((swap ? sw : sh) * k);
    const g = c.getContext('2d')!; g.translate(c.width / 2, c.height / 2); g.rotate((rot * Math.PI) / 180); g.drawImage(im, sx, sy, sw, sh, -sw * k / 2, -sh * k / 2, sw * k, sh * k);
    c.toBlob(b => b && onDone(new File([b], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.9);
  };
  const sl = (k: 't' | 'r' | 'b' | 'l', label: string) => <div className="field"><label htmlFor={`cr${k}`}>Crop {label}: {crop[k]}%</label><input id={`cr${k}`} type="range" min="0" max="40" value={crop[k]} onChange={e => setCrop({ ...crop, [k]: Number(e.target.value) })} /></div>;
  return <Modal title="Adjust photo" onClose={onCancel} wide>
    <div className="imgprev"><img ref={img} src={url} alt="Selected photo preview" style={{ transform: `rotate(${rot}deg)`, clipPath: `inset(${crop.t}% ${crop.r}% ${crop.b}% ${crop.l}%)`, maxWidth: rot % 180 ? 260 : '100%' }} /></div>
    <div className="grid g2">{sl('t', 'top')}{sl('b', 'bottom')}{sl('l', 'left')}{sl('r', 'right')}</div>
    <div className="row wrap" style={{ justifyContent: 'flex-end', marginTop: 12 }}><Button tone="secondary" onClick={() => setRot((rot + 90) % 360)}><Icon name="rotate" /> Rotate</Button><Button tone="secondary" onClick={onCancel}>Cancel</Button><Button onClick={apply}>Use this photo</Button></div></Modal>;
}

export function MaterialPanel({ onChat }: { onChat: (id: string) => void }) {
  const s = useLoad(() => get('/materials')); const toast = useToast();
  const [sel, setSel] = useState<string | null>(null); const [url, setUrl] = useState(''); const [busy, setBusy] = useState(''); const [edit, setEdit] = useState<File | null>(null); const fileIn = useRef<HTMLInputElement>(null); const pdfIn = useRef<HTMLInputElement>(null);
  const upload = async (f: File, kind: 'image' | 'pdf') => { setBusy(kind); try { const fd = new FormData(); fd.append('kind', kind); fd.append('file', f); const d = await api('POST', '/materials/upload', fd); toast('Added'); await s.reload(); setSel(d.material.id); } catch (e) { toast(msg(e), 'err'); } finally { setBusy(''); } };
  const addLink = async () => { setBusy('link'); try { const d = await post('/materials/link', { url }); setUrl(''); toast('Page added'); await s.reload(); setSel(d.material.id); } catch (e) { toast(msg(e), 'err'); } finally { setBusy(''); } };
  return (
    <div className="col">
      <p className="muted">Add a photo, a PDF or a web page. Answers come from your material, with where they were found.</p>
      <div className="notice info"><Icon name="lock" /><span>Your uploads are private to you and are <b>never used to train AI models</b>. Delete them any time. Photos are not read automatically unless the service has a text-reading (OCR) provider configured.</span></div>
      <Async s={s}>{d => <>
        {!d.capabilities.ocr && <div className="notice warn"><Icon name="alert" /><span>{d.capabilities.ocrNote}</span></div>}
        <div className="grid g3">
          <Card className="col"><IconRow icon="image" t="Photo" d="A page of your book, notes or a question (JPG, PNG, WebP up to 10 MB)." />
            <input ref={fileIn} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setEdit(f); }} />
            <Button onClick={() => fileIn.current?.click()} disabled={!!busy}>{busy === 'image' ? 'Uploading…' : 'Take or choose photo'}</Button></Card>
          <Card className="col"><IconRow icon="file" t="PDF" d="Text PDFs up to 10 MB. Scanned PDFs need OCR, which may not be available." />
            <input ref={pdfIn} type="file" accept="application/pdf" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f, 'pdf'); }} />
            <Button onClick={() => pdfIn.current?.click()} disabled={!!busy}>{busy === 'pdf' ? 'Reading PDF…' : 'Choose PDF'}</Button></Card>
          <Card className="col"><IconRow icon="link" t="Web page" d="A public http(s) page. Private networks and sign-in pages are blocked." />
            <form className="col" onSubmit={e => { e.preventDefault(); addLink(); }}><label className="sr" htmlFor="u">Web address</label><input id="u" type="url" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} className="plain" /><Button type="submit" disabled={!url.trim() || !!busy}>{busy === 'link' ? 'Fetching…' : 'Add page'}</Button></form></Card>
        </div>
        <Card className="col"><h2>Your materials</h2>
          {!d.materials.length ? <Empty title="Nothing added yet" text="Add a photo, PDF or web page above to get started." /> : d.materials.map((m: any) => (
            <div key={m.id} className={`row wrap listrow ${sel === m.id ? 'selrow' : ''}`}><Icon name={m.kind === 'image' ? 'image' : m.kind === 'pdf' ? 'file' : 'link'} /><div className="grow"><b className="ell">{m.name}</b><div className="muted small">{m.kind.toUpperCase()} · {fmtDT(m.created_at)}{m.pageCount ? ` · ${m.pageCount} page(s)` : ''}</div></div>
              <StatusBadge s={m.status} /><Button tone="secondary" onClick={() => setSel(sel === m.id ? null : m.id)}>{sel === m.id ? 'Close' : 'Open'}</Button></div>))}
        </Card>
        {sel && <MaterialView key={sel} id={sel} ocr={d.capabilities.ocr} onChange={s.reload} onDeleted={() => { setSel(null); s.reload(); }} onChat={() => onChat(sel)} />}</>}</Async>
      {edit && <ImageEditor file={edit} onCancel={() => setEdit(null)} onDone={f => { setEdit(null); upload(f, 'image'); }} />}
    </div>
  );
}
const IconRow = ({ icon, t, d }: { icon: any; t: string; d: string }) => <div className="row" style={{ alignItems: 'flex-start' }}><span className="iconbox" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}><Icon name={icon} size={22} /></span><div><h3>{t}</h3><p className="muted small">{d}</p></div></div>;
const StatusBadge = ({ s }: { s: string }) => s === 'ready' ? <Badge tone="success">Ready</Badge> : s === 'needs_text' ? <Badge tone="warning">Needs text</Badge> : s === 'needs_confirmation' ? <Badge tone="warning">Check text</Badge> : s === 'needs_ocr' ? <Badge tone="danger">Scanned PDF</Badge> : <Badge tone="danger">Failed</Badge>;

function MaterialView({ id, ocr, onChange, onDeleted, onChat }: { id: string; ocr: boolean; onChange: () => void; onDeleted: () => void; onChat: () => void }) {
  const s = useLoad(() => get(`/materials/${id}`), [id]); const toast = useToast(); const [txt, setTxt] = useState<string | null>(null); const [q, setQ] = useState(''); const [ans, setAns] = useState<any>(null); const [notes, setNotes] = useState<any>(null); const [quiz, setQuiz] = useState<any>(null); const [busy, setBusy] = useState(''); const [conf, setConf] = useState(false); const [shown, setShown] = useState<Record<number, string>>({});
  const run = async (k: string, fn: () => Promise<void>) => { setBusy(k); try { await fn(); } catch (e) { toast(msg(e), 'err'); } finally { setBusy(''); } };
  return <Async s={s}>{d => { const m = d.material; const needsText = m.status === 'needs_text' || m.status === 'needs_confirmation';
    return <Card className="col"><div className="row wrap"><h2 className="grow ell">{m.name}</h2><StatusBadge s={m.status} /><Button tone="secondary" onClick={() => setConf(true)} aria-label="Delete material"><Icon name="trash" /></Button></div>
      {m.note && <div className="notice info"><Icon name="info" />{m.note}</div>}
      {m.kind === 'image' && <img className="thumb" src={`/api/materials/${m.id}/file`} alt="Your uploaded photo" />}
      {m.source_url && <p className="small muted">Source: {m.source_url}</p>}
      {m.status === 'needs_ocr' && <div className="notice warn"><Icon name="alert" />This PDF has no readable text (it looks scanned) and OCR for scanned pages is not available here. Try a text-based PDF, a clear photo of one page, or type the text.</div>}
      {needsText && <div className="col"><h3>Text from your photo</h3>
        {ocr && m.status === 'needs_text' && <Button tone="secondary" disabled={busy === 'ocr'} onClick={() => run('ocr', async () => { const r = await post(`/materials/${m.id}/ocr`); setTxt(r.text); await s.reload(); onChange(); })}>{busy === 'ocr' ? 'Reading…' : 'Read text from photo'}</Button>}
        <div className="field"><label htmlFor="mt">{m.status === 'needs_confirmation' ? 'Check and correct the text' : 'Type or paste the question / text'}</label><textarea id="mt" rows={5} value={txt ?? d.text ?? ''} onChange={e => setTxt(e.target.value)} maxLength={8000} /></div>
        <div className="row"><Button disabled={(txt ?? d.text ?? '').trim().length < 5 || busy === 'save'} onClick={() => run('save', async () => { await put(`/materials/${m.id}/text`, { text: txt ?? d.text }); toast('Text confirmed'); await s.reload(); onChange(); })}>Confirm text</Button></div></div>}
      {d.text && m.status === 'ready' && <>
        <details><summary className="semi">Preview extracted text</summary><p className="preview">{d.text.slice(0, 1500)}{d.text.length > 1500 ? '…' : ''}</p></details>
        <form className="row wrap" onSubmit={e => { e.preventDefault(); run('ask', async () => setAns(await post(`/materials/${m.id}/ask`, { question: q }))); }}><div className="field grow"><label className="sr" htmlFor="mq">Ask about this material</label><input id="mq" value={q} onChange={e => setQ(e.target.value)} placeholder="Ask a question about this material…" maxLength={500} /></div><Button type="submit" disabled={q.trim().length < 2 || busy === 'ask'}>{busy === 'ask' ? 'Searching…' : 'Ask'}</Button></form>
        {ans && (ans.found ? <div className="col">{ans.answers.map((a: any, i: number) => <div key={i} className="quote"><p>{a.text}</p><span className="muted xs">{a.page ? `Page ${a.page}` : 'From your material'}</span></div>)}</div> : <div className="notice warn"><Icon name="alert" />I could not find that in this material, so I won’t guess. Try different words.</div>)}
        <div className="row wrap"><Button tone="secondary" disabled={busy === 'notes'} onClick={() => run('notes', async () => setNotes(await post(`/materials/${m.id}/notes`)))}>Make notes</Button><Button tone="secondary" disabled={busy === 'quiz'} onClick={() => run('quiz', async () => { setShown({}); setQuiz(await post(`/materials/${m.id}/quiz`)); })}>Make a quiz</Button><Button onClick={onChat}><Icon name="chat" /> Chat about this</Button></div>
        {notes && <div className="col"><h3>Notes</h3><p className="muted small">{notes.label}</p><ul>{notes.notes.map((n: any, i: number) => <li key={i}>{n.text}{n.page && <span className="muted xs"> (page {n.page})</span>}</li>)}</ul></div>}
        {quiz && <div className="col"><h3>Quiz</h3><p className="muted small">{quiz.label}</p>{!quiz.questions.length ? <p>Not enough text to build questions.</p> : quiz.questions.map((x: any, i: number) => <div key={i} className="qbox"><p><b>Q{i + 1}.</b> {x.prompt}</p><Button tone="secondary" onClick={() => setShown({ ...shown, [i]: x.answer })}>Show answer</Button>{shown[i] && <span className="semi"> {shown[i]}</span>}</div>)}</div>}</>}
      {conf && <Modal title="Delete this material?" onClose={() => setConf(false)}><p>The file and its extracted text will be permanently removed.</p><div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><Button tone="secondary" onClick={() => setConf(false)}>Cancel</Button><Button tone="danger" onClick={async () => { try { await del(`/materials/${m.id}`); toast('Deleted'); onDeleted(); } catch (e) { toast(msg(e), 'err'); } }}>Delete</Button></div></Modal>}
    </Card>; }}</Async>;
}
