import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../server/migrations';
import { sqlFor } from '../server/migrate';

// Regression: migration 5 used SQLite-only AUTOINCREMENT and crashed every PostgreSQL start.
describe('migrations are valid for PostgreSQL', () => {
  it('no migration sent to PostgreSQL contains SQLite-only syntax', () => {
    for (const m of MIGRATIONS) {
      const text = sqlFor(m, { kind: 'pg' }) ?? '';
      expect(text, `migration ${m.version} ${m.name}`).not.toMatch(/AUTOINCREMENT/i);
      expect(text, `migration ${m.version} ${m.name}`).not.toMatch(/\bBLOB\b|\bREAL\b/);
    }
  });
  it('SQLite still gets the original text', () => {
    const m5 = MIGRATIONS.find(m => m.version === 5)!;
    expect(sqlFor(m5, { kind: 'sqlite' })).toMatch(/AUTOINCREMENT/);
    expect(sqlFor(m5, { kind: 'pg' })).toMatch(/BIGSERIAL PRIMARY KEY/);
  });
});
