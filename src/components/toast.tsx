import { createContext, useCallback, useContext, useState, ReactNode } from 'react';
type T = { id: number; text: string; tone: 'ok' | 'err' };
const C = createContext<(text: string, tone?: 'ok' | 'err') => void>(() => {});
export const useToast = () => useContext(C);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<T[]>([]);
  const push = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => { const id = Date.now() + Math.random(); setList(l => [...l, { id, text, tone }]); setTimeout(() => setList(l => l.filter(x => x.id !== id)), 4500); }, []);
  return <C.Provider value={push}>{children}
    <div className="toasts" role="status" aria-live="polite">{list.map(t => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}</div></C.Provider>;
}
