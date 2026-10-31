import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { setTamilDom } from '../i18n/dom';
export type Lang = 'ta' | 'en' | 'both';
const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'both', setLang: () => {} });
/** Locale for dates and numbers: Tamil when the student chose தமிழ். Read by fmtDate/fmtDT outside React. */
let currentLang: Lang = 'both';
export const dateLocale = () => (currentLang === 'ta' ? 'ta-IN' : 'en-IN');
export const LangProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('lang') as Lang) || 'both'); currentLang = lang;
  useEffect(() => { currentLang = lang; setTamilDom(lang === 'ta'); }, [lang]);
  return <Ctx.Provider value={{ lang, setLang: l => { localStorage.setItem('lang', l); setLang(l); } }}>{children}</Ctx.Provider>;
};
export const useLang = () => useContext(Ctx);
/** Renders English, Tamil or both depending on the selected language. */
export function Bi({ en, ta, block }: { en: string; ta: string; block?: boolean }) {
  const { lang } = useLang();
  const Wrap = block ? 'div' : 'span';
  if (en === ta) return <Wrap>{en}</Wrap>; // same text in both languages (e.g. an English title): show it once
  return (
    <>
      {lang !== 'ta' && <Wrap>{en}</Wrap>}
      {lang !== 'en' && <Wrap lang="ta" className="ta" style={lang === 'both' ? { display: 'block' } : undefined}>{ta}</Wrap>}
    </>
  );
}
export function LangToggle() {
  const { lang, setLang } = useLang();
  const opts: [Lang, string, string][] = [['ta', 'தமிழ்', 'த'], ['en', 'English', 'EN'], ['both', 'தமிழ் + English', 'த+EN']];
  return (
    <div className="lang" role="group" aria-label="Language">
      {opts.map(([k, t, sh]) => <button key={k} aria-pressed={lang === k} onClick={() => setLang(k)}><span className="lg">{t}</span><span className="sh">{sh}</span></button>)}
    </div>
  );
}
