import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Async, Badge, Button, Card, Empty, Field, Icon, Modal, PageTitle, useLoad } from '../components/ui';
import { get, post, del, api, msg } from '../api';
import { useToast } from '../components/toast';
import { Bi } from '../components/lang';

const SUBJ: [string, string][] = [['', 'All subjects'], ['maths', 'Mathematics'], ['science', 'Science'], ['english', 'English'], ['social', 'Social Science'], ['tamil', 'Tamil']];
const subjName = (id: string | null) => SUBJ.find(s => s[0] === id)?.[1] ?? 'All subjects';

/** Student: the books of their own class (the server only returns those). */
export function ClassBooks() {
  const s = useLoad(() => get('/textbooks'));
  return <div className="col"><PageTitle title={<Bi en="My class books" ta="என் வகுப்புப் புத்தகங்கள்" />} sub="Only the books for your class are shown here. The tutor answers from these books and shows you the page." />
    <Async s={s}>{d => !d.textbooks.length ? <Empty title="No books for your class yet" text="Your teacher or school has not added a book for your class. Lessons and practice still work." /> :
      <div className="grid g2">{d.textbooks.map((b: any) => <Card key={b.id} className="col"><b>{b.title}</b><div className="muted small">{subjName(b.subject_id)} · Class {b.class_level} · {b.medium} · {b.page_count} pages</div>
        <div className="row wrap"><Button to={`/app/textbook/${b.id}`}>Open book</Button></div></Card>)}</div>}</Async></div>;
}

/** Opens the real PDF at the cited page, with the page's text underneath (also works if the browser cannot show PDFs inline). */
export function BookViewer() {
  const { id } = useParams(); const [sp, setSp] = useSearchParams(); const page = Math.max(1, Number(sp.get('page')) || 1);
  const book = useLoad(() => get(`/textbooks/${id}`), [id]); const [text, setText] = useState<string | null>(null); const [chapters, setChapters] = useState<any[]>([]);
  useEffect(() => { let off = false; get(`/textbooks/${id}/chapters`).then(r => { if (!off) setChapters(r.chapters ?? []); }).catch(() => { if (!off) setChapters([]); }); return () => { off = true; }; }, [id]);
  useEffect(() => { let off = false; setText(null); get(`/textbooks/${id}/pages/${page}`).then(r => { if (!off) setText(r.text); }).catch(() => { if (!off) setText(''); }); return () => { off = true; }; }, [id, page]);
  const go = (n: number) => setSp({ page: String(n) }, { replace: true });
  return <div className="col"><Async s={book}>{({ textbook: b }) => <>
    <PageTitle title={b.title} sub={`${subjName(b.subject_id)} · Class ${b.class_level} · page ${page} of ${b.page_count}`} right={<Button tone="secondary" to="/app/books">All books</Button>} />
    <div className="row wrap"><Button tone="secondary" disabled={page <= 1} onClick={() => go(page - 1)}>Previous page</Button><Button tone="secondary" disabled={page >= b.page_count} onClick={() => go(page + 1)}>Next page</Button></div>
    {!!chapters.length && (() => { const cur = chapters.find(c => page >= c.startPage && page <= c.endPage); return <Card className="col"><details><summary style={{ cursor: 'pointer' }}><b>Chapters</b> <span className="muted small">· {cur ? `now in “${cur.title}”, pages ${cur.startPage}–${cur.endPage}` : `${chapters.length} in this book`}</span></summary>
      <div className="col" role="list" style={{ marginTop: 12 }}>{chapters.map(c => <div key={c.id} role="listitem" className="row wrap listrow"><button type="button" className="link grow" style={{ textAlign: 'left', background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }} aria-current={c === cur ? 'true' : undefined} onClick={() => go(c.startPage)}>{c === cur ? <b>{c.title}</b> : c.title} <span className="muted small">· pages {c.startPage}–{c.endPage}</span></button><Button tone="secondary" to={`/app/voice?book=${b.id}&chapter=${c.id}`}>Learn this chapter</Button></div>)}</div></details>
      {cur && <div className="row wrap"><Button to={`/app/voice?book=${b.id}&chapter=${cur.id}`}>Learn this chapter with the tutor</Button></div>}</Card>; })()}
    {b.file_ok === false ? <div className="notice warn"><Icon name="alert" /><div><b>The PDF file is not available on the server.</b> The page text below is still shown. Ask your teacher or admin to upload the book again.</div></div> : <Card className="col"><div className="row wrap"><a className="btn secondary" href={`/api/textbooks/${b.id}/file#page=${page}`} target="_blank" rel="noreferrer">Open the PDF at page {page}</a></div><iframe key={page} title={`${b.title}, page ${page}`} src={`/api/textbooks/${b.id}/file#page=${page}`} style={{ width: '100%', height: '70vh', border: 0, borderRadius: 8 }} />
      <p className="muted small">If the book does not appear, <a className="link" href={`/api/textbooks/${b.id}/file#page=${page}`} target="_blank" rel="noreferrer">open the PDF in a new tab</a> and go to page {page}.</p></Card>}
    <Card className="col"><h2>Text of page {page}</h2>{text === null ? <p className="muted">Loading…</p> : text ? <p style={{ whiteSpace: 'pre-wrap' }}>{text}</p> : <p className="muted">No readable text on this page (it may be a picture page).</p>}
      <div className="row wrap"><Button tone="secondary" to={`/app/tutor?q=${encodeURIComponent(`Explain page ${page} of ${b.title}`)}`}>Ask the tutor about this page</Button></div></Card></>}</Async></div>;
}

/** While any book is still being read (OCR), refresh the list every few seconds so progress shows. */
function KeepFresh({ active, reload }: { active: boolean; reload: () => void }) {
  useEffect(() => { if (!active) return; const t = setInterval(reload, 5000); return () => clearInterval(t); }, [active, reload]);
  return null;
}
const STATUS: Record<string, { tone: 'success' | 'warning' | 'info' | 'danger'; label: string }> = {
  ready: { tone: 'success', label: 'Ready' }, processing: { tone: 'info', label: 'Reading pages…' }, needs_ocr: { tone: 'warning', label: 'Needs OCR' }, failed: { tone: 'danger', label: 'Failed' },
};

/** Admin: what this server is running with, so a live set-up can be checked at a glance. */
function SystemStatus() {
  const s = useLoad(() => get('/admin/system'));
  return <Async s={s}>{d => <Card className="col"><h2>Live set-up check</h2>
    <p className="muted small">{d.ready ? 'Everything needed for a live site is in place.' : d.production ? 'Some things are not set up for a live site yet.' : 'Development mode: warnings below only matter for a live site.'}</p>
    {d.checks.map((c: any) => <div key={c.key} className="row wrap listrow"><div className="grow"><b>{c.label}</b><div className="muted small">{c.detail}</div>{!c.ok && c.advice && <div className="muted small">{c.advice}</div>}</div><Badge tone={c.ok ? 'success' : 'warning'}>{c.ok ? 'OK' : 'To do'}</Badge></div>)}
    <p className="muted small">Content: {d.content.lessons} lessons · {d.content.practiceQuestions} practice questions · {d.content.books} class book(s), {d.content.bookPages} pages read{d.content.booksReading ? ` (${d.content.booksReading} still reading)` : ''}.</p></Card>}</Async>;
}

/** Admin: upload and remove class books. Teachers get the same page read-only. */
export function BookAdmin({ canEdit = false }: { canEdit?: boolean }) {
  const s = useLoad(() => get('/textbooks')); const toast = useToast(); const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<any>(null); const [ef, setEf] = useState({ subjectId: '', medium: 'English' });
  const openEdit = (b: any) => { setEf({ subjectId: b.subject_id ?? '', medium: b.medium }); setEdit(b); };
  const saveEdit = async () => { try { await api('PATCH', `/textbooks/${edit.id}`, { subjectId: ef.subjectId || null, medium: ef.medium }); toast('Book updated.'); setEdit(null); s.reload(); } catch (x) { toast(msg(x), 'err'); } };
  const [f, setF] = useState({ title: '', classLevel: '8', subjectId: '', medium: 'English' }); const [file, setFile] = useState<File | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!file) return toast('Choose a PDF first.', 'err');
    const fd = new FormData(); fd.set('title', f.title); fd.set('classLevel', f.classLevel); if (f.subjectId) fd.set('subjectId', f.subjectId); fd.set('medium', f.medium); fd.set('file', file);
    setBusy(true); try { const r = await post('/textbooks', fd); toast(r.textbook.status === 'ready' ? 'Book added.' : r.textbook.status === 'processing' ? 'Book added. Its pages are being read now; this can take several minutes.' : 'Book added, but the chatbot cannot read it yet (scanned pages).', r.textbook.status === 'needs_ocr' ? 'err' : 'ok'); setFile(null); setF({ ...f, title: '' }); s.reload(); } catch (x) { toast(msg(x), 'err'); } finally { setBusy(false); }
  };
  return <div className="col"><PageTitle title="Class books" sub={canEdit ? "Upload a textbook PDF for one class. Students of that class (and only that class) can open it, and the tutor answers from it." : "Books added by the platform admin. Students see only their own class’s books. Teachers can read them but cannot add or remove books."} />
    {canEdit && <SystemStatus />}
    {canEdit && <Card><form className="col" onSubmit={submit}>
      <div className="grid g2"><Field label="Book title" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required minLength={2} maxLength={120} placeholder="Class 8 Mathematics — Term 1" />
        <div className="field"><label htmlFor="bk-c">Class</label><select id="bk-c" value={f.classLevel} onChange={e => setF({ ...f, classLevel: e.target.value })}>{Array.from({ length: 12 }, (_, i) => i + 1).map(c => <option key={c}>{c}</option>)}</select></div>
        <div className="field"><label htmlFor="bk-s">Subject</label><select id="bk-s" value={f.subjectId} onChange={e => setF({ ...f, subjectId: e.target.value })}>{SUBJ.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
        <div className="field"><label htmlFor="bk-m">Medium</label><select id="bk-m" value={f.medium} onChange={e => setF({ ...f, medium: e.target.value })}><option>English</option><option>Tamil</option><option value="Both">Both (Tamil + English)</option></select></div></div>
      <div className="field"><label htmlFor="bk-f">PDF file (up to 60 MB)</label><input id="bk-f" type="file" accept="application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} required /></div>
      <div className="row"><Button type="submit" disabled={busy}>{busy ? 'Reading the PDF…' : 'Upload book'}</Button></div>
      <p className="muted small">Only upload books you are allowed to share with students. Scanned books, and old Tamil books whose text is garbled, are read page by page in the background (about 2–3 seconds a page). Students can open the book straight away; the tutor can use pages as they are finished.</p></form></Card>}
    <Async s={s}>{d => !d.textbooks.length ? <Empty title="No books yet" text="Uploaded books appear here." /> : <Card className="col"><KeepFresh active={d.textbooks.some((b: any) => b.status === 'processing')} reload={s.reload} /><h2>{canEdit ? 'Uploaded books' : 'Class books'}</h2>{d.textbooks.map((b: any) => <div key={b.id} className="row wrap listrow"><div className="grow"><b>{b.title}</b>{canEdit && b.file_ok === false && <Badge tone="danger">PDF file missing — upload again</Badge>}<div className="muted small">Class {b.class_level} · {subjName(b.subject_id)} · {b.medium} · {b.page_count} pages</div>{b.note && <div className="muted small">{b.note}</div>}</div><Badge tone={(STATUS[b.status] ?? STATUS.needs_ocr).tone}>{(STATUS[b.status] ?? STATUS.needs_ocr).label}</Badge>
      {canEdit && b.status === 'needs_ocr' && <Button tone="secondary" onClick={async () => { try { await post(`/textbooks/${b.id}/ocr`, {}); toast('Reading the pages now.', 'ok'); s.reload(); } catch (x) { toast(msg(x), 'err'); } }}>Read pages (OCR)</Button>}
      {canEdit && b.status === 'ready' && <Button tone="secondary" onClick={async () => { if (!confirm('Read every page again with OCR? This takes a few minutes and replaces the stored page text.')) return; try { await post(`/textbooks/${b.id}/ocr`, { all: true }); toast('Reading all pages again.', 'ok'); s.reload(); } catch (x) { toast(msg(x), 'err'); } }}>Re-read all pages</Button>}
      {canEdit && b.status === 'ready' && <Button tone="secondary" onClick={async () => { try { const r = await post(`/textbooks/${b.id}/chapters/detect`, {}); toast(`${r.chapters.length} chapters found from the contents page.`, 'ok'); } catch (x) { toast(msg(x), 'err'); } }}>Find chapters</Button>}
      {canEdit && <Button tone="secondary" aria-label={`Edit ${b.title}`} title="Edit subject and medium" onClick={() => openEdit(b)}><Icon name="edit" /></Button>}
      {canEdit && <Button tone="ghost" onClick={async () => { if (!confirm(`Remove “${b.title}”?`)) return; try { await del(`/textbooks/${b.id}`); s.reload(); } catch (x) { toast(msg(x), 'err'); } }}>Remove</Button>}</div>)}</Card>}</Async>
    {edit && <Modal title="Edit book" onClose={() => setEdit(null)}><p className="muted small">{edit.title}</p>
      <div className="grid g2"><div className="field"><label htmlFor="eb-s">Subject</label><select id="eb-s" value={ef.subjectId} onChange={e => setEf({ ...ef, subjectId: e.target.value })}>{SUBJ.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
        <div className="field"><label htmlFor="eb-m">Medium</label><select id="eb-m" value={ef.medium} onChange={e => setEf({ ...ef, medium: e.target.value })}><option>English</option><option>Tamil</option><option value="Both">Both (Tamil + English)</option></select></div></div>
      <p className="muted small">Lessons made from this book follow the new subject. A new medium applies to lessons straight away; to read the pages again in the new language, use “Re-read all pages”.</p>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><Button tone="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={saveEdit}>Save</Button></div></Modal>}</div>;
}

/** Lesson "Textbook" tab: only the book pages related to this lesson, each opening in a new tab. */
export function LessonBook({ lessonId }: { lessonId: string }) {
  const s = useLoad(() => get(`/textbooks/for-lesson/${lessonId}`), [lessonId]);
  return <Async s={s}>{d => !d.pages.length
    ? <Empty title="No related textbook pages yet" text="Either no book has been added for your class, or nothing in it matches this lesson. The lesson, mind map and practice still work." />
    : <div className="col"><p className="muted small">Pages from your class book that relate to this lesson. Only short excerpts are shown here — open the page to read it in the book.</p>
      {d.pages.map((p: any) => <Card key={`${p.bookId}-${p.page}`} className="col"><div className="row wrap"><b className="grow">{p.book}</b><Badge tone="info">Page {p.page}</Badge></div>
        <p>{p.excerpt}</p><div className="row"><Link className="btn secondary" to={`/app/textbook/${p.bookId}?page=${p.page}`} target="_blank" rel="noreferrer">Open page {p.page} in a new tab</Link></div></Card>)}</div>}</Async>;
}
