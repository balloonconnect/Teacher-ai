// A real PostgreSQL for local development, without Docker (uses the embedded-postgres dev dependency). Leave it running in its own terminal.
//   npm run local:pg                       then, in another terminal:
//   DATABASE_URL=postgres://postgres:pw@localhost:54329/kavli SEED_DEMO=1 npm run server
// Data is kept in data/pg between runs. Stop with Ctrl+C. Not for production.
import EmbeddedPostgres from 'embedded-postgres';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const dir = process.env.PG_DIR || 'data/pg'; const port = Number(process.env.PG_PORT || 54329);
mkdirSync(dirname(dir), { recursive: true }); try { chmodSync(dirname(dir), 0o777); } catch { /* not ours to change */ } // initdb runs as the postgres user and creates the data directory itself; mkdir's mode is cut by umask, so chmod
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: true });
if (!existsSync(`${dir}/PG_VERSION`)) await pg.initialise();
await pg.start();
try { await pg.createDatabase('kavli'); } catch { /* already exists */ }
console.log(`PostgreSQL is running.\n  DATABASE_URL=postgres://postgres:pw@localhost:${port}/kavli`);
const stop = async () => { await pg.stop(); process.exit(0); }; process.on('SIGINT', stop); process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
