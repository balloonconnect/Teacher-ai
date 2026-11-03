import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Async, Badge, Button, Card, Empty, PageTitle, fmtDT, useLoad } from '../components/ui';
import { LangToggle } from '../components/lang';
import { get, post, msg } from '../api';
import { useToast } from '../components/toast';
import { useAuth } from '../auth';

/* Screens from the Figma file that had no page yet: SET-01 Notifications, SET-02 Settings (all roles), PAR-04 Weekly reports, PAR-05 / teacher Messages. */

/** SET-01: the full list behind the bell. Every role. */
export function NotificationsPage() {
  const s = useLoad(() => get('/notifications')); const toast = useToast();
  return <div className="col"><PageTitle title="Notifications" sub="Updates about your account, tests and messages." />
    <Async s={s}>{(d: any) => <>
      {!!d.unread && <div className="row"><span className="grow muted">{d.unread} unread</span><Button tone="secondary" onClick={async () => { try { await post('/notifications/read'); s.reload(); } catch (x) { toast(msg(x), 'err'); } }}>Mark all read</Button></div>}
      {!d.notifications.length ? <Empty title="You have no notifications yet" text="When something happens on your account, it will show up here." />
        : <Card className="col">{d.notifications.map((n: any) => <div key={n.id} className={`note ${n.read ? '' : 'unread'}`}><div className="semi">{n.title}</div>{n.body && <div className="muted">{n.body}</div>}<div className="muted xs">{fmtDT(n.created_at)}</div></div>)}</Card>}
    </>}</Async></div>;
}

/** SET-02: one settings page for every role (students keep their own richer Settings page). */
export function AccountPage() {
  const { user, logout } = useAuth(); const nav = useNavigate();
  const role: Record<string, string> = { parent: 'Parent / guardian', teacher: 'Teacher', school_admin: 'School admin', admin: 'Platform admin', pending: 'Awaiting approval', student: 'Student' };
  return <div className="col"><PageTitle title="Settings" sub="Your account and language." />
    <Card className="col"><h2>Profile</h2><p><b>{user?.display_name}</b></p><p className="muted">{user?.email}</p><p className="muted small">{role[user?.role ?? 'student']}</p>
      <p className="muted small">To change your password, use “Forgot password” on the sign-in page. To delete your account, ask your school administrator.</p></Card>
    <Card className="col"><h2>Language</h2><p className="muted small">Choose Tamil, English or both for menus and help text.</p><div><LangToggle /></div></Card>
    <Card className="row"><span className="grow">Sign out of this device</span><Button tone="secondary" onClick={async () => { await logout(); nav('/'); }}>Sign out</Button></Card></div>;
}

/** PAR-04: past weekly reports for one child, built from finished test results. */
export function ParentReports() {
  const [sp, setSp] = useSearchParams(); const toast = useToast();
  const kids = useLoad(() => get('/parent/children')); const child = sp.get('child') ?? kids.data?.children?.[0]?.student_id;
  const rep = useLoad(() => (child ? get(`/parent/children/${child}/reports`) : Promise.resolve(null)), [child]);
  return <div className="col"><PageTitle title="Weekly reports" sub="A summary of each week’s finished tests. Weeks start on Monday." />
    <Async s={kids}>{(k: any) => !k.children.length ? <Empty title="No children linked yet" text="Link a child from My children to see weekly reports." /> : <>
      {k.children.length > 1 && <div className="field"><label htmlFor="rc">Child</label><select id="rc" value={child ?? ''} onChange={e => setSp({ child: e.target.value })}>{k.children.map((c: any) => <option key={c.student_id} value={c.student_id}>{c.full_name}</option>)}</select></div>}
      <Async s={rep}>{(d: any) => !d ? null : !d.reports.length ? <Empty title="No reports yet" text="A report appears after the first finished weekly test." /> : <>{d.reports.map((w: any) => <Card key={w.weekStart} className="col">
        <div className="row wrap"><h2 className="grow">{w.weekLabel}</h2><Badge tone="info">{w.attempted} tests</Badge><Badge tone="success">{w.passed} passed</Badge>{w.avgPct !== null && <Badge tone="neutral">Average {w.avgPct}%</Badge>}</div>
        {w.tests.map((t: any, i: number) => <div key={i} className="row wrap listrow"><span className="grow">{t.title}</span><b>{t.pct}%</b><Badge tone={t.status === 'Passed' ? 'success' : t.status === 'Not passed' ? 'danger' : 'warning'}>{t.status}</Badge></div>)}
        <div><Button tone="secondary" onClick={async () => { try { await post(`/parent/children/${child}/reports/email`, { weekStart: w.weekStart }); toast('Report emailed to you'); } catch (x) { toast(msg(x), 'err'); } }}>Email me this report</Button></div></Card>)}</>}</Async></>}</Async></div>;
}

/** PAR-05 (and the teacher side): messages between a parent and the teachers of their child's class. */
export function Messages() {
  const s = useLoad(() => get('/messages/contacts')); const toast = useToast();
  const [sel, setSel] = useState<string | null>(null); const [thread, setThread] = useState<any[]>([]); const [text, setText] = useState(''); const end = useRef<HTMLDivElement>(null);
  const open = async (id: string) => { setSel(id); try { setThread((await get(`/messages/thread/${id}`)).messages); } catch (x) { toast(msg(x), 'err'); } };
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [thread]);
  const send = async (e: React.FormEvent) => { e.preventDefault(); if (!sel || !text.trim()) return; try { await post(`/messages/thread/${sel}`, { body: text }); setText(''); await open(sel); s.reload(); } catch (x) { toast(msg(x), 'err'); } };
  return <div className="col"><PageTitle title="Messages" sub="Talk to the teachers of your child’s class, or to the parents of your students." />
    <Async s={s}>{(d: any) => !d.contacts.length ? <Empty title="Nobody to message yet" text="You can message a teacher once your child is in their class, and a parent once they are linked to a student in your class." /> :
      <div className="grid g2 split"><Card className="col"><h2>People</h2>{d.contacts.map((c: any) => <button key={c.id} className={`listrow linkbtn ${sel === c.id ? 'active' : ''}`} style={{ textAlign: 'left' }} onClick={() => open(c.id)} aria-pressed={sel === c.id}>
          <span className="grow"><b>{c.name}</b><span className="muted small"> · {c.children.map((x: any) => x.child).join(', ')}</span>{c.last && <span className="muted xs" style={{ display: 'block' }}>{c.last.body.slice(0, 60)}</span>}</span>{c.unread > 0 && <Badge tone="warning">{c.unread} new</Badge>}</button>)}</Card>
        <Card className="col">{!sel ? <p className="muted">Choose a person to see your conversation.</p> : <>
          <div className="col" role="log" aria-live="polite" style={{ maxHeight: 360, overflowY: 'auto' }}>{!thread.length ? <p className="muted">No messages yet. Say hello.</p> : thread.map(m => <div key={m.id} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '85%' }}><div className={`note ${m.mine ? '' : 'unread'}`}>{m.body}</div><div className="muted xs">{fmtDT(m.created_at)}</div></div>)}<div ref={end} /></div>
          <form className="row" onSubmit={send}><div className="field grow"><label htmlFor="mb">Message</label><input id="mb" value={text} maxLength={1000} onChange={e => setText(e.target.value)} /></div><Button type="submit" disabled={!text.trim()}>Send</Button></form></>}</Card></div>}</Async></div>;
}
