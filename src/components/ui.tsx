import { ReactNode, ButtonHTMLAttributes, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { dateLocale } from './lang';

export const Icon = ({ name, size = 18, color = 'currentColor' }: { name: keyof typeof PATHS; size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: PATHS[name] }} />
);
const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  book: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  test: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 16v-4"/><path d="M12 16V8"/><path d="M17 16v-7"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>', back: '<path d="m15 18-6-6 6-6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>', copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>', print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>', trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>', crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>', image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>', info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>', refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
} as const;

type Tone = 'primary' | 'secondary' | 'teal' | 'ghost' | 'danger';
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; to?: string };
export function Button({ tone = 'primary', to, className = '', children, ...rest }: BtnProps) {
  const cls = `btn ${tone} ${className}`;
  if (to) return <Link to={to} className={cls}>{children}</Link>;
  return <button className={cls} {...rest}>{children}</button>;
}
export const Badge = ({ tone = 'neutral', children }: { tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'teal'; children: ReactNode }) => (
  <span className={`badge b-${tone}`}>{children}</span>
);
export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => <section className={`card ${className}`}>{children}</section>;
export const Progress = ({ pct, color = 'var(--primary)', label }: { pct: number; color?: string; label?: string }) => (
  <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}><i style={{ width: `${pct}%`, background: color }} /></div>
);
export function IconBox({ name, bg, fg }: { name: keyof typeof PATHS; bg: string; fg: string }) {
  return <div className="iconbox" style={{ background: bg, color: fg }}><Icon name={name} size={22} /></div>;
}
export function Stat({ icon, bg, fg, value, label, note }: { icon: keyof typeof PATHS; bg: string; fg: string; value: string; label: string; note?: string }) {
  return (
    <div className="card row" style={{ padding: 18 }}>
      <IconBox name={icon} bg={bg} fg={fg} />
      <div><div className="bold" style={{ fontSize: 22 }}>{value}</div><div className="muted small">{label}</div>{note && <div className="xs semi" style={{ color: fg }}>{note}</div>}</div>
    </div>
  );
}
export function ScoreRing({ pct, color, label, sub, size = 168 }: { pct: number; color: string; label: string; sub: string; size?: number }) {
  const r = size / 2 - 7, c = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`${label}, ${sub}`}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-alt)" strokeWidth="14" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      </svg>
      <div><div className="bold" style={{ fontSize: size * 0.22, color }}>{label}</div><div className="muted small">{sub}</div></div>
    </div>
  );
}
export function Field({ label, hint, error, ...rest }: { label: string; hint?: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = rest.id ?? label.replace(/\W+/g, '-').toLowerCase();
  return (
    <div className="field grow"><label htmlFor={id}>{label}</label><input id={id} aria-invalid={!!error} {...rest} />
      {hint && !error && <div className="hint">{hint}</div>}{error && <div className="err" role="alert">{error}</div>}</div>
  );
}
export const DemoBadge = () => <Badge tone="warning">Sample content</Badge>;
export const Loading = ({ text = 'Loading…' }: { text?: string }) => <div className="state" role="status"><div className="spinner" />{text}</div>;
export const Empty = ({ title, text, action }: { title: string; text: string; action?: ReactNode }) => <div className="state"><h3 style={{ color: 'var(--text)' }}>{title}</h3><p>{text}</p>{action}</div>;
export const ErrorState = ({ text, retry }: { text: string; retry?: () => void }) => (
  <div className="state" role="alert"><Icon name="alert" size={28} color="var(--danger)" /><p>{text}</p>{retry && <Button tone="secondary" onClick={retry}>Try again</Button>}</div>
);

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const prev = document.activeElement as HTMLElement | null; ref.current?.focus(); const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => { document.removeEventListener('keydown', k); prev?.focus?.(); }; }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} style={wide ? { maxWidth: 640 } : undefined}>
        <div className="row" style={{ marginBottom: 12 }}><h2 className="grow">{title}</h2><button className="btn secondary" aria-label="Close" onClick={onClose} style={{ padding: 0, width: 36, minHeight: 36 }}><Icon name="x" /></button></div>
        {children}
      </div>
    </div>
  );
}
/** Loads data on mount / when deps change, with loading + error state. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const run = useCallback(async () => { setLoading(true); setError(null); try { setData(await fn()); } catch (e: any) { setError(e?.message ?? 'Something went wrong.'); } finally { setLoading(false); } }, deps); // eslint-disable-line
  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: run, setData };
}
export function Async<T>({ s, children }: { s: { data: T | null; error: string | null; loading: boolean; reload: () => void }; children: (d: T) => ReactNode }) {
  if (s.loading && !s.data) return <Loading />;
  if (s.error) return <ErrorState text={s.error} retry={s.reload} />;
  return <>{s.data ? children(s.data) : null}</>;
}
export const PageTitle = ({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) => (
  <div className="row wrap" style={{ alignItems: 'flex-start' }}><div className="grow"><h1>{title}</h1>{sub && <p className="muted" style={{ marginTop: 4 }}>{sub}</p>}</div>{right}</div>
);
export const fmtDate = (s?: string | null, o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) => (s ? new Date(s).toLocaleDateString(dateLocale(), { ...o, timeZone: 'Asia/Kolkata' }) : '—');
export const fmtDT = (s?: string | null) => (s ? new Date(s).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—');
