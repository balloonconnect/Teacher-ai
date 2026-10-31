import { describe, it, expect, beforeAll } from 'vitest';
import { setup } from './helpers';
import { q } from '../server/db';
import { checkTutor, fmtTutor } from '../server/services/evalTutor';
import type { LlmClient } from '../server/services/llmEngine';

const PAGES: Record<number, string> = {
  3: 'நதிகளின் பயன்கள் பற்றிய பாடம். ஆறுகள் வயல்களுக்கு நீர் தருகின்றன. ஆற்றுநீர் உழவர்களுக்கு மிகவும் தேவைப்படுகிறது. நீர் இல்லாமல் பயிர்கள் வளராது.',
  9: 'The water cycle: water evaporates from the sea, forms clouds and falls again as rain. This cycle never stops and it gives us fresh water to drink.',
};
const ITEMS = [{ q: 'ஆறுகளின் நீர் உழவர்களுக்கு ஏன் தேவை?', pages: [3] }, { q: 'How does the water cycle make rain?', pages: [9] }, { q: 'Who invented the aeroplane?', pages: [] }];
let db: any;
beforeAll(async () => {
  ({ db } = await setup());
  await q.run(db, "INSERT INTO textbooks(id,title,class_level,subject_id,medium,file_path,size,page_count,status,uploaded_by,created_at) VALUES ('bk1','Synthetic',8,NULL,'Tamil','x',1,9,'ready',NULL,'2026-01-01T00:00:00Z')");
  for (const [p, t] of Object.entries(PAGES)) await q.run(db, 'INSERT INTO textbook_pages(textbook_id,page,text) VALUES (?,?,?)', 'bk1', Number(p), t);
});
const lines = (...o: any[]) => o.map(x => JSON.stringify(x)).join('\n') + '\n';
const good: LlmClient = { name: 'mock-good', async complete() { return ''; }, async *stream() {
  yield lines({ topic: { en: 'Rivers', ta: 'ஆறுகள்' } }, { en: 'Rivers give water to fields.', ta: 'ஆறுகள் வயல்களுக்கு நீர் தருகின்றன.', cite: [1], check: { kind: 'ack' } }, { en: 'Crops need this water to grow.', ta: 'பயிர்கள் வளர நீர் தேவை.', cite: [1] });
} };
const uncited: LlmClient = { name: 'mock-bad', async complete() { return ''; }, async *stream() { yield lines({ en: 'Made up.', ta: 'கற்பனை.', cite: [] }); } };
const broken: LlmClient = { name: 'mock-broken', async complete() { throw new Error('provider down'); }, async *stream() { if (Date.now() > 0) throw new Error('provider down'); yield ''; } };

describe('tutor model checker', () => {
  it('reports a good model: usable, cited, right page, Tamil, first-step time', async () => {
    const r = await checkTutor(db, good, 8, ITEMS);
    const tamil = r.rows[0]; expect(tamil).toMatchObject({ ok: true, cited: true, rightPage: true, tamil: true }); expect(tamil.steps).toBe(2); expect(tamil.firstStepMs).not.toBeNull();
    expect(r.answerable).toBe(2); expect(fmtTutor(r)).toContain('cited the right book page');
    expect(r.rows[2].ok).toBe(true); expect(r.refused).toBe(1); // nothing in the books for the aeroplane: no model call, no invented lesson
  });
  it('does not credit uncited steps', async () => {
    const r = await checkTutor(db, uncited, 8, ITEMS.slice(0, 1)); expect(r.rows[0].ok).toBe(false); expect(r.usable).toBe(0);
  });
  it('a provider outage shows up as fallbacks, not a crash', async () => {
    const r = await checkTutor(db, broken, 8, ITEMS.slice(0, 1)); expect(r.fallbacks).toBe(1); expect(r.rows[0].fallback).toMatch(/provider down/);
  });
});
