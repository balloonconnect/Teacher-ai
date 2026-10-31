import { ReactNode, useEffect, useRef, useState } from 'react';
import { BRAND } from '../../shared/brand';
import { BrandMark, BrandName } from './Brand';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { Icon, Badge, fmtDT } from './ui';
import { Bi, LangToggle, useLang } from './lang';
import { useAuth, Role } from '../auth';
import { get, post } from '../api';

export type NavItem = { to: string; en: string; ta: string; icon: Parameters<typeof Icon>[0]['name']; end?: boolean; short?: string };
const SHORT: Record<string, string> = { '/teacher': 'Overview', '/teacher/books': 'Books', '/app': 'Home', '/app/tutor': 'Tutor', '/app/voice': 'Voice', '/app/material': 'Material', '/app/tests': 'Tests', '/parent': 'Children', '/teacher/classes': 'Classes', '/teacher/questions': 'Questions', '/teacher/tests': 'Tests', '/teacher/reviews': 'Marking', '/school/people': 'People', '/admin/users': 'Users', '/admin/people': 'People', '/admin/schools': 'Schools' };
const T = (to: string, en: string, ta: string, icon: NavItem['icon'], end = false): NavItem => ({ to, en, ta, icon, end, short: SHORT[to] });
export const NAV: Record<Role, NavItem[]> = {
  student: [T('/app', 'Dashboard', 'முகப்பு', 'home', true), T('/app/learn', 'Learn', 'பாடங்கள்', 'layers'), T('/app/tutor', 'AI Tutor', 'AI ஆசிரியர்', 'chat'), T('/app/voice', 'Voice Tutor', 'குரல் ஆசிரியர்', 'mic'),
    T('/app/practice', 'Practice', 'பயிற்சி', 'target'), T('/app/tests', 'Weekly Tests', 'வாராந்திரத் தேர்வுகள்', 'test'), T('/app/progress', 'Progress', 'முன்னேற்றம்', 'chart'), T('/app/certificates', 'Certificates', 'சான்றிதழ்கள்', 'award'), T('/app/bookmarks', 'Bookmarks', 'புத்தகக்குறி', 'bookmark'), T('/app/settings', 'Settings', 'அமைப்புகள்', 'settings')],
  parent: [T('/parent', 'My children', 'என் குழந்தைகள்', 'users', true), T('/parent/settings', 'Account', 'கணக்கு', 'settings')],
  teacher: [T('/teacher', 'Overview', 'மேலோட்டம்', 'home', true), T('/teacher/classes', 'Classes', 'வகுப்புகள்', 'users'), T('/teacher/tests', 'Weekly Tests', 'வாராந்திரத் தேர்வுகள்', 'test'), T('/teacher/reviews', 'Marking queue', 'மதிப்பீட்டு வரிசை', 'edit'), T('/teacher/questions', 'Question bank', 'கேள்வி வங்கி', 'layers'), T('/teacher/books', 'Class books', 'வகுப்புப் புத்தகங்கள்', 'book'), T('/teacher/lessons', 'Lesson review', 'பாடச் சரிபார்ப்பு', 'check'), T('/teacher/certificates', 'Certificates', 'சான்றிதழ்கள்', 'award')],
   school_admin: [T('/app', 'Home', 'முகப்பு', 'home', true), T('/admin/books', 'Class books', 'வகுப்புப் புத்தகங்கள்', 'book')], admin: [T('/app', 'Home', 'முகப்பு', 'home', true), T('/admin/people', 'People', 'நபர்கள்', 'users'), T('/admin/books', 'Class books', 'வகுப்புப் புத்தகங்கள்', 'book'), T('/teacher/lessons', 'Lesson review', 'பாடச் சரிபார்ப்பு', 'check'), T('/admin/ai', 'AI usage', 'AI பயன்பாடு', 'layers')], pending: [T('/app', 'Home', 'முகப்பு', 'home', true)],
};
const ROLE_LABEL: Record<Role, string> = { student: 'Student', parent: 'Parent / guardian', teacher: 'Teacher', school_admin: 'School admin', admin: 'Platform admin', pending: 'Awaiting approval' };

function Label({ n }: { n: NavItem }) { const { lang } = useLang(); return <span className="navlbl">{lang === 'ta' ? <span lang="ta" className="ta">{n.ta}</span> : <>{n.en}{lang === 'both' && <span lang="ta" className="ta navta">{n.ta}</span>}</>}</span>; }

function Bell() {
  const [open, setOpen] = useState(false); const [d, setD] = useState<any>(null); const ref = useRef<HTMLDivElement>(null);
  const load = () => get('/notifications').then(setD).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!open) return; const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false); document.addEventListener('mousedown', f); document.addEventListener('keydown', k); return () => { document.removeEventListener('mousedown', f); document.removeEventListener('keydown', k); }; }, [open]);
  return (
    <div className="pop-wrap" ref={ref}>
      <button className="btn secondary iconbtn" aria-label={`Notifications${d?.unread ? `, ${d.unread} unread` : ''}`} aria-expanded={open} onClick={() => { setOpen(o => !o); if (!open) load(); }}><Icon name="bell" />{!!d?.unread && <span className="dot">{d.unread}</span>}</button>
      {open && <div className="pop" role="dialog" aria-label="Notifications">
        <div className="row" style={{ padding: '4px 4px 8px' }}><b className="grow">Notifications</b>{!!d?.unread && <button className="linkbtn" onClick={async () => { await post('/notifications/read'); load(); }}>Mark all read</button>}</div>
        {!d?.notifications?.length ? <div className="muted small" style={{ padding: 12 }}>You have no notifications yet.</div> : d.notifications.slice(0, 8).map((n: any) => (
          <div key={n.id} className={`note ${n.read ? '' : 'unread'}`}><div className="semi small">{n.title}</div><div className="muted small">{n.body}</div><div className="muted xs">{fmtDT(n.created_at)}</div></div>))}
      </div>}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { user, profile, logout, config } = useAuth(); const nav = useNavigate(); const loc = useLocation(); const [more, setMore] = useState(false); const [q, setQ] = useState('');
  useEffect(() => { setMore(false); window.scrollTo(0, 0); }, [loc.pathname]);
  if (!user) return null;
  const items = NAV[user.role];
  const name = profile?.preferred_name || profile?.full_name || user.display_name;
  const out = async () => { await logout(); nav('/'); };
  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <aside className="side" aria-label="Main navigation">
        <Link to="/" className="logo"><BrandMark size={44} /><span><BrandName size={17} /><br /><span className="muted xs"><Bi en={BRAND.productDescription} ta={BRAND.productDescriptionTamil} /></span></span></Link>
        <div className="navscroll">{items.map(n => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav ${isActive ? 'active' : ''}`}><Icon name={n.icon} /><Label n={n} /></NavLink>)}</div>
        <div className="usercard"><span className="avatar" aria-hidden>{(name || '?')[0].toUpperCase()}</span><div className="grow"><div className="semi small ell">{name}</div><div className="muted xs">{ROLE_LABEL[user.role]}{profile ? ` · Class ${profile.class_level}` : ''}</div></div>
          <button className="btn secondary iconbtn" aria-label="Sign out" onClick={out}><Icon name="logout" /></button></div>
      </aside>
      <div className="main">
        <header className="topbar">
          <Link to="/" className="logo mlogo" aria-label={`${BRAND.appName} home`}><BrandMark size={36} /></Link>
          {user.role === 'student' && <form className="searchform" role="search" onSubmit={e => { e.preventDefault(); nav(`/app/learn?q=${encodeURIComponent(q)}`); }}><Icon name="search" size={16} /><input className="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search lessons…" aria-label="Search lessons" /></form>}
          <div className="grow" />{!config?.bookOnly && <Badge tone="warning">Sample content</Badge>}<LangToggle />
          <Bell />
        </header>
        <main className="content" id="main" tabIndex={-1}><OfflineBanner />{children}</main>
        <nav className="bottomnav" aria-label="Primary">
          <button onClick={() => setMore(true)} aria-label="More menu" aria-haspopup="dialog"><Icon name="menu" size={24} /></button>
        </nav>
      </div>
      {more && <div className="sheet-bg" onMouseDown={e => e.target === e.currentTarget && setMore(false)}><div className="sheet" role="dialog" aria-modal="true" aria-label="Menu">
        <div className="row"><b className="grow">Menu</b><button className="btn secondary iconbtn" aria-label="Close menu" onClick={() => setMore(false)}><Icon name="x" /></button></div>
        <div className="sheetgrid">{items.map(n => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav ${isActive ? 'active' : ''}`}><Icon name={n.icon} /><Label n={n} /></NavLink>)}</div>
        <button className="btn secondary" onClick={out}><Icon name="logout" /> Sign out</button></div></div>}
    </div>
  );
}

function OfflineBanner() {
  const [off, setOff] = useState(typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => { const a = () => setOff(true), b = () => setOff(false); window.addEventListener('offline', a); window.addEventListener('online', b); return () => { window.removeEventListener('offline', a); window.removeEventListener('online', b); }; }, []);
  return off ? <div className="notice warn" role="status">You are offline. What you have already opened stays on screen; saving and asking the tutor need a connection.</div> : null;
}
