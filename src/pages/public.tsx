import { ReactNode, useEffect, useRef, useState } from 'react';
import { BRAND } from '../../shared/brand';
import { BrandMark, BrandName } from '../components/Brand';
import { Link, NavLink, Navigate, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Icon, Button, Card, Badge } from '../components/ui';
import { Bi, LangToggle } from '../components/lang';
import { useAuth, homeFor } from '../auth';
import { msg } from '../api';
import { safeNext } from '../lib/safeNext';

export function PublicLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth(); const [open, setOpen] = useState(false); const loc = useLocation();
  const links: [string, string][] = [['/features', 'Features'], ['/how-it-works', 'How it works'], ['/verify', 'Verify certificate'], ['/help', 'Help']];
  return (
    <div className="pub">
      <a className="skip" href="#main">Skip to content</a>
      <header className="pubhead">
        <Link to="/" className="logo" aria-label={`${BRAND.appName} home`}><BrandMark size={40} /><span><BrandName size={17} /></span></Link>
        <nav className="pubnav" aria-label="Site">{links.map(([to, t]) => <NavLink key={to} to={to}>{t}</NavLink>)}</nav>
        <div className="grow" /><LangToggle />
        {user ? <Button to={homeFor(user.role)} className="hide-sm">Open app</Button> : <><Button tone="secondary" to="/signin" className="hide-sm">Sign in</Button><Button to="/signup" className="hide-sm">Create account</Button></>}
        <button className="btn secondary iconbtn menubtn" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(o => !o)}><Icon name={open ? 'x' : 'menu'} /></button>
      </header>
      {open && <div className="pubdrawer" key={loc.pathname}>{links.map(([to, t]) => <Link key={to} to={to} onClick={() => setOpen(false)}>{t}</Link>)}{!user ? <><Link to="/signin" onClick={() => setOpen(false)}>Sign in</Link><Link to="/signup" onClick={() => setOpen(false)}>Create account</Link></> : <Link to={homeFor(user.role)} onClick={() => setOpen(false)}>Open app</Link>}</div>}
      <main id="main" tabIndex={-1} className="pubmain">{children}</main>
      <footer className="pubfoot">
        <div><BrandMark size={56} /><br /><b><Bi en={BRAND.appName} ta={BRAND.appNameTamil} /></b><p className="muted small"><Bi en={BRAND.productDescription} ta={BRAND.productDescriptionTamil} /> · <Bi en={BRAND.taglineEnglish} ta={BRAND.tagline} /></p><p className="muted small">An independent study companion for Tamil Nadu State Board (Samacheer Kalvi) students, Classes 1–12. Not affiliated with, or endorsed by, the Government of Tamil Nadu or the Tamil Nadu State Board.</p></div>
        <div className="footlinks"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><Link to="/child-safety">Child safety</Link><Link to="/help">Help</Link><Link to="/verify">Verify certificate</Link></div>
      </footer>
    </div>
  );
}

const FEATURES: [any, string, string, string][] = [
  ['chat', 'AI tutor', 'Ask in Tamil, English or both. Get simple explanations, step-by-step help, hints and a quick check of your understanding. Answers say when they come from your lesson.', '/features'],
  ['layers', 'Mind maps', 'See each lesson as a map you can zoom, move and expand. Switch between Simple, Detailed and Quick revision, and mark what you understand.', '/features'],
  ['target', 'Practice', 'Short practice sets with hints and explanations. Answers are checked by the server, not in your browser.', '/features'],
  ['test', 'Weekly tests', 'Timed tests with autosave. Your score is worked out by the server and saved, and written answers wait for a teacher.', '/features'],
  ['chart', 'Progress and revision', 'Results, subject averages and topics to revise, all taken from the work you have actually done. Nothing is estimated.', '/features'],
  ['upload', 'Your own material', 'Add a PDF, a web page or typed text and ask questions about it. Reading text from photos is not available yet.', '/features'],
];
export function Landing() {
  const { user } = useAuth(); const cta = user ? homeFor(user.role) : '/signup';
  return (
    <div className="col" style={{ gap: 56 }}>
      <section className="hero" aria-labelledby="hero-h">
        <div className="col" style={{ gap: 16 }}>
          <img src="/logo.png" width={280} height={272} style={{ width: 'min(280px, 70%)', height: 'auto' }} alt={`${BRAND.appName} — ${BRAND.productDescription}`} />
          <Badge tone="info">Tamil Nadu State Board · Classes 1–12</Badge>
          <h1 id="hero-h" className="herotitle"><Bi en="Understand your Samacheer Kalvi lessons in Tamil, English, or both" ta="உங்கள் சமச்சீர்க் கல்விப் பாடங்களைத் தமிழ், ஆங்கிலம் அல்லது இரண்டிலும் புரிந்துகொள்ளுங்கள்" block /></h1>
          <p className="muted" style={{ fontSize: 16 }}><Bi en="A study companion with lessons shown as mind maps, a patient AI tutor, practice questions, weekly tests and progress you can see." ta="மனவரைபடங்களாகப் பாடங்கள், பொறுமையான AI ஆசிரியர், பயிற்சி, வாராந்திரத் தேர்வுகள், உங்கள் முன்னேற்றம் — அனைத்தும் ஓரிடத்தில்." block /></p>
          <div className="row wrap"><Button to={cta}>{user ? 'Open my app' : 'Create a free account'}</Button>{!user && <Button tone="secondary" to="/signin">Sign in</Button>}<Link to="/how-it-works" className="link">See how it works</Link></div>
          <p className="muted"><Bi en={BRAND.taglineEnglish} ta={BRAND.tagline} block /></p>
          <p className="muted small">Students, parents and teachers use the same sign-up. Children under 13 need a parent or guardian to approve their account.</p>
        </div>
        <Card className="heroside" aria-label="A study session"><h2 style={{ fontSize: 18 }}>A study session</h2>
          {['Open a lesson in Tamil or English', 'See it as a mind map and mark what you know', 'Ask Karkai AI to explain what is unclear', 'Practise, then take the weekly test', 'Check your progress and revise weak topics'].map((t, i) => <div className="row" key={t}><span className="avatar" aria-hidden>{i + 1}</span><span className="semi">{t}</span></div>)}</Card>
      </section>

      <section aria-labelledby="feat-h" className="col">
        <div className="col" style={{ gap: 4 }}><h2 id="feat-h">Everything for a study session, in one place</h2><p className="muted">Each tool below works inside the learning app after you sign in.</p></div>
        <div className="grid g3">{FEATURES.map(([i, t, d]) => <Card key={t}><div className="col"><span className="iconbox" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}><Icon name={i} size={22} /></span><h3>{t}</h3><p className="muted">{d}</p></div></Card>)}</div>
      </section>

      <section aria-labelledby="trust-h" className="col">
        <div className="col" style={{ gap: 4 }}><h2 id="trust-h">What to know before you start</h2><p className="muted">We would rather be clear than impressive.</p></div>
        <div className="grid g2">
          <Card className="col"><h3>Independent study aid</h3><p className="muted">Karkai AI is not run by, endorsed by or affiliated with the Government of Tamil Nadu or the State Board. Certificates recognise results in this platform’s own tests.</p></Card>
          <Card className="col"><h3>Content is still growing</h3><p className="muted">Most lessons are sample content written for this prototype. Class 8 English also has short excerpts from the official textbook, labelled with their source. Always check important answers with your textbook or teacher.</p></Card>
          <Card className="col"><h3>AI can be wrong</h3><p className="muted">The tutor is told to answer from your lesson and to say when it cannot. Every answer can be reported, and a rule-based tutor is used until an AI provider is configured.</p></Card>
          <Card className="col"><h3>Children’s privacy</h3><p className="muted">No advertising and no selling of data. Parents can see their child’s progress. Read the <Link to="/privacy" className="link">privacy notice</Link> and <Link to="/child-safety" className="link">child safety</Link> page.</p></Card>
        </div>
      </section>

      <section className="ctaband" aria-labelledby="cta-h"><div className="col" style={{ gap: 4 }}><h2 id="cta-h">Ready to try a lesson?</h2><p className="muted">Create an account in a minute, choose your class and medium, and start with a mind map.</p></div>
        <div className="row wrap"><Button to={cta}>{user ? 'Open my app' : 'Create a free account'}</Button>{!user && <Button tone="secondary" to="/signin">Sign in</Button>}</div></section>
    </div>
  );
}

export function Features() {
  const f: [any, string, string][] = [
    ['layers', 'Bilingual lessons', 'Every lesson can be shown in Tamil, English or side by side, with key words, worked examples and common mistakes. Textbook excerpts show their source.'],
    ['chat', 'Karkai AI tutor', 'Choose Tamil, English or both. Ask in plain words, or use the buttons: explain simply, step by step, another example, give a hint, test my understanding. Replies from your lesson say so and name the source.'],
    ['layers', 'Mind maps on every lesson', 'A real, interactive map: zoom, drag, fit to screen, open and close branches, search, and tap a box for a fuller explanation. Simple, Detailed and Quick revision modes. Mark concepts as understood or for revision, and download or print the map.'],
    ['target', 'Practice centre', 'Choose a subject and a few questions. Get hints and explanations, and review your mistakes. Scoring happens on the server.'],
    ['test', 'Weekly tests', 'Instructions first, then a timer, autosave and safe recovery if your page refreshes. Marks are calculated and stored by the server. Written answers are marked by a teacher.'],
    ['chart', 'Progress and revision', 'See tests taken, average scores, subject results and topics to revise. These come only from your saved work.'],
    ['upload', 'Learn from your own material', 'Upload a PDF, add a web page or paste text, then ask questions that are answered from it with page references. Photos need text-reading (OCR), which is not set up yet.'],
    ['award', 'Verifiable certificates', 'Pass a weekly test to earn a PDF certificate with a code anyone can check. The check page shows only a first name and initial.'],
  ];
  return <div className="col"><h1>Features</h1><p className="muted">What works today inside the learning app.</p><div className="grid g2">{f.map(([i, t, d]) => <Card key={t}><div className="row" style={{ alignItems: 'flex-start' }}><span className="iconbox" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}><Icon name={i} size={22} /></span><div><h2 style={{ fontSize: 18 }}>{t}</h2><p className="muted">{d}</p></div></div></Card>)}</div>
    <div className="row wrap"><Button to="/signup">Create account</Button><Button tone="secondary" to="/how-it-works">How it works</Button></div></div>;
}
export function HowItWorks() {
  const s = [['Create an account', 'Pick Student, Parent / Guardian or Teacher on the one sign-up page. Younger children need a parent or guardian to approve. School and platform administrators are added by invitation.'], ['Complete your profile', 'Choose your class, medium, subjects and the language you want explanations in.'], ['Learn', 'Open a lesson and switch between Explanation, Mind Map, Examples, Practice questions and Quick revision.'], ['Ask Karkai AI', 'Select any part of a mind map or ask a question. Tutor answers say when they come from your lesson.'], ['Practise', 'Do short practice sets and read the explanations straight away.'], ['Take the weekly test', 'Timed, autosaved and scored by the server. Pass to earn a certificate you can share and verify.'], ['Check your progress', 'See results and topics to revise, then go back to a lesson or practise those topics.']];
  return <div className="col"><h1>How it works</h1><ol className="col" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{s.map(([t, d], i) => <li key={t}><Card><div className="row"><span className="avatar" aria-hidden>{i + 1}</span><div><h2 style={{ fontSize: 18 }}>{t}</h2><p className="muted">{d}</p></div></div></Card></li>)}</ol><div className="row wrap"><Button to="/signup">Create account</Button></div></div>;
}
const Doc = ({ title, children }: { title: string; children: ReactNode }) => <div className="doc col"><h1>{title}</h1><div className="notice" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}><Icon name="info" /><span>Draft text for a prototype. It describes how this software currently behaves and must be reviewed by the school/operator and legal counsel before real use.</span></div>{children}</div>;
export const Privacy = () => <Doc title="Privacy notice"><Card className="prose">
  <h3>What we collect</h3><p>Name, email, class, medium, chosen subjects, school (optional), your test attempts and results, tutor chats, and files or links you add. We do not collect phone numbers, home addresses or photos of the student.</p>
  <h3>Why</h3><p>To personalise lessons, grade tests, issue certificates and show progress to you and your linked parent or teacher.</p>
  <h3>Your uploads</h3><p>Photos, PDFs and links are stored privately and visible only to you. They are not used to train AI models.</p>
  <h3>AI providers</h3><p>When an external AI provider is configured, your question and the relevant lesson or material text are sent to it to produce an answer. If none is configured, a built-in rule-based tutor answers instead and sends nothing outside this service.</p>
  <h3>Certificates</h3><p>The public verification page shows only a first name and initial, the achievement, date and status.</p>
  <h3>Your choices</h3><p>You can delete your account and data from Settings. Parents can approve or withdraw approval for children under 13.</p></Card></Doc>;
export const Terms = () => <Doc title="Terms of use"><Card className="prose"><p>Karkai AI is a study aid. It is not a replacement for teachers or textbooks. AI answers can be wrong — check important answers with your textbook or teacher.</p><p>Certificates issued here recognise achievement in this platform’s weekly tests. They are not official Tamil Nadu State Board certificates.</p><p>Do not share your password. Do not upload other people’s private information. We may suspend accounts that misuse the service.</p></Card></Doc>;
export const ChildSafety = () => <Doc title="Child safety"><Card className="prose"><ul><li>Children under 13 need a parent or guardian to approve their account before using the AI tutor or uploads.</li><li>No advertising and no selling of data.</li><li>Tutor replies are limited to study help; you can report any reply with the flag button.</li><li>Parents can see their child’s progress and results, but not other families’ data.</li><li>If you ever feel unsafe or upset, talk to a trusted adult. In India you can call Childline on 1098.</li></ul></Card></Doc>;
export function Help() {
  const faq: [string, string][] = [['I forgot my password', 'Use the Forgot password page: if this service has email set up it sends you a reset link; if not, it lists who can help.'], ['Why can’t I start a test?', 'A test can be started only between its opening and closing times, and only while you have attempts left.'], ['Why is my result “pending review”?', 'Written answers are marked by your teacher. Your result is final once they finish.'], ['Is the tutor a real AI?', 'It depends on how this service is configured. The tutor’s label tells you which one is answering.'], ['How do I verify a certificate?', 'Open Verify certificate and paste the reference number or scan the QR code.']];
  return <div className="col"><h1>Help</h1>{faq.map(([q, a]) => <Card key={q}><h3>{q}</h3><p className="muted">{a}</p></Card>)}</div>;
}
export function NotFound() { return <div className="state"><h1>Page not found</h1><p>The page you are looking for does not exist.</p><Button to="/">Go home</Button></div>; }

export function SignIn() {
  const { user, login, config } = useAuth(); const nav = useNavigate(); const loc = useLocation(); const [sp] = useSearchParams();
  const [ident, setIdent] = useState(''); const [password, setPassword] = useState(''); const [show, setShow] = useState(false); const [err, setErr] = useState(''); const [fe, setFe] = useState<{ ident?: string; password?: string }>({}); const [busy, setBusy] = useState(false);
  const next = safeNext(sp.get('next')) ?? safeNext((loc.state as any)?.from) ?? null;
  const idRef = useRef<HTMLInputElement>(null); const pwRef = useRef<HTMLInputElement>(null);
  useEffect(() => { document.title = 'Sign in · Karkai AI'; idRef.current?.focus(); }, []);
  if (user) return <Navigate to={next ?? homeFor(user.role)} replace />;
  const go = async (e: string, p: string) => {
    setErr(''); setBusy(true);
    try { const u = await login(e.trim(), p); nav(next ?? homeFor(u.role), { replace: true }); }
    catch (x) { const m = msg(x); setErr(/Failed to fetch|NetworkError|Request failed/i.test(m) ? 'We could not reach the server. Check your internet connection and try again.' : m); setPassword(''); pwRef.current?.focus(); }
    finally { setBusy(false); }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); const f: typeof fe = {};
    if (!ident.trim()) f.ident = 'Enter your email or username.'; if (!password) f.password = 'Enter your password.';
    setFe(f); if (f.ident) { idRef.current?.focus(); return; } if (f.password) { pwRef.current?.focus(); return; }
    go(ident, password);
  };
  return (
    <div className="authwrap"><Card className="authcard">
      <h1>Sign in</h1><p className="muted">Welcome back. <Bi en="" ta="மீண்டும் வருக" /></p>
      <form className="col" onSubmit={submit} noValidate aria-describedby={err ? 'si-err' : undefined}>
        {err && <div className="notice err" role="alert" id="si-err"><Icon name="alert" /><span>{err}</span></div>}
        <div className="field"><label htmlFor="si-id">Email or username</label>
          <input id="si-id" ref={idRef} type="text" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} value={ident} onChange={e => { setIdent(e.target.value); setFe(f => ({ ...f, ident: undefined })); }} aria-invalid={!!fe.ident} aria-describedby={fe.ident ? 'si-id-e' : undefined} />
          {fe.ident && <span className="fielderr" id="si-id-e" role="alert">{fe.ident}</span>}</div>
        <div className="field"><label htmlFor="si-pw">Password</label>
          <div className="row" style={{ gap: 8 }}><input id="si-pw" ref={pwRef} type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => { setPassword(e.target.value); setFe(f => ({ ...f, password: undefined })); }} aria-invalid={!!fe.password} aria-describedby={fe.password ? 'si-pw-e' : undefined} style={{ flex: 1 }} />
            <button type="button" className="btn secondary" onClick={() => setShow(v => !v)} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button></div>
          {fe.password && <span className="fielderr" id="si-pw-e" role="alert">{fe.password}</span>}</div>
        <div className="row wrap" style={{ justifyContent: 'space-between' }}><Link to="/forgot-password" className="link small">Forgot your password?</Link></div>
        <Button type="submit" disabled={busy} aria-busy={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>
      <p className="small muted center">New to Karkai AI? <Link to="/signup" className="link">Create an account</Link><br />Students, parents and teachers use the same sign-up. Administrators are added by invitation only.</p>
      {config.demoAccounts && <div className="demobox"><div className="row"><Badge tone="warning">{config.preview ? 'UI preview' : 'Development only'}</Badge><span className="small muted">{config.preview ? <>No backend: sample data only. Username <code>vikikalvi</code>, password <code>demo@12345</code>.</> : <>Demo account (password <code>demo@12345</code>). Hidden in production.</>}</span></div>
        <div className="row wrap"><button type="button" className="pill" disabled={busy} onClick={() => { setIdent('vikikalvi'); go('vikikalvi', 'demo@12345'); }}>Use demo login</button></div></div>}
    </Card></div>
  );
}

