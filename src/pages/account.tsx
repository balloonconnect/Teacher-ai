import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Card, Field, Icon } from '../components/ui';
import { get, post, msg } from '../api';

/** Public pages reached from emailed links: forgot / reset password, confirm email, guardian approval. */
const Shell = ({ title, children }: { title: string; children: React.ReactNode }) => <div className="authwrap"><Card className="authcard"><h1>{title}</h1>{children}</Card></div>;
const Help = () => <>
  <h2 style={{ fontSize: 16 }}>Who can help</h2>
  <ul className="col" style={{ margin: 0, paddingLeft: 18 }}>
    <li><b>Students:</b> ask your teacher or school administrator, or your parent or guardian if they manage your account.</li>
    <li><b>Parents and teachers:</b> ask your school administrator.</li>
    <li><b>School administrators:</b> contact the platform administrator who invited you.</li>
  </ul></>;

export function ForgotPassword() {
  const [enabled, setEnabled] = useState<boolean | null>(null); const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { document.title = 'Forgot password · Karkai AI'; get('/auth/config').then(c => setEnabled(!!c.email?.enabled)).catch(() => setEnabled(false)); }, []);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setErr(''); setBusy(true); try { await post('/auth/forgot', { email }); setDone(true); } catch (x) { setErr(msg(x)); } finally { setBusy(false); } };
  return <Shell title="Forgot your password?">
    {enabled === null ? <p className="muted" role="status">Loading…</p> : enabled ? (done
      ? <div className="notice info" role="status"><Icon name="info" /><span>If there is an account for <b>{email}</b>, we have sent a link to choose a new password. It works once and expires in 1 hour. Check your spam folder too.</span></div>
      : <form className="col" onSubmit={submit} noValidate>
        <p className="muted">Enter the email you signed up with. We will send you a link to choose a new password.</p>
        <Field label="Email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} error={err} />
        <Button type="submit" disabled={busy || !email.includes('@')} aria-busy={busy}>{busy ? 'Sending…' : 'Send reset link'}</Button></form>)
      : <><div className="notice warn"><Icon name="info" /><span>Resetting a password by email is not set up on this service, so we cannot send you a reset link.</span></div><Help /></>}
    <p className="muted small">Never share your password with anyone, including people who say they are from Karkai AI.</p>
    <div className="row wrap"><Button to="/signin">Back to sign in</Button><Button tone="secondary" to="/signup">Create an account</Button></div>
  </Shell>;
}

export function ResetPassword() {
  const [sp] = useSearchParams(); const token = sp.get('token') ?? ''; const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState(false);
  useEffect(() => { document.title = 'Choose a new password · Karkai AI'; }, []);
  const weak = pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); if (weak) return setErr('Use at least 8 characters, with letters and at least one number.'); if (pw !== pw2) return setErr('The two passwords are not the same.'); setErr(''); setBusy(true); try { await post('/auth/reset', { token, password: pw }); setDone(true); } catch (x) { setErr(msg(x)); } finally { setBusy(false); } };
  return <Shell title="Choose a new password">
    {!token ? <div className="notice warn"><Icon name="alert" /><span>This link is incomplete. Open the link from your email again, or <Link to="/forgot-password" className="link">ask for a new one</Link>.</span></div>
      : done ? <><div className="notice info" role="status"><Icon name="info" /><span>Your password has been changed. For safety you were signed out on every device.</span></div><Button to="/signin">Sign in</Button></>
      : <form className="col" onSubmit={submit} noValidate>
        <Field label="New password" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} required maxLength={128} hint="At least 8 characters, with letters and a number." />
        <Field label="Type it again" type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} required maxLength={128} error={err} />
        <Button type="submit" disabled={busy} aria-busy={busy}>{busy ? 'Saving…' : 'Change password'}</Button>
        {err.includes('expired') && <p className="small"><Link to="/forgot-password" className="link">Ask for a new link</Link></p>}</form>}
  </Shell>;
}

export function VerifyEmail() {
  const [sp] = useSearchParams(); const token = sp.get('token') ?? ''; const [state, setState] = useState<'working' | 'ok' | 'bad'>('working'); const [err, setErr] = useState(''); const ran = useRef(false);
  useEffect(() => { document.title = 'Confirm your email · Karkai AI'; if (ran.current) return; ran.current = true; if (!token) { setState('bad'); setErr('This link is incomplete.'); return; } post('/auth/verify', { token }).then(() => setState('ok')).catch(x => { setErr(msg(x)); setState('bad'); }); }, [token]);
  return <Shell title="Confirm your email">
    {state === 'working' && <p className="muted" role="status">Confirming…</p>}
    {state === 'ok' && <><div className="notice info" role="status"><Icon name="info" /><span>Thank you — your email address is confirmed.</span></div><Button to="/signin">Continue</Button></>}
    {state === 'bad' && <><div className="notice warn" role="alert"><Icon name="alert" /><span>{err}</span></div><Button to="/signin">Sign in</Button></>}
  </Shell>;
}

export function GuardianApproval() {
  const [sp] = useSearchParams(); const token = sp.get('token') ?? ''; const [info, setInfo] = useState<any>(null); const [err, setErr] = useState(''); const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [result, setResult] = useState<'approve' | 'decline' | null>(null);
  useEffect(() => { document.title = 'Parent or guardian approval · Karkai AI'; if (!token) { setErr('This link is incomplete.'); return; } post('/auth/guardian/lookup', { token }).then(d => { setInfo(d); setName(d.guardianName ?? ''); }).catch(x => setErr(msg(x))); }, [token]);
  const decide = async (decision: 'approve' | 'decline') => { if (name.trim().length < 2) return setErr('Please type your name first.'); setErr(''); setBusy(true); try { await post('/auth/guardian/decide', { token, decision, guardianName: name.trim() }); setResult(decision); } catch (x) { setErr(msg(x)); } finally { setBusy(false); } };
  return <Shell title="Parent or guardian approval">
    {result ? <div className="notice info" role="status"><Icon name="info" /><span>{result === 'approve' ? `Thank you. ${info?.studentName}’s account is approved and can be used now.` : `Understood. ${info?.studentName}’s account stays locked and nothing will be used.`}</span></div>
      : !info ? (err ? <div className="notice warn" role="alert"><Icon name="alert" /><span>{err}</span></div> : <p className="muted" role="status">Loading…</p>)
      : info.alreadyApproved ? <div className="notice info"><Icon name="info" /><span>This account has already been approved.</span></div>
      : <div className="col">
        <p><b>{info.studentName}</b>{info.classLevel ? ` (Class ${info.classLevel})` : ''} has signed up for Karkai AI, a study platform for Tamil Nadu school students. Because the child is under 13, the account cannot be used until a parent or guardian approves it.</p>
        <ul className="col" style={{ margin: 0, paddingLeft: 18 }}>
          <li>The child learns from lessons and class books, and can talk or type to an AI tutor that answers from them.</li>
          <li>The tutor’s questions are not used for advertising. You can see progress, and can ask for the account and everything saved to be deleted at any time.</li>
          <li>Read the <Link to="/privacy" className="link" target="_blank">privacy notice</Link> and <Link to="/child-safety" className="link" target="_blank">child safety</Link> pages first if you wish.</li></ul>
        <Field label="Your full name" value={name} onChange={e => setName(e.target.value)} maxLength={60} hint="Recorded with your decision." error={err} />
        <div className="row wrap"><Button onClick={() => decide('approve')} disabled={busy}>I approve</Button><Button tone="secondary" onClick={() => decide('decline')} disabled={busy}>I do not approve</Button></div>
        <p className="muted small">If you do not know this child, choose “I do not approve” or simply ignore the email.</p></div>}
  </Shell>;
}
