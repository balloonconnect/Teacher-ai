import { createHash, randomBytes } from 'node:crypto';
import { DB, q } from '../db';
import { clock, iso } from '../clock';

/**
 * One-time links sent by email. Only a hash of the token is stored, a token works once, and expires.
 * kind: 'reset' (password), 'verify' (email address), 'guardian' (under-13 approval; payload says which student and which address).
 */
export type TokenKind = 'reset' | 'verify' | 'guardian';
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const nowIso = () => iso();
export const TTL = { reset: 60 * 60 * 1000, verify: 3 * 24 * 3600 * 1000, guardian: 7 * 24 * 3600 * 1000 } as const;

/** Creates a token and invalidates the user's earlier unused tokens of the same kind (a new request replaces the old link). */
export async function createToken(db: DB, userId: string, kind: TokenKind, payload: unknown = {}): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  await q.run(db, 'DELETE FROM email_tokens WHERE user_id=? AND kind=? AND used_at IS NULL', userId, kind);
  await q.run(db, 'INSERT INTO email_tokens(token_hash,user_id,kind,payload,expires_at,created_at) VALUES (?,?,?,?,?,?)', sha(raw), userId, kind, JSON.stringify(payload), iso(new Date(clock.now().getTime() + TTL[kind])), nowIso());
  return raw;
}
export type Tok = { userId: string; payload: any };
/** Looks at a token without using it (to show a page); null when unknown, used or expired. */
export async function peekToken(db: DB, raw: string, kind: TokenKind): Promise<Tok | null> {
  if (typeof raw !== 'string' || raw.length < 20 || raw.length > 100) return null;
  const r = await q.get<any>(db, 'SELECT user_id,payload FROM email_tokens WHERE token_hash=? AND kind=? AND used_at IS NULL AND expires_at>?', sha(raw), kind, nowIso());
  return r ? { userId: r.user_id, payload: JSON.parse(r.payload) } : null;
}
/** Uses a token exactly once: of two simultaneous requests only one gets the result. */
export async function consumeToken(db: DB, raw: string, kind: TokenKind): Promise<Tok | null> {
  const t = await peekToken(db, raw, kind); if (!t) return null;
  const upd = await q.run(db, 'UPDATE email_tokens SET used_at=? WHERE token_hash=? AND kind=? AND used_at IS NULL AND expires_at>?', nowIso(), sha(raw), kind, nowIso());
  return upd.changes === 1 ? t : null;
}
