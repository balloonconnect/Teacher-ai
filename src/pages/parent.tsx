import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Async, Badge, Button, Card, Empty, Icon, PageTitle, Stat, fmtDT, useLoad } from '../components/ui';
import { get, post, put, msg } from '../api';
import { useToast } from '../components/toast';
import { useAuth } from '../auth';

/* ---------------- Parent ---------------- */
export function ParentHome() {
  const s = useLoad(() => get('/parent/children')); const toast = useToast(); const [code, setCode] = useState('');
  return <div className="col"><PageTitle title="My children" sub="You can see only the students linked to your account." />
    <Async s={s}>{d => <>{!d.children.length && <Empty title="No children linked yet" text="Ask your child to open Settings and create a guardian code, then enter it below." />}
      <div className="grid g2">{d.children.map((k: any) => <Card key={k.student_id} className="col"><div className="row"><span className="avatar">{k.full_name[0]}</span><div className="grow"><b>{k.full_name}</b><div className="muted small">Class {k.class_level} · {k.medium} medium · {k.ref_no}</div></div></div>
        <div className="row wrap"><Badge tone="info">{k.report.finalised} tests finished</Badge><Badge tone="success">{k.report.passed} passed</Badge>{k.report.pending > 0 && <Badge tone="warning">{k.report.pending} pending</Badge>}</div><Button to={`/parent/child/${k.student_id}`}>View progress</Button></Card>)}</div>
      <Card className="col"><h2>Link a child</h2><form className="row wrap" onSubmit={async e => { e.preventDefault(); try { await post('/parent/link', { code }); toast('Child linked'); setCode(''); s.reload(); } catch (x) { toast(msg(x), 'err'); } }}><div className="field grow"><label htmlFor="gc">6-character code from your child’s Settings</label><input id="gc" value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={6} autoComplete="off" style={{ letterSpacing: 3 }} /></div><Button type="submit" disabled={code.length !== 6}>Link</Button></form>
        <p className="muted small">Linking also approves the child’s account for the AI tutor if they are under 13.</p></Card></>}</Async></div>;
}
export function ParentChild() {
  const { id } = useParams(); const s = useLoad(() => get(`/parent/children/${id}/overview`), [id]); const toast = useToast();
  return <div className="col"><Link to="/parent" className="link row" style={{ gap: 4 }}><Icon name="back" size={16} />My children</Link><Async s={s}>{d => <>
    <PageTitle title={d.student.name} sub={`Class ${d.student.class_level} · ${d.student.academic_year} · ${d.student.ref_no}`} />
    <div className="grid g4 stat"><Stat icon="test" bg="var(--primary-soft)" fg="var(--primary)" value={String(d.report.attempted)} label="Tests attempted" /><Stat icon="check" bg="var(--success-soft)" fg="var(--success)" value={String(d.report.passed)} label="Passed" /><Stat icon="chart" bg="var(--gold-soft)" fg="var(--gold)" value={d.report.passRate === null ? '—' : `${d.report.passRate}%`} label="Pass rate" /><Stat icon="clock" bg="var(--accent-soft)" fg="var(--accent)" value={`${d.activity.activeDays}/7`} label="Active days this week" /></div>
    <div className="grid g2 split"><Card className="col"><h2>Weekly tests</h2>{d.tests.map((t: any) => <div key={t.id} className="row wrap listrow"><span className="grow">{t.title}</span><Badge tone={t.status === 'Passed' ? 'success' : t.status === 'Not passed' ? 'danger' : t.status === 'Pending review' ? 'warning' : 'neutral'}>{t.status}</Badge></div>)}</Card>
      <Card className="col"><h2>Subjects</h2>{!d.report.subjects.length ? <p className="muted">Subject averages appear after the first finished test.</p> : d.report.subjects.map((x: any) => <div key={x.id} className="row listrow"><span className="grow">{x.name}</span><b>{x.avgPct}%</b></div>)}</Card></div>
    <Card className="col"><h2>How to help</h2><ul>{d.recommendations.map((r: string) => <li key={r}>{r}</li>)}</ul></Card>
    <Card className="col"><h2>Results history</h2>{!d.history.length ? <p className="muted">No results yet.</p> : <div className="tablewrap" tabIndex={0} role="region" aria-label="Data table"><table className="tbl"><thead><tr><th>Test</th><th>Attempt</th><th>Date</th><th>Score</th><th>Result</th></tr></thead><tbody>{d.history.map((h: any, i: number) => <tr key={i}><td>{h.title}</td><td>{h.attempt_no}</td><td>{fmtDT(h.submitted_at)}</td><td>{h.marks}/{h.total}</td><td><Badge tone={h.status === 'passed' ? 'success' : h.status === 'pending_review' ? 'warning' : 'danger'}>{h.status.replace('_', ' ')}</Badge></td></tr>)}</tbody></table></div>}</Card>
    <Card className="col"><h2>Certificates</h2>{!d.certificates.length ? <p className="muted">None yet.</p> : d.certificates.map((c: any) => <div key={c.id} className="row wrap listrow"><span className="grow">{c.title}<span className="muted small"> · {c.ref_no}</span></span><Badge tone={c.status === 'valid' ? 'success' : 'danger'}>{c.status}</Badge><a className="btn secondary" href={`/api/certificates/${c.id}/pdf`} download>PDF</a></div>)}</Card>
    <Card className="row wrap"><span className="grow">Email/in-app notifications about this child’s results</span><Button tone={d.notify ? 'secondary' : 'primary'} onClick={async () => { try { await put(`/parent/children/${id}/settings`, { notify: !d.notify }); toast(d.notify ? 'Notifications off' : 'Notifications on'); s.reload(); } catch (e) { toast(msg(e), 'err'); } }}>{d.notify ? 'Turn off' : 'Turn on'}</Button></Card></>}</Async></div>;
}
export function ParentAccount() { const { user } = useAuth(); return <div className="col"><PageTitle title="Account" /><Card className="col"><p><b>{user?.display_name}</b></p><p className="muted">{user?.email}</p><p className="muted small">To change your password or delete your account, contact your school or platform administrator (self-service is not part of this prototype).</p></Card></div>; }

/* ---------------- School admin ---------------- */
