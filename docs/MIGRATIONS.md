# Database migrations

The app creates its tables on first start (`SCHEMA` in `server/db.ts`, version 1, the *baseline*). Every later schema change is a numbered migration in `server/migrations.ts`. Each runs once, in order, in one transaction, and is recorded in the `schema_migrations` table.

## Adding a change
1. Append to `MIGRATIONS`: `{ version: 2, name: 'users_last_login', sql: 'ALTER TABLE users ADD COLUMN last_login_at TEXT' }`. Use `sql: { sqlite: '…', pg: '…' }` when the engines differ, or `up: async db => { … }` to move data.
2. Add a test in `tests/` that checks the new column or table (the suite runs on SQLite and PostgreSQL).
3. Do **not** also add it to `SCHEMA` (a new database gets it from the migration).
4. Never edit or reorder a migration after it has shipped. Start-up refuses a database whose recorded checksum no longer matches. Fix mistakes with a new migration.

Keep changes **additive** (new table, new nullable column, new index). Then an older image still works against a newer database, which is what makes rollback safe. For a rename, drop or type change, do it in two releases: add the new thing and write to both, then remove the old one later.

## Running
- On start the app applies anything waiting. Set `MIGRATE_ON_START=0` to run it as a release step instead (recommended with more than one instance): `npx tsx scripts/migrate.ts up`.
- `npx tsx scripts/migrate.ts status` shows what is applied and what is waiting, and changes nothing.
- Several instances starting at once are serialised by a PostgreSQL advisory lock, so a migration never runs twice.
- If a migration fails, the whole batch is rolled back, the app does not start, and the message names the migration.
- **Take a database backup before a release that has migrations.**

## Limits
- SQLite cannot drop or retype a column in place; use the table-rebuild pattern in an `up` function. `PRAGMA foreign_keys` cannot be changed inside a transaction, so rebuilds that need it off are not supported by this runner.
- A database that is ahead of the code (an old image started after a new one migrated) starts with a warning.
- There are no automatic "down" migrations. Restore the backup instead.
- Databases created before this runner existed are recorded as the baseline on their first start; their data is not touched. Older dev databases that predate the `pending` role still need deleting (the role list is a CHECK constraint that is not migrated).
- Tested on SQLite and a real PostgreSQL 18; not on managed Postgres with a connection pooler in transaction mode (advisory transaction locks need a session-stable connection).
