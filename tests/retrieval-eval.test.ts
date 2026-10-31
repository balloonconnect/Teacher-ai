import { describe, it, expect, beforeAll } from 'vitest';
import { setup } from './helpers';
import { q } from '../server/db';
import { evaluate, fmt } from '../server/services/evalRetrieval';
import { topPassages } from '../server/services/retrieval';
import { readFileSync } from 'node:fs';

// A made-up Tamil-language "book" (invented sentences, not from any real textbook).
const PAGES: Record<number, string> = {
  3: 'நதிகளின் பயன்கள் பற்றிய பாடம். ஆறுகள் வயல்களுக்கு நீர் தருகின்றன. ஆற்றுநீர் உழவர்களுக்கு மிகவும் தேவையானது.',
  7: 'சூரிய மண்டலத்தில் கோள்கள் சூரியனைச் சுற்றி வருகின்றன. புவி என்பது மூன்றாவது கோள் ஆகும். நிலவு என்பது புவியின் ஒரே இயற்கைத் துணைக்கோள் ஆகும்.',
  9: 'The water cycle: water evaporates from the sea, forms clouds and falls again as rain. This cycle never stops.',
  12: 'நடுவு நிலைமை என்பது எல்லோரிடமும் ஒரே மாதிரி நீதியாக நடப்பது. நடுவுநிலைமை உடையவர் பழிக்கு அஞ்சுவார்.',
  15: 'இசைக்கருவிகள் பல வகைப்படும். யாழ், புல்லாங்குழல், முழவு ஆகியவை பழந்தமிழர் இசைக்கருவிகள்.',
};
const ITEMS = [
  { q: 'ஆறுகளின் நீர் உழவர்களுக்கு ஏன் தேவை?', pages: [3] },   // different case endings from the page
  { q: 'நடுவுநிலைமை என்றால் என்ன?', pages: [12] },                 // page has the word split by a space AND joined
  { q: 'புவியின் துணைக்கோள் எது?', pages: [7] },
  { q: 'How does the water cycle make rain?', pages: [9] },
  { q: 'யாழ் எந்த வகை கருவி?', pages: [15] },
  { q: 'Who invented the aeroplane?', pages: [] },                 // not in the book: must return nothing
  { q: 'ஐன்ஸ்டீன் சார்பியல் கோட்பாடு என்றால் என்ன?', pages: [] },
];
let db: any;
beforeAll(async () => {
  ({ db } = await setup());
  await q.run(db, "INSERT INTO textbooks(id,title,class_level,subject_id,medium,file_path,size,page_count,status,uploaded_by,created_at) VALUES ('bk1','Synthetic Tamil',8,NULL,'Tamil','x',1,15,'ready',NULL,'2026-01-01T00:00:00Z')");
  for (const [p, t] of Object.entries(PAGES)) await q.run(db, 'INSERT INTO textbook_pages(textbook_id,page,text) VALUES (?,?,?)', 'bk1', Number(p), t);
});

describe('retrieval evaluation harness', () => {
  it('scores a labelled set: right page found, unanswerable questions return nothing', async () => {
    const r = await evaluate(db, 8, ITEMS);
    expect(r.answerable).toBe(5); expect(r.noAnswerTotal).toBe(2);
    expect(r.hitAt3).toBe(5); expect(r.hitAt1).toBeGreaterThanOrEqual(4); expect(r.noAnswerCorrect).toBe(2);
    expect(r.mrr).toBeGreaterThan(0.8); expect(fmt(r)).toContain('right page in top 3: 5/5');
  });
  it('reports misses instead of hiding them', async () => {
    const r = await evaluate(db, 8, [{ q: 'நதிகளின் பயன்கள்', pages: [15] }]);
    expect(r.hitAt5).toBe(0); expect(r.misses).toEqual([expect.objectContaining({ wanted: [15] })]);
  });
  it('the committed question set is well formed and holds no book text', () => {
    const set = JSON.parse(readFileSync('eval/class8-tamil.questions.json', 'utf8'));
    expect(set.items.length).toBeGreaterThanOrEqual(20);
    for (const it of set.items) { expect(typeof it.q).toBe('string'); expect(it.q.length).toBeLessThan(140); expect(Array.isArray(it.pages)).toBe(true); }
  });
});

describe('retrieval quality', () => {
  const ps = Object.entries(PAGES).map(([page, text]) => ({ text, page: Number(page), source: 'b' }));
  it('matches across a word split by a space (common OCR/typing difference)', () => {
    expect(topPassages('நடுவுநிலைமை', ps, 1)[0]?.page).toBe(12);
    expect(topPassages('நடுவு நிலைமை', ps, 1)[0]?.page).toBe(12);
  });
  it('matches different case endings of the same word', () => {
    expect(topPassages('உழவர்களின் தேவை', ps, 1)[0]?.page).toBe(3);
  });
  it('a single generic word is not evidence for a longer question about something else', () => {
    expect(topPassages('ஐன்ஸ்டீன் சார்பியல் கோட்பாடு என்றால் என்ன', ps)).toEqual([]);
    expect(topPassages('Explain quantum entanglement of photons', ps)).toEqual([]);
  });
  it('ignores Tamil question words', () => { expect(topPassages('என்ன ஏன் எப்படி', ps)).toEqual([]); });
});
