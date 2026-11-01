import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Field, Icon, Modal, Badge, PageTitle, Async, useLoad } from '../components/ui';
import { useAuth } from '../auth';
import { get, put, post, del, msg } from '../api';
import { useToast } from '../components/toast';
import { PublicLayout } from './public';

const SUBJECTS: [string, string][] = [['maths', 'Mathematics'], ['science', 'Science'], ['english', 'English'], ['social', 'Social Science'], ['tamil', 'Tamil']];
const GOALS: [string, string][] = [['understand', 'Understand lessons better'], ['homework', 'Get help with homework'], ['exams', 'Prepare for exams'], ['marks', 'Improve my marks'], ['practise', 'Practise regularly']];
const YEARS = ['2025–2026', '2026–2027', '2027–2028'];

export function ProfileForm({ mode }: { mode: 'onboard' | 'edit' }) {
  const { profile, refresh } = useAuth(); const nav = useNavigate(); const toast = useToast();
  const p = profile;
  const [f, setF] = useState<any>({ fullName: p?.full_name ?? '', fullNameTa: p?.full_name_ta ?? '', preferredName: p?.preferred_name ?? '', classLevel: p?.class_level ?? 8, medium: p?.medium ?? 'English', aiLang: p?.ai_lang ?? 'both', academicYear: p?.academic_year ?? '2026–2027', schoolName: p?.school_name ?? '', schoolRef: p?.school_ref ?? '', subjects: p?.subjects ?? ['maths', 'science', 'english', 'social', 'tamil'], goals: p?.goals ?? [], voicePrefs: p?.voice_prefs ?? { readAloud: false, rate: 1 } });
  const [err, setErr] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState(false);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const toggle = (k: string, v: string) => set(k, f[k].includes(v) ? f[k].filter((x: string) => x !== v) : [...f[k], v]);
  const managed = !!p?.school_managed;
  const validate = () => { const e: Record<string, string> = {}; if (f.fullName.trim().length < 2) e.fullName = 'Enter the student’s full name'; if (!f.subjects.length) e.subjects = 'Choose at least one subject'; setErr(e); return !Object.keys(e).length; };
  const save = async (confirmChange = false) => {
    if (!validate()) return; setBusy(true);
    try { await put('/profile', { ...f, classLevel: Number(f.classLevel), confirmChange }); await refresh(); toast(mode === 'onboard' ? 'Profile saved. Welcome!' : 'Settings saved.'); if (mode === 'onboard') nav('/app', { replace: true }); setConfirm(false); }
    catch (x: any) { if (x.status === 409 && /confirm/i.test(x.message)) setConfirm(true); else toast(msg(x), 'err'); } finally { setBusy(false); }
  };
  return (
    <form className="col" onSubmit={e => { e.preventDefault(); save(); }} noValidate>
      <Card className="col">
        <h2>About the student</h2>
        <div className="grid g2">
          <Field label="Full name" value={f.fullName} onChange={e => set('fullName', e.target.value)} error={err.fullName} required maxLength={80} />
          <Field label="Name in Tamil (optional)" value={f.fullNameTa} onChange={e => set('fullNameTa', e.target.value)} lang="ta" hint="Shown on certificates if provided" maxLength={80} />
          <Field label="Preferred name (optional)" value={f.preferredName} onChange={e => set('preferredName', e.target.value)} maxLength={40} />
          <Field label="School name (optional)" value={f.schoolName} onChange={e => set('schoolName', e.target.value)} maxLength={120} />
        </div>
      </Card>
      <Card className="col">
        <h2>Class and language</h2>
        {managed && <div className="notice info"><Icon name="info" />Your class and academic year are managed by your school.</div>}
        <div className="grid g2">
          <div className="field"><label htmlFor="cls">Class</label><select id="cls" value={f.classLevel} disabled={managed} onChange={e => set('classLevel', Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => i + 1).map(c => <option key={c} value={c}>Class {c}</option>)}</select></div>
          <div className="field"><label htmlFor="yr">Academic year</label><select id="yr" value={f.academicYear} disabled={managed} onChange={e => set('academicYear', e.target.value)}>{YEARS.map(y => <option key={y}>{y}</option>)}</select></div>
          <div className="field"><label htmlFor="med">Medium of instruction</label><select id="med" value={f.medium} onChange={e => set('medium', e.target.value)}><option value="Tamil">Tamil medium</option><option value="English">English medium</option></select></div>
          <div className="field"><label htmlFor="ail">AI answer language</label><select id="ail" value={f.aiLang} onChange={e => set('aiLang', e.target.value)}><option value="ta">தமிழ் (Tamil)</option><option value="en">English</option><option value="both">Tamil + English</option></select></div>
        </div>
        <p className="muted small">Board: Tamil Nadu State Board (Samacheer Kalvi)</p>
      </Card>
      <Card className="col">
        <h2>Subjects</h2>
        <div className="row wrap" role="group" aria-label="Subjects">{SUBJECTS.map(([k, t]) => <button type="button" key={k} aria-pressed={f.subjects.includes(k)} className={`pill ${f.subjects.includes(k) ? 'on' : ''}`} onClick={() => toggle('subjects', k)}>{f.subjects.includes(k) && '✓ '}{t}</button>)}</div>
        {err.subjects && <div className="err" role="alert">{err.subjects}</div>}
        <h2 style={{ marginTop: 8 }}>Learning goals</h2>
        <div className="row wrap" role="group" aria-label="Goals">{GOALS.map(([k, t]) => <button type="button" key={k} aria-pressed={f.goals.includes(k)} className={`pill ${f.goals.includes(k) ? 'on' : ''}`} onClick={() => toggle('goals', k)}>{f.goals.includes(k) && '✓ '}{t}</button>)}</div>
      </Card>
      <Card className="col">
        <h2>Voice</h2>
        <label className="check"><input type="checkbox" checked={f.voicePrefs.readAloud} onChange={e => set('voicePrefs', { ...f.voicePrefs, readAloud: e.target.checked })} /> Show read-aloud controls (uses your device’s voice; availability depends on your browser)</label>
        <div className="field"><label htmlFor="rate">Reading speed: {f.voicePrefs.rate}×</label><input id="rate" type="range" min="0.5" max="1.5" step="0.1" value={f.voicePrefs.rate} onChange={e => set('voicePrefs', { ...f.voicePrefs, rate: Number(e.target.value) })} /></div>
      </Card>
      <div className="row wrap"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : mode === 'onboard' ? 'Save and continue' : 'Save changes'}</Button></div>
      {confirm && <Modal title="Change class?" onClose={() => setConfirm(false)}><p>Changing your class updates your lessons and tests. Your past test results keep their original class.</p><div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}><Button tone="secondary" onClick={() => setConfirm(false)}>Cancel</Button><Button onClick={() => save(true)}>Yes, change class</Button></div></Modal>}
    </form>
  );
}

export function ProfilePage() {
  const { profile } = useAuth();
  return <PublicLayout><div className="doc col"><h1>Complete your student profile</h1><p className="muted">We only ask for what we need to personalise lessons. You can change this later in Settings.</p>
    <div className="notice info"><Icon name="info" />{profile ? '' : 'Your answers are private to you, your parent/guardian, and your teacher if your school uses Karkai AI.'}</div><ProfileForm mode="onboard" /></div></PublicLayout>;
}

export function Settings() {
  const { logout, user, emailVerified } = useAuth(); const nav = useNavigate(); const toast = useToast(); const [mailOn, setMailOn] = useState(false);
  useEffect(() => { get('/auth/config').then(c => setMailOn(!!c.email?.enabled)).catch(() => {}); }, []);
  const s = useLoad(() => get('/profile'));
  const [code, setCode] = useState(''); const [del1, setDel1] = useState(false); const [typed, setTyped] = useState('');
  return (
    <div className="col">
      <PageTitle title="Settings" sub="Your profile, privacy and account." />
      <ProfileForm mode="edit" />
      {mailOn && !emailVerified && <div className="notice warn"><Icon name="info" /><span>Your email address is not confirmed yet.</span><Button tone="secondary" onClick={async () => { try { await post('/auth/send-verification'); toast('Confirmation link sent. Check your email.', 'ok'); } catch (e) { toast(msg(e), 'err'); } }}>Send confirmation link</Button></div>}
      <Card className="col"><h2>Parent / guardian</h2>
        <Async s={s}>{d => <>
          {d.under13 && !d.profile?.guardian_approved && <div className="notice warn"><Icon name="alert" />Your account needs a parent or guardian’s approval before you can use the AI tutor and uploads.</div>}
          {d.profile?.guardian_approved ? <p><Badge tone="success">Guardian linked</Badge></p> : null}
          {mailOn && d.under13 && !d.profile?.guardian_approved && <div className="row wrap"><Button tone="secondary" onClick={async () => { try { await post('/auth/guardian/resend'); toast('We emailed your guardian again.', 'ok'); } catch (e) { toast(msg(e), 'err'); } }}>Email my guardian again</Button></div>}
          <p className="muted">Create a code and give it to your parent or guardian. They enter it in their Karkai AI account to see your progress{d.under13 ? ' and approve your account' : ''}. Codes expire after 7 days.</p>
          <div className="row wrap"><Button tone="secondary" onClick={async () => { try { setCode((await post('/profile/guardian-code')).code); } catch (e) { toast(msg(e), 'err'); } }}>Create guardian code</Button>{code && <span className="codebox" aria-live="polite">{code}</span>}</div></>}</Async>
      </Card>
      <Card className="col"><h2>Privacy and data</h2><p className="muted">Your uploads are private and never used to train AI models. Deleting your account permanently removes your profile, tests, certificates, chats and files.</p>
        <div className="row"><Button tone="danger" onClick={() => setDel1(true)}>Delete my account and data</Button></div></Card>
      {del1 && <Modal title="Delete your account?" onClose={() => setDel1(false)}><p>This cannot be undone. Type <b>DELETE</b> to confirm.</p><input aria-label="Type DELETE" value={typed} onChange={e => setTyped(e.target.value)} style={{ width: '100%', padding: 10, margin: '12px 0' }} />
        <div className="row" style={{ justifyContent: 'flex-end' }}><Button tone="secondary" onClick={() => setDel1(false)}>Cancel</Button><Button tone="danger" disabled={typed !== 'DELETE'} onClick={async () => { try { await del('/profile'); await logout().catch(() => {}); toast('Your account has been deleted.'); nav('/'); } catch (e) { toast(msg(e), 'err'); } }}>Delete everything</Button></div></Modal>}
      <p className="muted small">Signed in as {user?.email}</p>
    </div>
  );
}
