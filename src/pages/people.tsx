import { useState } from 'react';
import { Async, Badge, Button, Card, Empty, Modal, PageTitle, fmtDate, useLoad } from '../components/ui';
import { get, patch, post, msg } from '../api';
import { useToast } from '../components/toast';
import { useAuth } from '../auth';

const ROLES: [string, string][] = [['student', 'Student'], ['parent', 'Parent / guardian'], ['teacher', 'Teacher'], ['school_admin', 'School admin'], ['admin', 'Platform admin']];
const roleName = (r: string) => (r === 'pending' ? 'Awaiting approval' : ROLES.find(x => x[0] === r)?.[1] ?? r);

/** Platform admin: approve teacher / school-admin sign-ups, find people, switch accounts off, help someone who is locked out. */
export function People() {
  const toast = useToast(); const { user } = useAuth(); const [term, setTerm] = useState(''); const [applied, setApplied] = useState('');
  const reqs = useLoad(() => get('/admin/role-requests')); const users = useLoad(() => get(`/admin/users${applied ? `?q=${encodeURIComponent(applied)}` : ''}`), [applied]);
  const schools = useLoad(() => get('/admin/schools')); const mail = useLoad(() => get('/auth/config'));
  const [decide, setDecide] = useState<any | null>(null); const [school, setSchool] = useState(''); const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState<any | null>(null); const [temp, setTemp] = useState<string | null>(null);
  const refresh = () => { reqs.reload(); users.reload(); };
  const run = async (fn: () => Promise<any>, ok: string) => { setBusy(true); try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(msg(e), 'err'); } finally { setBusy(false); } };
  const doDecide = async (decision: 'approve' | 'decline') => { const r = await run(() => post(`/admin/role-requests/${decide.userId}/decide`, { decision, schoolId: decision === 'approve' && school ? school : undefined }), decision === 'approve' ? 'Approved. They can sign in with their new role.' : 'Declined. The account is switched off.'); if (r) { setDecide(null); setSchool(''); refresh(); } };
  const toggle = async (u: any) => { if (await run(() => patch(`/admin/users/${u.id}`, { disabled: !u.disabled }), u.disabled ? 'Account switched on.' : 'Account switched off. They were signed out.')) users.reload(); };
  const setRole = async (u: any, role: string) => { if (await run(() => patch(`/admin/users/${u.id}`, { role }), `Role changed to ${roleName(role)}.`)) users.reload(); };
  const reset = async (mode: 'email' | 'temp') => { const r = await run(() => post(`/admin/users/${help.id}/reset-password`, { mode }), mode === 'email' ? 'Reset link sent.' : ''); if (!r) return; if (mode === 'temp') setTemp(r.temporaryPassword); else setHelp(null); };
  return <div className="col">
    <PageTitle title="People and approvals" sub="Approve teachers and school admins, find an account, switch it off, or help someone who cannot sign in." />
    <Async s={reqs}>{d => <Card className="col"><h2 style={{ margin: 0 }}>Waiting for approval {d.requests.length > 0 && <Badge tone="warning">{d.requests.length}</Badge>}</h2>
      {!d.requests.length ? <p className="muted">Nobody is waiting.</p> : d.requests.map((r: any) => <div key={r.userId} className="row wrap" style={{ gap: 12, alignItems: 'flex-start', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
        <div className="grow"><b>{r.name}</b> <Badge tone="info">{roleName(r.requested)}</Badge><div className="muted small">{r.email}</div>
          <div className="small">{r.schoolName}{r.institutionEmail ? ` · ${r.institutionEmail}` : ''}{r.subjects?.length ? ` · ${r.subjects.join(', ')}` : ''}{r.classes?.length ? ` · classes ${r.classes.join(', ')}` : ''}</div>
          <div className="muted small">Check the details are real before approving: this gives access to students' work.</div></div>
        <Button onClick={() => { setDecide(r); setSchool(''); }}>Review</Button></div>)}</Card>}</Async>
    <Card className="col"><h2 style={{ margin: 0 }}>All accounts</h2>
      <form className="row wrap" onSubmit={e => { e.preventDefault(); setApplied(term.trim()); }} role="search"><div className="field grow" style={{ margin: 0 }}><label htmlFor="pp-q" className="sr">Search by name or email</label><input id="pp-q" value={term} onChange={e => setTerm(e.target.value)} placeholder="Search by name or email" /></div><Button type="submit" tone="secondary">Search</Button>{applied && <Button type="button" tone="secondary" onClick={() => { setTerm(''); setApplied(''); }}>Clear</Button>}</form>
      <Async s={users}>{d => !d.users.length ? <Empty title="No one found" text="Try part of the name or the email address." /> : <div className="tablewrap" tabIndex={0} role="region" aria-label="Accounts"><table className="tbl"><thead><tr><th>Name</th><th>Role</th><th>Joined</th><th>Status</th><th><span className="sr">Actions</span></th></tr></thead><tbody>{d.users.map((u: any) => <tr key={u.id}>
        <td><b>{u.display_name}</b><div className="muted small">{u.email}</div></td>
        <td>{u.role === 'pending' ? <Badge tone="warning">Awaiting approval</Badge> : u.id === user?.id || u.is_demo ? roleName(u.role) : <select aria-label={`Role of ${u.display_name}`} value={u.role} disabled={busy} onChange={e => setRole(u, e.target.value)}>{ROLES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>}</td>
        <td className="small">{fmtDate(u.created_at)}</td><td>{u.disabled ? <Badge tone="danger">Off</Badge> : u.is_demo ? <Badge tone="warning">Demo</Badge> : <Badge tone="success">Active</Badge>}</td>
        <td><div className="row wrap" style={{ gap: 6 }}>{u.id !== user?.id && <Button tone="secondary" disabled={busy} onClick={() => toggle(u)}>{u.disabled ? 'Switch on' : 'Switch off'}</Button>}{!u.disabled && !u.is_demo && u.role !== 'pending' && <Button tone="secondary" disabled={busy} onClick={() => { setHelp(u); setTemp(null); }}>Can't sign in</Button>}</div></td></tr>)}</tbody></table>
        {d.users.length >= 300 && <p className="muted small">Showing the newest 300. Search to find someone older.</p>}</div>}</Async></Card>
    {decide && <Modal title={`Review ${decide.name}`} onClose={() => setDecide(null)}>
      <p>They asked to join as <b>{roleName(decide.requested)}</b> at <b>{decide.schoolName}</b>.</p>
      <div className="field"><label htmlFor="pp-school">Assign to a school (optional)</label><select id="pp-school" value={school} onChange={e => setSchool(e.target.value)}><option value="">No school yet</option>{(schools.data?.schools ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      <div className="row wrap" style={{ gap: 8 }}><Button disabled={busy} onClick={() => doDecide('approve')}>Approve</Button><Button tone="danger" disabled={busy} onClick={() => doDecide('decline')}>Decline</Button><Button tone="secondary" onClick={() => setDecide(null)}>Cancel</Button></div></Modal>}
    {help && <Modal title={`Help ${help.display_name} sign in`} onClose={() => { setHelp(null); setTemp(null); }}>
      {temp ? <div className="col"><p>Give this one-time password to <b>{help.display_name}</b> in person or by phone. It is shown only once. They were signed out everywhere and should change it after signing in.</p>
        <p style={{ fontSize: 22, letterSpacing: 1 }}><code aria-label="Temporary password">{temp}</code></p><div className="row wrap"><Button tone="secondary" onClick={() => { navigator.clipboard?.writeText(temp).then(() => toast('Copied.'), () => toast('Copy it by hand.', 'err')); }}>Copy</Button><Button onClick={() => { setHelp(null); setTemp(null); }}>Done</Button></div></div>
      : <div className="col"><p>Choose how to help <b>{help.display_name}</b> ({help.email}).</p>
        <div className="row wrap" style={{ gap: 8 }}><Button disabled={busy || !mail.data?.email?.enabled} onClick={() => reset('email')}>Email a reset link</Button><Button tone="secondary" disabled={busy} onClick={() => reset('temp')}>Make a temporary password</Button></div>
        {!mail.data?.email?.enabled && <p className="muted small">Email is not set up on this server, so only a temporary password is available.</p>}</div>}</Modal>}
  </div>;
}
