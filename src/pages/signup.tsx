import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Field, Icon } from '../components/ui';
import { useAuth } from '../auth';
import { msg } from '../api';

const SUBJECTS: [string, string][] = [['maths', 'Mathematics'], ['science', 'Science'], ['english', 'English'], ['social', 'Social Science'], ['tamil', 'Tamil']];
const TYPES: [string, string][] = [['student', 'Student'], ['parent', 'Parent / Guardian'], ['teacher', 'Teacher'], ['school_admin', 'School administrator']];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
type Errs = Record<string, string>;

function Chips({ label, options, value, onChange, error }: { label: string; options: [string | number, string][]; value: (string | number)[]; onChange: (v: any[]) => void; error?: string }) {
  const toggle = (k: string | number) => onChange(value.includes(k) ? value.filter(x => x !== k) : [...value, k]);
  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}><legend className="label" style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{label}</legend>
      <div className="row wrap">{options.map(([k, t]) => <button type="button" key={String(k)} className={`pill ${value.includes(k) ? 'on' : ''}`} aria-pressed={value.includes(k)} onClick={() => toggle(k)}>{t}</button>)}</div>
      {error && <div className="err" role="alert">{error}</div>}</fieldset>
  );
}
function Select({ label, value, onChange, children, error }: { label: string; value: string | number; onChange: (v: string) => void; children: React.ReactNode; error?: string }) {
  const id = label.replace(/\W+/g, '-').toLowerCase();
  return <div className="field grow"><label htmlFor={id}>{label}</label><select id={id} value={value} onChange={e => onChange(e.target.value)} aria-invalid={!!error}>{children}</select>{error && <div className="err" role="alert">{error}</div>}</div>;
}

/** The single shared registration page for every account type. Fields change with the chosen type; the server re-validates everything. */
export function SignUp() {
  const { register } = useAuth(); const nav = useNavigate();
  const [f, setF] = useState<any>({ role: '', displayName: '', email: '', password: '', confirm: '', consent: false,
    classLevel: '', medium: 'English', aiLang: 'both', academicYear: '2026–2027', subjects: [], schoolName: '', under13: false, guardianName: '', guardianEmail: '',
    relationship: '', linkCode: '', tSubjects: [], tClasses: [], code: '', institutionEmail: '' });
  const [errs, setErrs] = useState<Errs>({}); const [top, setTop] = useState(''); const [busy, setBusy] = useState(false); const [show, setShow] = useState(false);
  const set = (k: string, v: any) => { setF((x: any) => ({ ...x, [k]: v })); setErrs(e => ({ ...e, [k]: '' })); };
  const rules = [['At least 8 characters', f.password.length >= 8], ['A letter', /[A-Za-z]/.test(f.password)], ['A number', /\d/.test(f.password)]] as const;

  const validate = () => {
    const e: Errs = {};
    if (!f.displayName.trim()) e.displayName = 'Enter your full name';
    if (!EMAIL.test(f.email.trim())) e.email = 'Enter a valid email address';
    if (!rules.every(r => r[1])) e.password = 'Password does not meet the rules below';
    if (f.confirm !== f.password) e.confirm = 'Passwords do not match';
    if (!f.role) e.role = 'Choose an account type';
    if (f.role === 'student') {
      if (!f.classLevel) e.classLevel = 'Choose your class';
      if (!f.subjects.length) e.subjects = 'Choose at least one subject';
      if (f.under13) { if (f.guardianName.trim().length < 2) e.guardianName = 'Enter a parent or guardian name'; if (!EMAIL.test(f.guardianEmail.trim())) e.guardianEmail = 'Enter a valid guardian email'; }
    }
    if (f.role === 'parent' && f.linkCode && !/^[A-Za-z0-9]{6}$/.test(f.linkCode.trim())) e.linkCode = 'The code has 6 letters or numbers';
    if (f.role === 'teacher' || f.role === 'school_admin') { if (f.schoolName.trim().length < 2) e.schoolName = 'Enter the school or institution name'; }
    if (f.role === 'teacher') { if (!f.tSubjects.length) e.tSubjects = 'Choose at least one subject'; if (!f.tClasses.length) e.tClasses = 'Choose at least one class'; }
    if (f.role === 'school_admin' && !EMAIL.test(f.institutionEmail.trim())) e.institutionEmail = 'Enter your institution email';
    if (!f.consent) e.consent = 'Please accept the terms and privacy notice';
    return e;
  };
  const payload = () => {
    const b: any = { displayName: f.displayName.trim(), email: f.email.trim(), password: f.password, role: f.role, consent: f.consent };
    if (f.role === 'student') { Object.assign(b, { under13: f.under13, student: { classLevel: Number(f.classLevel), medium: f.medium, aiLang: f.aiLang, academicYear: f.academicYear.replace('-', '–'), subjects: f.subjects, schoolName: f.schoolName.trim() || undefined } });
      if (f.under13) Object.assign(b, { guardianName: f.guardianName.trim(), guardianEmail: f.guardianEmail.trim() }); }
    if (f.role === 'parent') b.parent = { relationship: f.relationship || undefined, linkCode: f.linkCode.trim() || undefined };
    if (f.role === 'teacher' || f.role === 'school_admin') b.staff = { schoolName: f.schoolName.trim(), subjects: f.tSubjects, classes: f.tClasses, code: f.code.trim() || undefined, institutionEmail: f.institutionEmail.trim() || undefined };
    return b;
  };
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault(); setTop(''); const e = validate(); setErrs(e);
    if (Object.keys(e).length) { setTop('Please fix the highlighted fields.'); setTimeout(() => document.querySelector<HTMLElement>('[aria-invalid="true"], .err')?.scrollIntoView({ block: 'center' }), 0); return; }
    setBusy(true);
    try { await register(payload()); nav('/app', { replace: true }); } catch (x) { setTop(msg(x)); } finally { setBusy(false); }
  };

  return (
    <div className="authwrap"><Card className="authcard" >
      <h1>Create your account</h1>
      <p className="muted">One sign-up for everyone. Choose your account type to see the details we need.</p>
      <form className="col" onSubmit={submit} noValidate>
        <Field label="Full name" value={f.displayName} onChange={e => set('displayName', e.target.value)} autoComplete="name" maxLength={60} error={errs.displayName} required />
        <Field label="Email address" type="email" value={f.email} onChange={e => set('email', e.target.value)} autoComplete="email" error={errs.email} required />
        <div className="field"><label htmlFor="su-pw">Password</label><div className="row" style={{ gap: 8 }}><input id="su-pw" type={show ? 'text' : 'password'} value={f.password} onChange={e => set('password', e.target.value)} autoComplete="new-password" aria-invalid={!!errs.password} style={{ flex: 1 }} /><button type="button" className="btn secondary" onClick={() => setShow(s => !s)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button></div>
          <ul className="rules">{rules.map(([t, v]) => <li key={t} className={v ? 'ok' : ''}>{v ? '✓' : '○'} {t}</li>)}</ul>{errs.password && <div className="err" role="alert">{errs.password}</div>}</div>
        <Field label="Confirm password" type={show ? 'text' : 'password'} value={f.confirm} onChange={e => set('confirm', e.target.value)} autoComplete="new-password" error={errs.confirm} required />
        <Select label="Account type" value={f.role} onChange={v => { set('role', v); setErrs({}); }} error={errs.role}><option value="">Select…</option>{TYPES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</Select>

        {f.role === 'student' && <section className="col subform" aria-label="Student details">
          <h2 className="h3">Student details</h2>
          <div className="row wrap"><Select label="Class" value={f.classLevel} onChange={v => set('classLevel', v)} error={errs.classLevel}><option value="">Select…</option>{Array.from({ length: 12 }, (_, i) => i + 1).map(n => <option key={n} value={n}>Class {n}</option>)}</Select>
            <Select label="Medium" value={f.medium} onChange={v => set('medium', v)}><option>English</option><option>Tamil</option></Select></div>
          <div className="row wrap"><Field label="Board" value="Tamil Nadu State Board (Samacheer Kalvi)" readOnly /><Select label="AI explanation language" value={f.aiLang} onChange={v => set('aiLang', v)}><option value="both">Tamil + English</option><option value="ta">Tamil</option><option value="en">English</option></Select></div>
          <Field label="Academic year" value={f.academicYear} onChange={e => set('academicYear', e.target.value)} hint="For example 2026–2027" />
          <Chips label="Subjects" options={SUBJECTS} value={f.subjects} onChange={v => set('subjects', v)} error={errs.subjects} />
          <Field label="School name (optional)" value={f.schoolName} onChange={e => set('schoolName', e.target.value)} maxLength={120} />
          <label className="check"><input type="checkbox" checked={f.under13} onChange={e => set('under13', e.target.checked)} /> I am under 13. A parent or guardian must approve my account.</label>
          {f.under13 && <div className="col"><div className="notice info"><Icon name="shield" /><div>Until a guardian approves, the AI tutor stays locked. This version does not send emails, so approval happens when the guardian links with the code from the student’s account.</div></div>
            <Field label="Parent or guardian name" value={f.guardianName} onChange={e => set('guardianName', e.target.value)} error={errs.guardianName} maxLength={60} /><Field label="Parent or guardian email" type="email" value={f.guardianEmail} onChange={e => set('guardianEmail', e.target.value)} error={errs.guardianEmail} /></div>}
        </section>}

        {f.role === 'parent' && <section className="col subform" aria-label="Parent or guardian details">
          <h2 className="h3">Parent / guardian details</h2>
          <Select label="Relationship to the student (optional)" value={f.relationship} onChange={v => set('relationship', v)}><option value="">Prefer not to say</option><option value="mother">Mother</option><option value="father">Father</option><option value="guardian">Legal guardian</option><option value="other">Other</option></Select>
          <Field label="Student link code (optional)" value={f.linkCode} onChange={e => set('linkCode', e.target.value.toUpperCase())} maxLength={6} error={errs.linkCode} hint="The student creates this 6-character code in their account. You can leave it blank and link later." />
        </section>}

        {(f.role === 'teacher' || f.role === 'school_admin') && <section className="col subform" aria-label={f.role === 'teacher' ? 'Teacher details' : 'School administrator details'}>
          <h2 className="h3">{f.role === 'teacher' ? 'Teacher details' : 'School administrator details'}</h2>
          <div className="notice info"><Icon name="shield" /><div>Staff accounts must be approved by a platform administrator before they get any staff access. Until then your account has no staff permissions.</div></div>
          <Field label="School or institution name" value={f.schoolName} onChange={e => set('schoolName', e.target.value)} error={errs.schoolName} maxLength={120} />
          {f.role === 'teacher' && <><Chips label="Subjects you teach" options={SUBJECTS} value={f.tSubjects} onChange={v => set('tSubjects', v)} error={errs.tSubjects} />
            <Chips label="Classes you teach" options={Array.from({ length: 12 }, (_, i) => [i + 1, String(i + 1)] as [number, string])} value={f.tClasses} onChange={v => set('tClasses', v)} error={errs.tClasses} /></>}
          {f.role === 'school_admin' && <Field label="Institution email" type="email" value={f.institutionEmail} onChange={e => set('institutionEmail', e.target.value)} error={errs.institutionEmail} hint="Use an email on your school’s own domain." />}
          <Field label="School invitation or verification code (optional)" value={f.code} onChange={e => set('code', e.target.value)} maxLength={40} hint="If your school gave you one. It is recorded for the approver; it does not grant access by itself." />
        </section>}

        <div><label className="check"><input type="checkbox" checked={f.consent} onChange={e => set('consent', e.target.checked)} aria-invalid={!!errs.consent} /> <span>I agree to the <Link to="/terms" className="link" target="_blank">Terms</Link> and <Link to="/privacy" className="link" target="_blank">Privacy notice</Link>.</span></label>{errs.consent && <div className="err" role="alert">{errs.consent}</div>}</div>
        {top && <div className="notice err" role="alert"><Icon name="alert" />{top}</div>}
        <Button type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</Button>
        <p className="small muted center">Email verification is not available in this version.</p>
      </form>
      <p className="small muted center">Already registered? <Link to="/signin" className="link">Sign in</Link></p>
    </Card></div>
  );
}
