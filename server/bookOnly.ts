import { DB, q } from './db';
import { textbookLessons } from './curriculum';

/** BOOK_ONLY=1: the site shows only what was uploaded as a textbook. No built-in sample lessons, sample tests, practice questions or example homework. */
export const bookOnly = () => process.env.BOOK_ONLY === '1';

/** Removes the built-in example content from an existing database (safe to run on every start). Uploaded textbooks, their lessons, users and student data are left alone. */
export async function purgeSampleContent(db: DB): Promise<void> {
  const run = async (sql: string, ...p: any[]) => { try { await q.run(db, sql, ...p); } catch { /* a table may not exist on an older schema */ } };
  const T = "SELECT id FROM tests WHERE id LIKE 'test-%'";
  for (const t of ['answers', 'gradings', 'results']) await run(`DELETE FROM ${t} WHERE attempt_id IN (SELECT id FROM attempts WHERE test_id IN (${T}))`);
  await run(`DELETE FROM attempts WHERE test_id IN (${T})`);
  await run(`DELETE FROM test_questions WHERE test_id IN (${T})`);
  await run("DELETE FROM tests WHERE id LIKE 'test-%'");
  await run("DELETE FROM questions WHERE (origin='practice' OR id LIKE 't-%') AND id NOT IN (SELECT question_id FROM test_questions)");
  await run("DELETE FROM submissions WHERE assignment_id='as-1'"); await run("DELETE FROM assignments WHERE id='as-1'");
  await run("DELETE FROM notifications WHERE title='Weekly Test 6 is open'");
  const ids = [...textbookLessons().map(l => l.id)];
  for (const r of await q.all<any>(db, "SELECT id FROM lessons WHERE source LIKE 'Sample content%'")) ids.push(r.id);
  for (const id of ids) {
    await run('DELETE FROM lesson_progress WHERE lesson_id=?', id); await run('DELETE FROM item_ai WHERE lesson_id=?', id); await run('DELETE FROM item_progress WHERE lesson_id=?', id);
    await run("DELETE FROM bookmarks WHERE kind='lesson' AND ref=?", id); await run('DELETE FROM lessons WHERE id=?', id);
  }
}
