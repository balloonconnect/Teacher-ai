import type { Migration } from './migrate';

/**
 * Schema changes made AFTER the first release, oldest first. Version 1 is the baseline (everything in `SCHEMA` in db.ts) and is recorded automatically.
 *
 * How to add one (see docs/MIGRATIONS.md):
 *  1. Append `{ version: <last + 1>, name: 'short_snake_case', sql: '...' }`. Use `{ sqlite: '...', pg: '...' }` when the two engines differ.
 *  2. Never edit or reorder one that has been released: the start-up check refuses a database whose recorded checksum no longer matches.
 *  3. Keep each change additive where you can (new table, new nullable column). Add a matching line to SCHEMA only if a brand-new database should get it from the baseline too —
 *     otherwise the migration alone creates it. Do not do both.
 *
 * Example (not active):
 *   { version: 2, name: 'users_last_login', sql: 'ALTER TABLE users ADD COLUMN last_login_at TEXT' },
 */
export const MIGRATIONS: Migration[] = [
  // Explanations and answers written by the AI for one item (couplet, stanza, paragraph, question) of a book lesson.
  // Kept apart from the lesson, which holds only the textbook's own text. source_hash ties a row to the exact text it was written for.
  { version: 2, name: 'item_ai', sql: `CREATE TABLE item_ai (
    lesson_id TEXT NOT NULL, item_id TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, source_hash TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (lesson_id, item_id, kind))` },
  // What each student has done with each item: opened, marked learned, quiz tries. Drives chapter progress, "where I left off" and revision lists.
  { version: 3, name: 'item_progress', sql: `CREATE TABLE item_progress (
    student_id TEXT NOT NULL, lesson_id TEXT NOT NULL, item_id TEXT NOT NULL, viewed_at TEXT, completed_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, correct INTEGER NOT NULL DEFAULT 0, wrong INTEGER NOT NULL DEFAULT 0, last_at TEXT NOT NULL,
    PRIMARY KEY (student_id, lesson_id, item_id))` },
  // A teacher can mark an AI explanation as checked. Writing a new explanation clears the mark.
  { version: 4, name: 'item_ai_verified', sql: `ALTER TABLE item_ai ADD COLUMN verified_by TEXT; ALTER TABLE item_ai ADD COLUMN verified_at TEXT` },
  // Token counts reported by the AI provider for each call, so the admin can see real usage and an estimated cost. Only written when a provider returns usage.
  { version: 5, name: 'ai_token_usage', sql: `CREATE TABLE ai_token_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, at TEXT NOT NULL)` },
  // Messages between a parent and a teacher who teaches one of the parent's linked children (Figma PAR-05 Messages).
  { version: 6, name: 'parent_teacher_messages', sql: `CREATE TABLE parent_teacher_messages (id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT);
    CREATE INDEX parent_teacher_messages_pair ON parent_teacher_messages (from_id, to_id, created_at)` },
];
