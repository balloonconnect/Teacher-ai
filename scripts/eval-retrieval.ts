/**
 * Measures how well the tutor finds the right book page.
 *   npx tsx scripts/eval-retrieval.ts [questions.json]            (database from DATABASE_URL / DATABASE_PATH)
 * Run it after importing the book, and again after any change to retrieval or OCR. Compare the numbers.
 */
import { readFileSync } from 'node:fs';
import { openDb } from '../server/db';
import { evaluate, fmt } from '../server/services/evalRetrieval';

const file = process.argv[2] ?? 'eval/class8-tamil.questions.json'; const set = JSON.parse(readFileSync(file, 'utf8'));
const db = await openDb(); const r = await evaluate(db, set.classLevel, set.items);
console.log(`${file}\n${fmt(r)}`); for (const m of r.misses) console.log(`  MISS: ${m.q}\n        wanted ${JSON.stringify(m.wanted)}  got ${JSON.stringify(m.got)}`);
await db.close(); process.exit(0);
