import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Async, Badge, Button, Card, Empty, Icon, Modal, PageTitle, fmtDate, fmtDT, useLoad } from '../components/ui';
import { get, msg } from '../api';
import { PREVIEW } from '../preview';
import { useToast } from '../components/toast';
import { PublicLayout } from './public';

const tone = (s: string): any => (s === 'valid' ? 'success' : s === 'revoked' ? 'danger' : 'neutral');
export function CertPreview({ c }: { c: any }) {
  const s = c.snapshot;
  return (
    <div className={`cert certprev ${c.status !== 'valid' ? 'invalid' : ''}`} aria-label="Certificate preview">
      <div className="ctop">AI LEARNING PLATFORM · KARKAI AI</div>
      <h2 className="ctitle">Weekly Test Achievement Certificate</h2><div className="ta csub">வாராந்திரத் தேர்வு சாதனைச் சான்றிதழ்</div>
      <p className="muted">This certificate recognises that</p>
      <div className="cname">{s.student_name}</div>{s.student_name_ta && <div className="ta cname2">{s.student_name_ta}</div>}
      <p>of Class {s.class_level} passed <b>{s.test_title}</b> ({s.subject_en}, {s.academic_year}) with <b>{s.marks}/{s.total} ({s.pct}%)</b></p>
      <div className="row wrap" style={{ justifyContent: 'center' }}><span className="small">Achieved {fmtDate(s.achieved_on)}</span><span className="small">Ref {c.ref_no}</span>{c.status !== 'valid' && <Badge tone={tone(c.status)}>{c.status.toUpperCase()}</Badge>}</div>
      <div className="cfoot muted xs">Issued by the AI Learning Platform. This is not an official Tamil Nadu State Board certificate.</div>
    </div>
  );
}

export function Certificates() {
  const s = useLoad(() => get('/certificates')); const toast = useToast(); const [hist, setHist] = useState<any>(null);
  return <div className="col"><PageTitle title="My certificates" sub="Awarded for passing weekly tests. Each has a QR code that anyone can verify." />
    <Async s={s}>{d => !d.certificates.length ? <Empty title="No certificates yet" text="Pass a weekly test that awards a certificate and it will appear here." action={<Button to="/app/tests">See weekly tests</Button>} /> : d.certificates.map((c: any) => {
      const link = `${d.base}/verify/${c.token}`;
      return <Card key={c.id} className="col"><CertPreview c={c} />
        {c.status !== 'valid' && <div className="notice warn"><Icon name="alert" />This certificate is {c.status}{c.reason ? `: ${c.reason}` : ''}. It no longer verifies as valid.</div>}
        <div className="row wrap no-print">
          <a className="btn primary" href={PREVIEW ? '/preview/certificate.pdf' : `/api/certificates/${c.id}/pdf`} download><Icon name="download" /> Download PDF</a>
          <a className="btn secondary" href={PREVIEW ? '/preview/certificate.pdf' : `/api/certificates/${c.id}/pdf?inline=1`} target="_blank" rel="noreferrer"><Icon name="print" /> Open / print</a>
          <Button tone="secondary" onClick={async () => { try { await navigator.clipboard.writeText(link); toast('Verification link copied'); } catch { toast(link); } }}><Icon name="link" /> Copy verification link</Button>
          <Button tone="secondary" to={`/verify/${c.token}`}>View public page</Button>
          <Button tone="ghost" onClick={async () => { try { setHist({ c, h: (await get(`/certificates/${c.id}/history`)).history }); } catch (e) { toast(msg(e), 'err'); } }}>History</Button></div></Card>; })}</Async>
    {hist && <Modal title="Certificate history" onClose={() => setHist(null)}>{!hist.h.length ? <p className="muted">No events recorded.</p> : hist.h.map((e: any, i: number) => <div key={i} className="row listrow"><b className="grow">{e.action.replace('certificate.', '')}</b><span className="muted small">{fmtDT(e.at)}</span></div>)}</Modal>}</div>;
}

export function Verify() {
  const { token } = useParams(); const nav = useNavigate(); const [v, setV] = useState(token ?? ''); const s = useLoad(async () => (token ? get(`/verify/${encodeURIComponent(token)}`).catch(e => (e.status === 404 ? { found: false } : Promise.reject(e))) : null), [token]);
  return <PublicLayout><div className="doc col"><h1>Verify a certificate</h1><p className="muted">Enter the code from the end of the certificate’s verification link, or scan the QR code on the certificate.</p>
    <form className="row wrap" onSubmit={e => { e.preventDefault(); const t = v.trim().split('/').pop(); if (t) nav(`/verify/${t}`); }}><div className="field grow"><label className="sr" htmlFor="vt">Verification code</label><input id="vt" value={v} onChange={e => setV(e.target.value)} placeholder="Paste verification code or link" /></div><Button type="submit" disabled={!v.trim()}>Verify</Button></form>
    {token && <Async s={s}>{d => !d ? null : !d.found ? <Card className="col"><Badge tone="danger">Not found</Badge><h2>We could not find this certificate</h2><p className="muted">Check the code and try again. A certificate that cannot be found should not be trusted.</p></Card> :
      <Card className="col"><Badge tone={tone(d.status)}>{d.status === 'valid' ? 'Valid' : d.status === 'revoked' ? 'Revoked' : 'Superseded by a newer certificate'}</Badge><h2>{d.title}</h2>
        {d.holder && <p>Awarded to <b>{d.holder}</b></p>}<p>For: <b>{d.achievement}</b></p><p>Achieved on {fmtDate(d.achieved_on)}</p><p className="muted small">Issuer: {d.issuer}</p>
        {d.status !== 'valid' && <div className="notice warn"><Icon name="alert" />This certificate is not currently valid.</div>}<p className="muted xs">Only minimal information is shown to protect the student’s privacy.</p></Card>}</Async>}</div></PublicLayout>;
}
