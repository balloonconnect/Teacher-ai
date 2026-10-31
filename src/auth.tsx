import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { get, post, setCsrf } from './api';
import { Loading } from './components/ui';

export type Role = 'student' | 'parent' | 'teacher' | 'school_admin' | 'admin' | 'pending';
export type User = { id: string; email: string; display_name: string; role: Role; school_id: string | null };
type Ctx = { user: User | null; profile: any; needsProfile: boolean; emailVerified: boolean; loading: boolean; config: any; refresh: () => Promise<void>; login: (e: string, p: string) => Promise<User>; register: (b: any) => Promise<any>; logout: () => Promise<void> };
const C = createContext<Ctx>(null as any);
export const useAuth = () => useContext(C);
export const homeFor = (r: Role) => (r === 'parent' ? '/parent' : r === 'teacher' ? '/teacher' : '/app');

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null); const [profile, setProfile] = useState<any>(null); const [needsProfile, setNeeds] = useState(false); const [emailVerified, setEmailVerified] = useState(true); const [loading, setLoading] = useState(true); const [config, setConfig] = useState<any>({});
  const apply = (d: any) => { setUser(d?.user ?? null); setProfile(d?.profile ?? null); setNeeds(!!d?.needsProfile); setEmailVerified(d?.emailVerified !== false); if (d?.csrf) setCsrf(d.csrf); };
  const refresh = useCallback(async () => { try { apply(await get('/auth/me')); } catch { apply(null); setCsrf(''); } }, []);
  useEffect(() => { (async () => { try { setConfig(await get('/config')); } catch { /* offline */ } await refresh(); setLoading(false); })(); }, [refresh]);
  const login = async (email: string, password: string) => { const d = await post('/auth/login', { email, password }); setCsrf(d.csrf); await refresh(); return d.user as User; };
  const register = async (b: any) => { const d = await post('/auth/register', b); setCsrf(d.csrf); await refresh(); return d; };
  const logout = async () => { try { await post('/auth/logout'); } finally { setCsrf(''); apply(null); } };
  return <C.Provider value={{ user, profile, needsProfile, emailVerified, loading, config, refresh, login, register, logout }}>{children}</C.Provider>;
}

/** Client-side route guard. This is only a convenience — every API call is authorised again on the server. */
export function Guard({ roles, children, allowIncompleteProfile }: { roles: Role[]; children: ReactNode; allowIncompleteProfile?: boolean }) {
  const { user, loading, needsProfile } = useAuth(); const loc = useLocation();
  if (loading) return <Loading text="Loading…" />;
  if (!user) return <Navigate to="/signin" state={{ from: loc.pathname + loc.search }} replace />;
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  if (user.role === 'student' && needsProfile && !allowIncompleteProfile) return <Navigate to="/profile" replace />;
  return <>{children}</>;
}
