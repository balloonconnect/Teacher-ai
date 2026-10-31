/**
 * Schema migrations.
 *   npx tsx scripts/migrate.ts status      what is applied and what is waiting (changes nothing)
 *   npx tsx scripts/migrate.ts up          apply what is waiting
 * The app also does `up` when it starts; set MIGRATE_ON_START=0 to run this as a separate release step instead (recommended with several instances).
 * Uses DATABASE_URL (PostgreSQL) or DATABASE_PATH (SQLite), like the app. Take a database backup first.
 */
import { openDb } from '../server/db';
import { MigrationError, migrationStatus, runMigrations } from '../server/migrate';

const cmd = process.argv[2] ?? 'status';
if (!['status', 'up'].includes(cmd)) { console.error('Usage: migrate.ts status | up'); process.exit(2); }
const db = await openDb(undefined, { migrate: false });
try {
  if (cmd === 'up') { const r = await runMigrations(db); console.log(r.applied.length ? `Applied ${r.applied.length}. Now at version ${r.current}.` : `Nothing to apply. At version ${r.current}.`); }
  else { const s = await migrationStatus(db); console.log(`${db.kind}   version ${s.current}   waiting: ${s.pending.length}${s.ahead.length ? `   ahead of this code: ${s.ahead.join(', ')}` : ''}`); for (const h of s.history) console.log(`  applied ${h.version} ${h.name}  ${h.applied_at}`); for (const p of s.pending) console.log(`  WAITING ${p.version} ${p.name}`); }
  await db.close(); process.exit(0);
} catch (e) { console.error(e instanceof MigrationError ? `\n${e.message}` : e); await db.close().catch(() => {}); process.exit(1); }
