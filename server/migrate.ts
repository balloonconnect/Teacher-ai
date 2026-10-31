import { createHash } from 'node:crypto';
import { DB, q, tx } from './db';
import { iso } from './clock';
import { MIGRATIONS } from './migrations';

/**
 * Versioned schema changes. The first release's tables are the baseline (version 1, created by `SCHEMA` with CREATE TABLE IF NOT EXISTS). Everything after that is a numbered
 * migration in server/migrations.ts, applied once, in order, inside one transaction, and recorded in `schema_migrations` with a checksum.
 *  - A migration that was already applied and has since been edited is refused (that is how silent drift between environments starts).
 *  - Several app instances starting together are serialised (PostgreSQL advisory lock), so a migration never runs twice.
 *  - A failure rolls the whole batch back and stops the start-up with the migration's name.
 *  - A database that is AHEAD of the code (an older image started after a newer one migrated) is allowed but warned about: keep migrations additive so that is safe.
 */
export type Migration = { version: number; name: string; sql?: string | { sqlite?: string; pg?: string }; up?: (db: DB) => Promise<void> };
export type MigrationReport = { baselined: boolean; applied: { version: number; name: string }[]; pending: { version: number; name: string }[]; ahead: number[]; current: number };
export class MigrationError extends Error { constructor(m: string) { super(m); this.name = 'MigrationError'; } }

const sum = (m: Migration) => createHash('sha256').update(`${m.version}|${m.name}|${typeof m.sql === 'string' ? m.sql : JSON.stringify(m.sql ?? null)}|${m.up ? 'fn' : ''}`).digest('hex').slice(0, 16);
const BASELINE = { version: 1, name: 'baseline', checksum: 'baseline' };

export function validate(list: Migration[]) {
  let last = 1;
  for (const m of list) {
    if (!Number.isInteger(m.version) || m.version <= last) throw new MigrationError(`Migration ${m.version} (${m.name}) must have a version greater than ${last}. Versions are unique and increasing; 1 is the baseline.`);
    if (!/^[a-z0-9_]{3,60}$/.test(m.name)) throw new MigrationError(`Migration ${m.version} has an invalid name "${m.name}" (use lower_snake_case).`);
    if (!m.sql && !m.up) throw new MigrationError(`Migration ${m.version} (${m.name}) has nothing to run.`);
    last = m.version;
  }
}
const sqlFor = (m: Migration, db: DB) => (typeof m.sql === 'string' ? m.sql : m.sql?.[db.kind]);

/** Applies pending migrations (or, with `dryRun`, only reports them). Safe to call on every start. */
export async function runMigrations(db: DB, list: Migration[] = MIGRATIONS, o: { dryRun?: boolean } = {}): Promise<MigrationReport> {
  validate(list);
  const report: MigrationReport = { baselined: false, applied: [], pending: [], ahead: [], current: 1 };
  const work = async () => {
    if (db.kind === 'pg') await q.get(db, 'SELECT pg_advisory_xact_lock(7265431)'); // released at COMMIT; other instances wait here, then see the finished work
    await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)');
    let rows = await q.all<{ version: number; name: string; checksum: string }>(db, 'SELECT version, name, checksum FROM schema_migrations ORDER BY version');
    if (!rows.length && !o.dryRun) { await q.run(db, 'INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES (?,?,?,?)', BASELINE.version, BASELINE.name, BASELINE.checksum, iso()); report.baselined = true; rows = [{ ...BASELINE }]; }
    if (!rows.length) rows = [{ ...BASELINE }];
    const done = new Map(rows.map(r => [Number(r.version), r])); const known = new Map(list.map(m => [m.version, m]));
    for (const m of list) { const r = done.get(m.version); if (r && r.checksum !== sum(m)) throw new MigrationError(`Migration ${m.version} (${m.name}) was already applied but its definition has changed. Do not edit a released migration; add a new one instead.`); }
    report.ahead = rows.filter(r => r.version > 1 && !known.has(Number(r.version))).map(r => Number(r.version));
    const top = Math.max(...rows.map(r => Number(r.version)));
    const pending = list.filter(m => !done.has(m.version));
    const old = pending.find(m => m.version < top); if (old) throw new MigrationError(`Migration ${old.version} (${old.name}) is not applied but a later one (${top}) is. Migrations must be added in order.`);
    report.pending = pending.map(m => ({ version: m.version, name: m.name })); report.current = top;
    if (o.dryRun) return;
    for (const m of pending) {
      try {
        if (m.up) await m.up(db); const text = sqlFor(m, db); if (text) await db.exec(text); else if (!m.up) throw new Error(`no SQL for ${db.kind}`);
        await q.run(db, 'INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES (?,?,?,?)', m.version, m.name, sum(m), iso());
      } catch (e: any) { throw new MigrationError(`Migration ${m.version} (${m.name}) failed and nothing from this start-up was applied: ${String(e?.message ?? e).slice(0, 300)}`); }
      report.applied.push({ version: m.version, name: m.name }); report.current = m.version;
    }
  };
  await tx(db, work);
  if (report.ahead.length) console.warn(`[db] this database has migration(s) ${report.ahead.join(', ')} that this version of the app does not know. Keep migrations additive so an older version still works, or deploy the newer version.`);
  if (report.applied.length) console.log(`[db] applied migration${report.applied.length > 1 ? 's' : ''}: ${report.applied.map(a => `${a.version} ${a.name}`).join(', ')}`);
  return report;
}

export async function migrationStatus(db: DB, list: Migration[] = MIGRATIONS) {
  const r = await runMigrations(db, list, { dryRun: true });
  const rows = await q.all<{ version: number; name: string; applied_at: string }>(db, 'SELECT version,name,applied_at FROM schema_migrations ORDER BY version');
  return { ...r, history: rows };
}
