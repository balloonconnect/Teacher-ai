/**
 * Runs the REAL tutor model against the labelled book questions and prints how it did. Needs your key and an imported book.
 *   ANTHROPIC_API_KEY=… npx tsx scripts/check-tutor.ts [questions.json] [--limit 10]
 * (or LLM_PROVIDER=openai LLM_BASE_URL=… LLM_API_KEY=… LLM_MODEL=…). It sends the question and retrieved book passages to the provider, as the app does.
 */
import { readFileSync } from 'node:fs';
import { openDb } from '../server/db';
import { llmClientFromEnv } from '../server/services/llmEngine';
import { checkTutor, fmtTutor } from '../server/services/evalTutor';

const args = process.argv.slice(2); const li = args.indexOf('--limit'); const limit = li >= 0 ? Number(args[li + 1]) : Infinity; const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--limit') ?? 'eval/class8-tamil.questions.json';
const client = llmClientFromEnv(); if (!client) { console.error('No model configured. Set ANTHROPIC_API_KEY (or LLM_PROVIDER=openai with LLM_BASE_URL).'); process.exit(2); }
const set = JSON.parse(readFileSync(file, 'utf8')); const db = await openDb();
console.log(`model: ${client.name}   streaming: ${client.stream ? 'yes' : 'no'}   questions: ${Math.min(limit, set.items.length)}`);
const items = [...set.items.filter((i: any) => i.pages.length).slice(0, limit), ...set.items.filter((i: any) => !i.pages.length)];
const r = await checkTutor(db, client, set.classLevel, items, { onRow: x => console.log(`${x.ok ? 'ok  ' : 'FAIL'} ${String(x.totalMs).padStart(6)}ms steps=${x.steps} page=${x.rightPage ? 'y' : 'n'} ${x.fallback ? `[fallback: ${x.fallback}] ` : ''}${x.problem ?? ''} ${x.q.slice(0, 50)}`) });
console.log('\n' + fmtTutor(r)); await db.close(); process.exit(0);
