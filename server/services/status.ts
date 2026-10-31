import { DB, q } from '../db';
import { storage } from './storage';
import { getOcrEngine, ocrInstalledLangs, ocrMissingLangs } from './ocr';
import { llmClientFromEnv } from './llmEngine';
import { ttsFromEnv } from './tts';
import { mailer } from './mailer';

/** What this server is actually running with — shown to the admin so a live set-up can be checked at a glance. No secrets, only names and yes/no. */
export async function systemStatus(db: DB) {
  const llm = llmClientFromEnv(); const tts = ttsFromEnv(); const ocr = await getOcrEngine(); const noTamil = ocr ? (await ocrMissingLangs('tam')).length > 0 : false;
  const n = async (sql: string) => Number((await q.get<any>(db, sql))?.n ?? 0);
  const prod = process.env.NODE_ENV === 'production';
  const checks: { key: string; label: string; ok: boolean; detail: string; advice?: string }[] = [
    { key: 'database', label: 'Database', ok: db.kind === 'pg' || !prod, detail: db.kind === 'pg' ? 'PostgreSQL' : 'SQLite file', advice: db.kind === 'pg' ? undefined : 'Use PostgreSQL (DATABASE_URL) for a live site.' },
    { key: 'storage', label: 'File storage', ok: storage().driver === 's3' || !prod, detail: storage().driver === 's3' ? 'S3-compatible bucket' : 'Local disk', advice: storage().driver === 's3' ? undefined : 'Local disk is lost when the host redeploys unless it is a persistent volume; use a bucket.' },
    { key: 'ocr', label: 'Reading scanned books (OCR)', ok: !!ocr && !noTamil, detail: ocr ? `Available (${ocr.name}${ocrInstalledLangs().length ? `; languages: ${ocrInstalledLangs().join(', ')}` : ''})${noTamil ? ' — Tamil data missing' : ''}` : 'Not installed', advice: !ocr ? 'Install Tesseract with Tamil data and poppler, or use the Docker image.' : noTamil ? 'Tamil books cannot be read without the Tamil data (Debian/Ubuntu: apt install tesseract-ocr-tam). English books still work.' : undefined },
    { key: 'tutor', label: 'Tutor', ok: !!llm, detail: llm ? `AI model: ${llm.name}` : 'Rule-based development tutor', advice: llm ? undefined : 'Set ANTHROPIC_API_KEY (or LLM_PROVIDER=openai + LLM_BASE_URL) for AI-written lessons.' },
    { key: 'voice', label: 'AI voice', ok: !!tts, detail: tts ? `Provider: ${tts.name}` : 'Browser voice only', advice: tts ? undefined : 'Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION for Tamil/English AI voices.' },
    { key: 'email', label: 'Email (password reset, guardian approval)', ok: !!mailer(), detail: mailer() ? `Sending with ${mailer()!.name}` : 'Not set up', advice: mailer() ? undefined : 'Set MAIL_FROM and either RESEND_API_KEY or SMTP_HOST (with SMTP_USER / SMTP_PASS). Without it, forgotten passwords need an administrator and under-13 guardians can only approve with a code.' },
    { key: 'demo', label: 'Demo accounts', ok: (await n('SELECT COUNT(*) n FROM users WHERE is_demo=1')) === 0 || !prod, detail: `${await n('SELECT COUNT(*) n FROM users WHERE is_demo=1')} demo account(s)`, advice: 'Live sites should run with SEED_DEMO=0 and no demo accounts.' },
    { key: 'https', label: 'Public address', ok: /^https:\/\//.test(process.env.PUBLIC_URL ?? '') || !prod, detail: process.env.PUBLIC_URL ?? 'PUBLIC_URL not set', advice: 'Set PUBLIC_URL to your https address (the microphone needs https).' },
  ];
  const books = await q.all<any>(db, 'SELECT status, COUNT(*) n FROM textbooks GROUP BY status');
  return {
    production: prod, checks, ready: checks.every(c => c.ok),
    content: { books: books.reduce((s, b) => s + b.n, 0), booksReading: books.find(b => b.status === 'processing')?.n ?? 0, bookPages: await n('SELECT COUNT(*) n FROM textbook_pages'), practiceQuestions: await n("SELECT COUNT(*) n FROM questions WHERE origin='practice' AND status='published'"), lessons: await n("SELECT COUNT(*) n FROM lessons WHERE status='published'") },
  };
}
