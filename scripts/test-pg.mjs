// Runs the test suite against a throwaway real PostgreSQL (embedded binaries). Usage: node scripts/test-pg.mjs [vitest args]
import EmbeddedPostgres from 'embedded-postgres';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
const root = process.env.PG_TMP || '/tmp/pgroot'; // must be under a world-writable parent when running as root
const dir = `${root}/data-${process.pid}`; mkdirSync(root, { recursive: true, mode: 0o777 });
const port = 54000 + (process.pid % 900);
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false });
await pg.initialise(); await pg.start();
let code = 1;
try {
  const r = spawnSync('npx', ['vitest', 'run', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, DATABASE_POOL: '3', DATABASE_IDLE_MS: '500', TEST_PG_URL: `postgres://postgres:pw@127.0.0.1:${port}/postgres` } });
  code = r.status ?? 1;
} finally { await pg.stop(); rmSync(dir, { recursive: true, force: true }); }
process.exit(code);
