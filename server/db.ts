import { createRequire } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Database access. One async API, two engines:
 *  - PostgreSQL (production): set DATABASE_URL=postgres://user:pass@host/db
 *  - SQLite (local development and fast tests): the default, or DATABASE_PATH / ':memory:'
 * All SQL in the app is written once with `?` placeholders; the Postgres driver rewrites them to $1, $2, ...
 */
type Row = Record<string, any>;
type Conn = { get(sql: string, p: any[]): Promise<Row | undefined>; all(sql: string, p: any[]): Promise<Row[]>; run(sql: string, p: any[]): Promise<{ changes: number }>; exec(sql: string): Promise<void>; };
export type DB = {
  readonly kind: 'sqlite' | 'pg';
  conn(): Conn; tx<T>(fn: () => Promise<T>): Promise<T>; exec(sql: string): Promise<void>; close(): Promise<void>;
};
const als = new AsyncLocalStorage<{ db: DB; conn: Conn }>();
const active = (db: DB): Conn => { const s = als.getStore(); return s && s.db === db ? s.conn : db.conn(); };

/** Runs fn in one transaction (nested calls join the outer one); rolls back if fn throws. */
export async function tx<T>(db: DB, fn: () => Promise<T>): Promise<T> { const s = als.getStore(); return s && s.db === db ? (await fn()) : (await db.tx(fn)); }
export const q = {
  get: async <T = any>(db: DB, sql: string, ...p: any[]) => (await active(db).get(sql, p)) as T | undefined,
  all: async <T = any>(db: DB, sql: string, ...p: any[]) => (await active(db).all(sql, p)) as T[],
  run: (db: DB, sql: string, ...p: any[]) => active(db).run(sql, p),
};

export async function openDb(target: string = process.env.DATABASE_URL ?? process.env.DATABASE_PATH ?? 'data/kavli.db', o: { migrate?: boolean } = {}): Promise<DB> {
  const db = /^postgres(ql)?:\/\//.test(target) ? await openPg(target) : openSqlite(target);
  await db.exec(db.kind === 'pg' ? toPgSchema(SCHEMA) : SCHEMA);
  if (o.migrate !== false && process.env.MIGRATE_ON_START !== '0') await (await import('./migrate')).runMigrations(db);
  return db;
}

/* ---------------- SQLite ---------------- */
function openSqlite(path: string): DB {
  const { DatabaseSync: DS } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const raw: DatabaseSync = new DS(path); raw.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  // One connection: while a transaction is open, statements from other requests wait, so they never join (or get rolled back with) it.
  let txActive = false; let waiters: (() => void)[] = []; let chain: Promise<void> = Promise.resolve();
  const gate = async () => { while (txActive && !als.getStore()) await new Promise<void>(r => waiters.push(r)); };
  const conn: Conn = {
    async get(sql, p) { await gate(); return raw.prepare(sql).get(...p) as Row | undefined; },
    async all(sql, p) { await gate(); return raw.prepare(sql).all(...p) as Row[]; },
    async run(sql, p) { await gate(); const r = raw.prepare(sql).run(...p); return { changes: Number(r.changes) }; },
    async exec(sql) { await gate(); raw.exec(sql); },
  };
  const db: DB = {
    kind: 'sqlite', conn: () => conn, exec: sql => active(db).exec(sql), async close() { raw.close(); },
    tx<T>(fn: () => Promise<T>) {
      const run = async () => { txActive = true; raw.exec('BEGIN IMMEDIATE'); try { const r = await als.run({ db, conn }, fn); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; } finally { txActive = false; const w = waiters; waiters = []; w.forEach(f => f()); } };
      const res = chain.then(run, run); chain = res.then(() => undefined, () => undefined); return res;
    },
  };
  return db;
}

/* ---------------- PostgreSQL ---------------- */
/** `?` → `$1, $2 …`, leaving anything inside single-quoted SQL strings alone. */
/** `?` -> `$n`; SQLite's implicit `rowid` (only used to order chat messages) -> the explicit `seq` column. */
export function toPgSql(sql: string) { let n = 0, out = '', inStr = false; for (const ch of sql) { if (ch === "'") inStr = !inStr; out += ch === '?' && !inStr ? `$${++n}` : ch; } return out.replace(/\browid\b/g, 'seq'); }
/** PostgreSQL text cannot hold NUL bytes (SQLite can); strip them from bound strings. */
const pgParams = (p: any[]) => p.map(v => (typeof v === 'string' && v.includes('\u0000') ? v.replace(/\u0000/g, '') : v));
export function toPgSchema(s: string) { return s.replace(/(CREATE TABLE IF NOT EXISTS messages \([^;]*?)\);/, '$1, seq BIGSERIAL);').replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'BIGSERIAL PRIMARY KEY').replace(/\bREAL\b/g, 'DOUBLE PRECISION').replace(/\bBLOB\b/g, 'BYTEA'); }
async function openPg(url: string): Promise<DB> {
  const pg = (await import('pg')).default;
  pg.types.setTypeParser(20, v => Number(v)); pg.types.setTypeParser(1700, v => Number(v)); // bigint / numeric (COUNT, SUM) come back as numbers, as in SQLite
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL ?? 10), ssl: process.env.DATABASE_SSL === '1' ? { rejectUnauthorized: process.env.DATABASE_SSL_STRICT !== '0' } : undefined, idleTimeoutMillis: Number(process.env.DATABASE_IDLE_MS ?? 30000), connectionTimeoutMillis: 10000 });
  pool.on('error', () => { /* idle client dropped; the pool reconnects on next use */ });
  const mk = (c: { query: (q: string, p?: any[]) => Promise<any> }): Conn => ({
    async get(sql, p) { return (await c.query(toPgSql(sql), pgParams(p))).rows[0]; },
    async all(sql, p) { return (await c.query(toPgSql(sql), pgParams(p))).rows; },
    async run(sql, p) { const r = await c.query(toPgSql(sql), pgParams(p)); return { changes: r.rowCount ?? 0 }; },
    async exec(sql) { await c.query(sql); }, // raw text, so several statements and any operator characters pass through untouched
  });
  const base = mk(pool);
  const db: DB = {
    kind: 'pg', conn: () => base, exec: sql => active(db).exec(sql), async close() { await pool.end(); },
    async tx<T>(fn: () => Promise<T>) { const c = await pool.connect(); try { await c.query('BEGIN'); const r = await als.run({ db, conn: mk(c) }, fn); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } },
  };
  await pool.query('SELECT 1'); return db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schools (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','parent','teacher','school_admin','admin','pending')),
  school_id TEXT REFERENCES schools(id), consent_at TEXT, created_at TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, is_demo INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, csrf TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS student_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, ref_no TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL, full_name_ta TEXT, preferred_name TEXT,
  class_level INTEGER NOT NULL CHECK (class_level BETWEEN 1 AND 12), board TEXT NOT NULL DEFAULT 'Tamil Nadu State Board (Samacheer Kalvi)',
  medium TEXT NOT NULL CHECK (medium IN ('Tamil','English')), ai_lang TEXT NOT NULL CHECK (ai_lang IN ('ta','en','both')), academic_year TEXT NOT NULL,
  school_name TEXT, school_ref TEXT, subjects TEXT NOT NULL DEFAULT '[]', goals TEXT NOT NULL DEFAULT '[]', avatar TEXT, voice_prefs TEXT NOT NULL DEFAULT '{}',
  guardian_approved INTEGER NOT NULL DEFAULT 0, school_managed INTEGER NOT NULL DEFAULT 0, completed_at TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS guardian_links (parent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, notify INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(parent_id, student_id));
CREATE TABLE IF NOT EXISTS classes (id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id), teacher_id TEXT REFERENCES users(id), name TEXT NOT NULL, class_level INTEGER NOT NULL, academic_year TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS enrolments (class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE, student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(class_id, student_id));
CREATE TABLE IF NOT EXISTS subjects (id TEXT PRIMARY KEY, name_en TEXT NOT NULL, name_ta TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY, class_level INTEGER NOT NULL, subject_id TEXT NOT NULL REFERENCES subjects(id), term INTEGER NOT NULL DEFAULT 1, chapter_no INTEGER NOT NULL,
  chapter_en TEXT NOT NULL, chapter_ta TEXT NOT NULL, title_en TEXT NOT NULL, title_ta TEXT NOT NULL, minutes INTEGER NOT NULL DEFAULT 15, position INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL, source TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'published');
CREATE TABLE IF NOT EXISTS lesson_progress (student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, lesson_id TEXT NOT NULL REFERENCES lessons(id), opened_at TEXT NOT NULL, completed_at TEXT, PRIMARY KEY(student_id, lesson_id));
CREATE TABLE IF NOT EXISTS bookmarks (id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, ref TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(student_id, kind, ref));
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES subjects(id), class_level INTEGER NOT NULL, chapter_no INTEGER, type TEXT NOT NULL CHECK (type IN ('mcq','tf','fill','numeric','short')),
  text_en TEXT NOT NULL, text_ta TEXT, options TEXT NOT NULL DEFAULT '[]', answer TEXT NOT NULL, marks REAL NOT NULL DEFAULT 1, difficulty TEXT NOT NULL DEFAULT 'medium',
  explanation_en TEXT, explanation_ta TEXT, topic TEXT, version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'published', origin TEXT NOT NULL DEFAULT 'teacher', created_by TEXT, school_id TEXT);
CREATE TABLE IF NOT EXISTS tests (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, class_level INTEGER NOT NULL, board TEXT NOT NULL, subject_id TEXT NOT NULL REFERENCES subjects(id), academic_year TEXT NOT NULL,
  topics TEXT NOT NULL DEFAULT '[]', week_no INTEGER, opens_at TEXT NOT NULL, closes_at TEXT NOT NULL, duration_min INTEGER, language TEXT NOT NULL DEFAULT 'both',
  instructions TEXT, pass_pct REAL NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 1, score_rule TEXT NOT NULL DEFAULT 'highest', show_review INTEGER NOT NULL DEFAULT 1,
  awards_certificate INTEGER NOT NULL DEFAULT 1, allow_change_answers INTEGER NOT NULL DEFAULT 1, auto_submit INTEGER NOT NULL DEFAULT 1, published INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id), school_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS test_questions (test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE, question_id TEXT NOT NULL REFERENCES questions(id), marks REAL NOT NULL, position INTEGER NOT NULL, question_version INTEGER NOT NULL, PRIMARY KEY(test_id, question_id));
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY, test_id TEXT NOT NULL REFERENCES tests(id), student_id TEXT NOT NULL REFERENCES users(id), attempt_no INTEGER NOT NULL,
  started_at TEXT NOT NULL, deadline_at TEXT, submitted_at TEXT, status TEXT NOT NULL CHECK (status IN ('in_progress','pending_review','finalised')),
  rules TEXT NOT NULL, context TEXT NOT NULL, UNIQUE(test_id, student_id, attempt_no));
CREATE TABLE IF NOT EXISTS answers (attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE, question_id TEXT NOT NULL, answer TEXT NOT NULL, flagged INTEGER NOT NULL DEFAULT 0, saved_at TEXT NOT NULL, PRIMARY KEY(attempt_id, question_id));
CREATE TABLE IF NOT EXISTS gradings (attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE, question_id TEXT NOT NULL, marks REAL NOT NULL, max_marks REAL NOT NULL, auto INTEGER NOT NULL, feedback TEXT, graded_by TEXT, graded_at TEXT NOT NULL, PRIMARY KEY(attempt_id, question_id));
CREATE TABLE IF NOT EXISTS results (attempt_id TEXT PRIMARY KEY REFERENCES attempts(id) ON DELETE CASCADE, marks REAL NOT NULL, total REAL NOT NULL, pct REAL NOT NULL, pass_marks REAL NOT NULL, status TEXT NOT NULL CHECK (status IN ('passed','not_passed','pending_review')), finalised_at TEXT, snapshot TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, ref_no TEXT UNIQUE NOT NULL, student_id TEXT NOT NULL REFERENCES users(id), test_id TEXT NOT NULL REFERENCES tests(id), attempt_id TEXT NOT NULL REFERENCES attempts(id),
  template_type TEXT NOT NULL, template_version INTEGER NOT NULL, issued_at TEXT NOT NULL, snapshot TEXT NOT NULL, issuer TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('valid','revoked','superseded')), reason TEXT, superseded_by TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cert_attempt ON certificates(attempt_id) WHERE status = 'valid';
CREATE UNIQUE INDEX IF NOT EXISTS ux_cert_student_test ON certificates(student_id, test_id) WHERE status = 'valid';
CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, subject_id TEXT, lesson_id TEXT, material_id TEXT, lang TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS textbooks (id TEXT PRIMARY KEY, title TEXT NOT NULL, class_level INTEGER NOT NULL, subject_id TEXT, medium TEXT NOT NULL DEFAULT 'English', file_path TEXT NOT NULL, size INTEGER, page_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, note TEXT, uploaded_by TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS textbook_pages (textbook_id TEXT NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE, page INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (textbook_id, page));
CREATE TABLE IF NOT EXISTS textbook_chapters (id TEXT PRIMARY KEY, textbook_id TEXT NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE, ord INTEGER NOT NULL, title TEXT NOT NULL, start_page INTEGER NOT NULL, end_page INTEGER NOT NULL, verified INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'auto');
CREATE INDEX IF NOT EXISTS ix_chapters_book ON textbook_chapters(textbook_id, ord);
CREATE TABLE IF NOT EXISTS email_tokens (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_email_tokens_user ON email_tokens(user_id, kind);
CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, name TEXT NOT NULL, mime TEXT, size INTEGER, file_path TEXT, source_url TEXT, text TEXT, pages TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS practice_sessions (id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, question_ids TEXT NOT NULL, created_at TEXT NOT NULL, submitted_at TEXT, score REAL, total REAL, lang TEXT);
CREATE TABLE IF NOT EXISTS assignments (id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, due_at TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS submissions (assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE, student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, text TEXT NOT NULL, submitted_at TEXT NOT NULL, feedback TEXT, PRIMARY KEY(assignment_id, student_id));
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT, action TEXT NOT NULL, entity TEXT, entity_id TEXT, details TEXT NOT NULL DEFAULT '{}', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, provider TEXT NOT NULL, kind TEXT NOT NULL, input_chars INTEGER NOT NULL, output_chars INTEGER NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_attempts_student ON attempts(student_id, test_id);
CREATE TABLE IF NOT EXISTS voice_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, mode TEXT NOT NULL, lang TEXT NOT NULL, show_both INTEGER NOT NULL DEFAULT 1, subject_id TEXT, lesson_id TEXT, topic TEXT, state TEXT NOT NULL DEFAULT '{}', save_transcript INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS voice_turns (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE, role TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, step INTEGER, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS voice_quiz (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE, user_id TEXT NOT NULL, question_id TEXT, topic TEXT, given TEXT, correct INTEGER NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS voice_metrics (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, session_id TEXT, kind TEXT NOT NULL, ms INTEGER NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_voice_turns ON voice_turns(session_id, id);
CREATE INDEX IF NOT EXISTS ix_messages_conv ON messages(conversation_id, created_at);
`;
