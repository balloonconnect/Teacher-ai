import { beforeEach, describe, expect, it } from 'vitest';
import { setup, target } from './helpers';
import { q, openDb } from '../server/db';
import { MIGRATIONS } from '../server/migrations';
import { type Migration, migrationStatus, runMigrations, validate } from '../server/migrate';

let db: Awaited<ReturnType<typeof setup>>['db'];
// these tests drive the runner with their own migration lists, so the database starts at the baseline only
const fresh = async () => { process.env.MIGRATE_ON_START = '0'; try { const t = await setup(); await runMigrations(t.db, []); return t; } finally { delete process.env.MIGRATE_ON_START; } };
beforeEach(async () => { ({ db } = await fresh()); });
const hasCol = async (t: string, c: string) => db.kind === 'pg' ? !!(await q.get(db, 'SELECT 1 FROM information_schema.columns WHERE table_name=? AND column_name=?', t, c)) : (await q.all<any>(db, `PRAGMA table_info(${t})`)).some(x => x.name === c);
const m2: Migration = { version: 2, name: 'users_nick', sql: 'ALTER TABLE users ADD COLUMN nick TEXT' };
const m3: Migration = { version: 3, name: 'notes_table', sql: { sqlite: 'CREATE TABLE notes_x (id TEXT PRIMARY KEY, body TEXT); CREATE INDEX notes_x_i ON notes_x(body)', pg: 'CREATE TABLE notes_x (id TEXT PRIMARY KEY, body TEXT); CREATE INDEX notes_x_i ON notes_x(body)' } };

describe('schema migrations', () => {
  it('records the baseline on a new database and the shipped list is valid', async () => {
    expect((await q.all<any>(db, 'SELECT version,name FROM schema_migrations'))).toEqual([{ version: 1, name: 'baseline' }]); expect(() => validate(MIGRATIONS)).not.toThrow();
    const r = await runMigrations(db); expect(r).toMatchObject({ baselined: false, current: MIGRATIONS.length + 1 }); expect(r.applied.map(a => a.version)).toEqual(MIGRATIONS.map(m => m.version));
  });
  it('a database from before migrations existed is baselined without touching its data', async () => {
    const before = (await q.get<any>(db, 'SELECT COUNT(*) n FROM users'))!.n; await db.exec('DROP TABLE schema_migrations');
    const r = await runMigrations(db, [m2]); expect(r.baselined).toBe(true); expect(r.applied.map(a => a.version)).toEqual([2]); expect((await q.get<any>(db, 'SELECT COUNT(*) n FROM users'))!.n).toBe(before);
  });
  it('applies pending migrations once, in order, and records them', async () => {
    const r = await runMigrations(db, [m2, m3]); expect(r.applied.map(a => a.version)).toEqual([2, 3]); expect(r.current).toBe(3);
    expect(await hasCol('users', 'nick')).toBe(true); await q.run(db, "INSERT INTO notes_x VALUES ('a','b')");
    expect((await runMigrations(db, [m2, m3])).applied).toEqual([]); // second start: nothing to do, and nothing breaks
    expect((await q.all<any>(db, 'SELECT version FROM schema_migrations ORDER BY version')).map(x => x.version)).toEqual([1, 2, 3]);
  });
  it('a failing migration rolls the whole batch back and names itself', async () => {
    const bad: Migration = { version: 3, name: 'broken_one', sql: 'ALTER TABLE no_such_table ADD COLUMN x TEXT' };
    await expect(runMigrations(db, [m2, bad])).rejects.toThrow(/Migration 3 \(broken_one\) failed and nothing from this start-up was applied/);
    expect(await hasCol('users', 'nick')).toBe(false); expect((await q.all<any>(db, 'SELECT version FROM schema_migrations')).map(x => x.version)).toEqual([1]);
    expect((await runMigrations(db, [m2])).applied).toHaveLength(1); // fixing the list and restarting works
  });
  it('refuses a released migration that was edited, and one added out of order', async () => {
    await runMigrations(db, [m2, m3]);
    await expect(runMigrations(db, [{ ...m2, sql: 'ALTER TABLE users ADD COLUMN nick2 TEXT' }, m3])).rejects.toThrow(/definition has changed/);
    await expect(runMigrations(db, [m2, m3, { version: 4, name: 'later', sql: 'SELECT 1' }, ])).resolves.toBeTruthy();
    const mid: Migration = { version: 3, name: 'was_skipped', sql: 'SELECT 1' }; const { db: d2 } = await fresh(); await runMigrations(d2, [m2, { version: 5, name: 'five', sql: 'SELECT 1' }]);
    await expect(runMigrations(d2, [m2, mid, { version: 5, name: 'five', sql: 'SELECT 1' }])).rejects.toThrow(/must be added in order/);
  });
  it('a database ahead of the code starts, with the unknown versions reported', async () => {
    await runMigrations(db, [m2, m3]); const r = await runMigrations(db, [m2]); expect(r.ahead).toEqual([3]); expect(r.applied).toEqual([]);
  });
  it('status changes nothing', async () => {
    const s = await migrationStatus(db, [m2]); expect(s.pending).toEqual([{ version: 2, name: 'users_nick' }]); expect(s.history.map(h => h.version)).toEqual([1]); expect(await hasCol('users', 'nick')).toBe(false);
  });
  it('rejects malformed lists', () => {
    expect(() => validate([m2, { ...m2, name: 'dupe_name' }])).toThrow(/greater than 2/); expect(() => validate([{ version: 1, name: 'again', sql: 'x' }])).toThrow(/greater than 1/);
    expect(() => validate([{ version: 2, name: 'Bad Name', sql: 'x' }])).toThrow(/invalid name/); expect(() => validate([{ version: 2, name: 'empty_one' }])).toThrow(/nothing to run/);
  });
  it('a function migration can move data', async () => {
    await runMigrations(db, [m2, { version: 3, name: 'fill_nick', up: async d => { await q.run(d, "UPDATE users SET nick = substr(display_name, 1, 3)"); } }]);
    expect((await q.get<any>(db, "SELECT nick FROM users WHERE email='meena@demo.kavli.local'"))!.nick).toBeTruthy();
  });
  it('two instances starting at once apply a migration only once', async () => {
    const t = await target(); const keep = process.env.MIGRATE_ON_START; process.env.MIGRATE_ON_START = '0';
    try {
      const a = await openDb(t); const b = await openDb(t); const slow: Migration = { version: 2, name: 'slow_one', up: async d => { await new Promise(r => setTimeout(r, 120)); await d.exec('CREATE TABLE once_only (id INTEGER)'); } };
      if (db.kind === 'pg') { const [x, y] = await Promise.all([runMigrations(a, [slow]), runMigrations(b, [slow])]); expect(x.applied.length + y.applied.length).toBe(1); }
      else { await runMigrations(a, [slow]); expect((await runMigrations(a, [slow])).applied).toEqual([]); }
      await a.close(); if (t !== ':memory:') await b.close();
    } finally { if (keep === undefined) delete process.env.MIGRATE_ON_START; else process.env.MIGRATE_ON_START = keep; }
  });
});
