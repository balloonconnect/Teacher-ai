import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response, NextFunction } from 'express';
import { DB, q } from './db';
import { clock, iso } from './clock';
const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const uid = () => randomUUID();
export async function hashPassword(pw: string) {
  const salt = randomBytes(16); const h = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
export async function verifyPassword(pw: string, stored: string) {
  const [alg, s, h] = stored.split('$'); if (alg !== 'scrypt') return false;
  const calc = await scrypt(pw, Buffer.from(s, 'base64'), 64); const want = Buffer.from(h, 'base64');
  return calc.length === want.length && timingSafeEqual(calc, want);
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = (bytes = 16) => randomBytes(bytes).toString('base64url');

export type Role = 'student' | 'parent' | 'teacher' | 'school_admin' | 'admin' | 'pending';
export type AuthUser = { id: string; email: string; display_name: string; role: Role; school_id: string | null };
// eslint-disable-next-line @typescript-eslint/no-namespace -- the only way to extend Express's Request type
declare global { namespace Express { interface Request { user?: AuthUser; csrf?: string } } }

export const COOKIE = 'kavli_session';
export async function createSession(db: DB, userId: string) {
  const token = newToken(32), csrf = newToken(16);
  await q.run(db, 'INSERT INTO sessions(token_hash,user_id,expires_at,csrf) VALUES (?,?,?,?)', sha(token), userId, iso(new Date(clock.now().getTime() + 7 * 864e5)), csrf);
  return { token, csrf };
}
export const destroySession = async (db: DB, token: string) => (await q.run(db, 'DELETE FROM sessions WHERE token_hash=?', sha(token)));

export function parseCookies(h?: string) {
  const o: Record<string, string> = {}; for (const p of (h ?? '').split(';')) { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } return o;
}
export function authMiddleware(db: DB) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const t = parseCookies(req.headers.cookie)[COOKIE];
    if (t) {
      const s = (await q.get<any>(db, 'SELECT s.user_id, s.expires_at, s.csrf, u.id, u.email, u.display_name, u.role, u.school_id, u.disabled FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?', sha(t)));
      if (s && s.expires_at > iso() && !s.disabled) { req.user = { id: s.id, email: s.email, display_name: s.display_name, role: s.role, school_id: s.school_id }; req.csrf = s.csrf; }
    }
    next();
  };
}
export const requireAuth = (req: Request, res: Response, next: NextFunction) => req.user ? next() : void res.status(401).json({ error: 'Please sign in.' });
export const requireRole = (...roles: Role[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) return void res.status(401).json({ error: 'Please sign in.' });
  if (!roles.includes(req.user.role)) return void res.status(403).json({ error: 'You do not have permission for this action.' });
  next();
};
/** CSRF: state-changing requests need the per-session token in a header (cookie is also SameSite=Lax). */
/** Endpoints that are authorised by a single-use emailed token (which is the secret), so a signed-in browser opening the link is not blocked. */
const TOKEN_AUTH = /^\/api\/auth\/(?:forgot|reset|verify|guardian\/(?:lookup|decide))$/;
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.user || TOKEN_AUTH.test(req.originalUrl.split('?')[0])) return next();
  if (req.headers['x-csrf-token'] !== req.csrf) return void res.status(403).json({ error: 'Security check failed. Please refresh and try again.' });
  next();
}
/** Simple in-memory fixed-window rate limiter. */
export function rateLimit(max: number, windowMs: number, keyFn: (r: Request) => string = r => r.ip ?? 'x') {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.DISABLE_RATE_LIMIT === '1') return next();
    const k = keyFn(req), now = Date.now(); const h = hits.get(k);
    if (!h || h.reset < now) { hits.set(k, { n: 1, reset: now + windowMs }); return next(); }
    if (++h.n > max) return void res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    next();
  };
}
export async function audit(db: DB, actor: string | null, action: string, entity?: string, entityId?: string, details: unknown = {}) {
  await q.run(db, 'INSERT INTO audit(actor_id,action,entity,entity_id,details,at) VALUES (?,?,?,?,?,?)', actor, action, entity ?? null, entityId ?? null, JSON.stringify(details), iso());
}
